import { canonicalizeJson, cloneWorldDocument, findEntityLocation, getValueAtPointer, pointerForObjectKey } from '../document/index.js'
import { assertSafeObjectGraph, hasOwn, parseJsonPointer } from '../schema/safePath.js'
import type {
  PatchDiagnostic,
  StablePatchOperation,
  StablePatchTarget,
  WorldDocument,
  WorldPatch,
  WorldTransaction,
} from './types.js'

export interface AppliedWorldTransaction {
  document: WorldDocument
  forward: WorldPatch[]
  inverse: WorldPatch[]
  diagnostics: PatchDiagnostic[]
  affectedEntities: Set<string>
  affectedMaterials: Set<string>
  affectedAssets: Set<string>
  affectedPrefabs: Set<string>
  affectedCameras: Set<string>
}

function escapePointer(value: string): string { return value.replace(/~/g, '~0').replace(/\//g, '~1') }
function cloneValue<T>(value: T): T { return structuredClone(value) }

function resolveArrayIndex(value: string, length: number, allowAppend: boolean): number {
  if (value === '-' && allowAppend) return length
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid array index "${value}".`)
  return Number(value)
}

export function applyJsonPatchValue(root: unknown, patch: WorldPatch): WorldPatch {
  const parts = parseJsonPointer(patch.path)
  if (parts.length === 0) throw new Error('Replacing the whole document is not supported by a compatibility WorldPatch.')
  let target: unknown = root
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(target)) {
      const index = resolveArrayIndex(part, target.length, false)
      if (index >= target.length) throw new Error(`Array index is outside patch path "${patch.path}".`)
      target = target[index]
    } else if (target && typeof target === 'object' && hasOwn(target, part)) {
      target = (target as Record<string, unknown>)[part]
    } else throw new Error(`Cannot resolve JSON patch path "${patch.path}".`)
  }
  const key = parts.at(-1) as string
  if (Array.isArray(target)) {
    const index = resolveArrayIndex(key, target.length, patch.operation === 'add')
    const actualPath = patch.path.endsWith('/-') ? `${patch.path.slice(0, -1)}${index}` : patch.path
    if (patch.operation === 'remove') {
      if (index >= target.length) throw new Error(`Array index is outside patch path "${patch.path}".`)
      return { operation: 'add', path: actualPath, value: cloneValue(target.splice(index, 1)[0]) }
    }
    assertSafeObjectGraph(patch.value, `JSON patch value at ${patch.path}`)
    if (patch.operation === 'add') {
      if (index > target.length) throw new Error(`Array index is outside patch path "${patch.path}".`)
      target.splice(index, 0, cloneValue(patch.value))
      return { operation: 'remove', path: actualPath }
    }
    if (index >= target.length) throw new Error(`Array index is outside patch path "${patch.path}".`)
    const previous = cloneValue(target[index])
    target[index] = cloneValue(patch.value)
    return { operation: 'replace', path: actualPath, value: previous }
  }
  if (!target || typeof target !== 'object') throw new Error(`Cannot resolve JSON patch path "${patch.path}".`)
  const record = target as Record<string, unknown>
  const existed = hasOwn(record, key)
  const previous = existed ? cloneValue(record[key]) : undefined
  if (patch.operation === 'remove') {
    if (!existed) throw new Error(`Cannot remove missing path "${patch.path}".`)
    delete record[key]
    return { operation: 'add', path: patch.path, value: previous }
  }
  if (patch.operation === 'replace' && !existed) throw new Error(`Cannot replace missing path "${patch.path}".`)
  assertSafeObjectGraph(patch.value, `JSON patch value at ${patch.path}`)
  record[key] = cloneValue(patch.value)
  return existed ? { operation: 'replace', path: patch.path, value: previous } : { operation: 'remove', path: patch.path }
}

function targetBase(document: WorldDocument, target: StablePatchTarget): { path: string; kind: keyof Pick<AppliedWorldTransaction, 'affectedEntities' | 'affectedMaterials' | 'affectedAssets' | 'affectedPrefabs' | 'affectedCameras'>; id: string } {
  if ('componentId' in target) {
    const entityId = target.entityId
    const locations = entityId ? [findEntityLocation(document, entityId)].filter(Boolean) : []
    if (!locations.length && !entityId) {
      const matches: Array<{ path: string; entityId: string; index: number }> = []
      const visit = (entities: WorldDocument['entities'] = []): void => {
        for (const entity of entities ?? []) {
          const location = findEntityLocation(document, entity.id)
          const index = (entity.components ?? []).findIndex((component) => component.id === target.componentId)
          if (location && index >= 0) matches.push({ path: location.path, entityId: entity.id, index })
          visit(entity.children)
        }
      }
      visit(document.entities)
      for (const floor of document.building?.floors ?? []) for (const room of floor.rooms) visit(room.entities)
      if (matches.length === 0) throw new Error(`Stable patch target component "${target.componentId}" was not found.`)
      if (matches.length > 1) throw new Error(`Stable patch target component "${target.componentId}" is ambiguous; include entityId.`)
      const match = matches[0] as { path: string; entityId: string; index: number }
      return { path: `${match.path}/components/${match.index}`, kind: 'affectedEntities', id: match.entityId }
    }
    const location = locations[0]
    if (!location) throw new Error(`Stable patch target entity "${entityId}" was not found.`)
    const index = (location.entity.components ?? []).findIndex((component) => component.id === target.componentId)
    if (index < 0) throw new Error(`Component "${target.componentId}" was not found on entity "${entityId}".`)
    return { path: `${location.path}/components/${index}`, kind: 'affectedEntities', id: location.entity.id }
  }
  if ('entityId' in target || 'authoringId' in target) {
    const id = 'entityId' in target ? target.entityId : target.authoringId
    const location = findEntityLocation(document, id)
    if (!location) throw new Error(`Stable patch target entity "${id}" was not found.`)
    return { path: location.path, kind: 'affectedEntities', id: location.entity.id }
  }
  if ('materialId' in target) return { path: pointerForObjectKey('/materials', target.materialId), kind: 'affectedMaterials', id: target.materialId }
  if ('assetId' in target) return { path: pointerForObjectKey('/assets', target.assetId), kind: 'affectedAssets', id: target.assetId }
  if ('prefabId' in target) return { path: pointerForObjectKey('/prefabs', target.prefabId), kind: 'affectedPrefabs', id: target.prefabId }
  if ('cameraId' in target) return { path: pointerForObjectKey('/cameras', target.cameraId), kind: 'affectedCameras', id: target.cameraId }
  throw new Error('Unsupported stable patch target.')
}

function joinPointer(base: string, relative?: string): string {
  if (!relative || relative === '/') return base
  if (!relative.startsWith('/')) throw new Error(`Stable patch relative path "${relative}" must start with "/".`)
  return `${base}${relative}`
}

function operationPatch(document: WorldDocument, operation: StablePatchOperation): { patches: WorldPatch[]; test?: { path: string; value: unknown }; affected: ReturnType<typeof targetBase> } {
  const affected = targetBase(document, operation.target)
  const path = joinPointer(affected.path, operation.path)
  if (operation.op === 'test') return { patches: [], test: { path, value: operation.value }, affected }
  if (operation.op === 'move') {
    if (!operation.from) throw new Error('Stable move operations require a relative from path.')
    const from = joinPointer(affected.path, operation.from)
    const value = getValueAtPointer(document, from)
    if (value === undefined) throw new Error(`Move source "${from}" does not exist.`)
    return { patches: [{ operation: 'remove', path: from }, { operation: 'add', path, value: cloneValue(value) }], affected }
  }
  const patches: WorldPatch[] = []
  if (operation.op === 'add' && (!operation.path || operation.path === '/')) {
    const parentPath = affected.path.slice(0, affected.path.lastIndexOf('/'))
    if (parentPath && getValueAtPointer(document, parentPath) === undefined) {
      patches.push({ operation: 'add', path: parentPath, value: {} })
    }
  }
  patches.push({ operation: operation.op, path, value: operation.value } as WorldPatch)
  return { patches, affected }
}

export function applyStableTransaction(document: WorldDocument, transaction: WorldTransaction): AppliedWorldTransaction {
  if (!transaction.id.trim()) throw new Error('World transaction id must not be empty.')
  const currentRevision = document.revision ?? 0
  if (transaction.baseRevision !== currentRevision) throw new Error(`Stale world transaction "${transaction.id}": expected base revision ${currentRevision}, received ${transaction.baseRevision}.`)
  if (!transaction.operations.length) throw new Error('World transaction must contain at least one operation.')
  const next = cloneWorldDocument(document)
  const forward: WorldPatch[] = []
  const inverse: WorldPatch[] = []
  const diagnostics: PatchDiagnostic[] = []
  const result: AppliedWorldTransaction = {
    document: next, forward, inverse, diagnostics,
    affectedEntities: new Set(), affectedMaterials: new Set(), affectedAssets: new Set(), affectedPrefabs: new Set(), affectedCameras: new Set(),
  }
  transaction.operations.forEach((operation, operationIndex) => {
    const normalized = operationPatch(next, operation)
    result[normalized.affected.kind].add(normalized.affected.id)
    if (normalized.test) {
      const actual = getValueAtPointer(next, normalized.test.path)
      const equal = actual === undefined || normalized.test.value === undefined
        ? actual === normalized.test.value
        : JSON.stringify(canonicalizeJson(actual)) === JSON.stringify(canonicalizeJson(normalized.test.value))
      if (!equal) throw new Error(`Transaction test failed at "${normalized.test.path}".`)
      diagnostics.push({ severity: 'info', code: 'PATCH_TEST_PASSED', message: `Test passed at ${normalized.test.path}.`, operationIndex, path: normalized.test.path })
      return
    }
    for (const patch of normalized.patches) {
      inverse.unshift(applyJsonPatchValue(next, patch))
      forward.push(patch)
    }
  })
  next.revision = transaction.revision ?? currentRevision + 1
  if (!Number.isSafeInteger(next.revision) || next.revision <= currentRevision) throw new Error('Transaction revision must increase monotonically.')
  return result
}
