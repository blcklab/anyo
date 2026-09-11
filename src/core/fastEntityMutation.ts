import { getValueAtPointer } from '../document/index.js'
import { aabbFromTransformedSize, mergeAabb } from '../math/aabb.js'
import { composeTransforms, createTransform, finalizeTransform, normalizeScale } from '../math/transform.js'
import { hasOwn, parseJsonPointer } from '../schema/safePath.js'
import type {
  CompiledEntityNode,
  CompiledPrimitive,
  CompiledWorld,
  EntityDefinition,
  NormalizedEntityDefinition,
  NormalizedWorldDocument,
  Vec3,
  WorldChange,
  WorldDocument,
  WorldPatch,
} from './types.js'

export type FastEntityProperty = 'position' | 'rotation' | 'scale' | 'visible'

export interface FastEntityMutation {
  property: FastEntityProperty
  operation: 'set' | 'remove'
  value?: unknown
}

export interface FastEntityMutationResult {
  sourceDocument: WorldDocument
  document: NormalizedWorldDocument
  compiled: CompiledWorld
  changes: WorldChange[]
  forward: WorldPatch[]
  inverse: WorldPatch[]
  entity: EntityDefinition
}

const FAST_ENTITY_TYPES = new Set([
  undefined,
  'box',
  'plane',
  'cylinder',
  'text',
  'image',
  'model',
  'light',
  'audio',
  'web-surface',
])

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function cloneContainer(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice()
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) }
  throw new Error('Cannot clone a non-container JSON pointer segment.')
}

function replaceAtPointer<T>(root: T, pointer: string, replacement: unknown): T {
  const parts = parseJsonPointer(pointer)
  if (parts.length === 0) return replacement as T

  const nextRoot = cloneContainer(root) as T
  let original: unknown = root
  let cloned: unknown = nextRoot

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index] as string
    if (Array.isArray(original) && Array.isArray(cloned)) {
      const childIndex = Number(part)
      if (!Number.isInteger(childIndex) || childIndex < 0 || childIndex >= original.length) {
        throw new Error(`Cannot resolve JSON pointer "${pointer}".`)
      }
      const child = cloneContainer(original[childIndex])
      cloned[childIndex] = child
      original = original[childIndex]
      cloned = child
      continue
    }
    if (original && typeof original === 'object' && cloned && typeof cloned === 'object') {
      if (!hasOwn(original, part)) throw new Error(`Cannot resolve JSON pointer "${pointer}".`)
      const child = cloneContainer((original as Record<string, unknown>)[part])
      ;(cloned as Record<string, unknown>)[part] = child
      original = (original as Record<string, unknown>)[part]
      cloned = child
      continue
    }
    throw new Error(`Cannot resolve JSON pointer "${pointer}".`)
  }

  const key = parts.at(-1) as string
  if (Array.isArray(cloned)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= cloned.length) throw new Error(`Cannot resolve JSON pointer "${pointer}".`)
    cloned[index] = replacement
  } else if (cloned && typeof cloned === 'object') {
    ;(cloned as Record<string, unknown>)[key] = replacement
  } else {
    throw new Error(`Cannot resolve JSON pointer "${pointer}".`)
  }
  return nextRoot
}

function finiteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function validScale(value: unknown): value is number | Vec3 {
  return (typeof value === 'number' && Number.isFinite(value)) || finiteVec3(value)
}

function validateMutation(mutation: FastEntityMutation): boolean {
  if (mutation.operation === 'remove') return true
  switch (mutation.property) {
    case 'position':
    case 'rotation':
      return finiteVec3(mutation.value)
    case 'scale':
      return validScale(mutation.value)
    case 'visible':
      return typeof mutation.value === 'boolean'
  }
}

function multiplyVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

function cloneMutationValue(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value)
}

function applyEntityMutations(entity: EntityDefinition, mutations: readonly FastEntityMutation[]): EntityDefinition {
  const next = structuredClone(entity)
  for (const mutation of mutations) {
    if (mutation.operation === 'remove') delete next[mutation.property]
    else (next as unknown as Record<string, unknown>)[mutation.property] = cloneMutationValue(mutation.value)
  }
  return next
}

function createPatchPairs(
  entityPath: string,
  entity: EntityDefinition,
  mutations: readonly FastEntityMutation[],
): { forward: WorldPatch[]; inverse: WorldPatch[] } {
  const forward: WorldPatch[] = []
  const inverse: WorldPatch[] = []
  for (const mutation of mutations) {
    const path = `${entityPath}/${escapePointer(mutation.property)}`
    const existed = hasOwn(entity, mutation.property)
    const previous = (entity as unknown as Record<string, unknown>)[mutation.property]
    if (mutation.operation === 'remove') {
      if (!existed) continue
      forward.push({ operation: 'remove', path })
      inverse.unshift({ operation: 'add', path, value: cloneMutationValue(previous) })
      continue
    }
    const value = cloneMutationValue(mutation.value)
    forward.push({ operation: existed ? 'replace' : 'add', path, value })
    inverse.unshift(existed
      ? { operation: 'replace', path, value: cloneMutationValue(previous) }
      : { operation: 'remove', path })
  }
  return { forward, inverse }
}

function findNormalizedEntityIndex(document: NormalizedWorldDocument, node: CompiledEntityNode): number {
  return document.entities.findIndex((entity) => (
    entity.__authoring?.sourcePath === node.sourcePath ||
    entity.__authoring?.id === node.authoringId ||
    entity.id === node.id
  ))
}

function computeTransform(entity: EntityDefinition, document: NormalizedWorldDocument, node: CompiledEntityNode) {
  const entityScale = normalizeScale(entity.scale)
  const assetScale = normalizeScale(entity.asset ? document.assets[entity.asset]?.scale : undefined)
  const local = createTransform(
    entity.position ?? [0, 0, 0],
    entity.rotation ?? [0, 0, 0],
    multiplyVec3(entityScale, assetScale),
  )

  if (node.roomId) {
    for (const floor of document.building.floors) {
      const room = floor.rooms.find((candidate) => candidate.id === node.roomId)
      if (!room) continue
      return finalizeTransform(composeTransforms(createTransform([
        room.position[0],
        floor.elevation,
        room.position[1],
      ]), local))
    }
  }
  return finalizeTransform(local)
}

function replaceCompiledEntity(
  compiled: CompiledWorld,
  node: CompiledEntityNode,
  nextEntity: CompiledEntityNode,
  primitiveUpdates: ReadonlyMap<string, CompiledPrimitive>,
): CompiledWorld {
  const entities = compiled.entities.slice()
  const entityIndex = entities.indexOf(node)
  if (entityIndex >= 0) entities[entityIndex] = nextEntity

  const primitives = compiled.primitives.slice()
  const primitiveById = new Map(compiled.primitiveById)
  for (const [id, primitive] of primitiveUpdates) {
    const previous = compiled.primitiveById.get(id)
    if (!previous) continue
    const index = primitives.indexOf(previous)
    if (index >= 0) primitives[index] = primitive
    primitiveById.set(id, primitive)
  }

  const entityById = new Map(compiled.entityById)
  const entityByAuthoringId = new Map(compiled.entityByAuthoringId)
  entityById.set(nextEntity.id, nextEntity)
  entityByAuthoringId.set(nextEntity.authoringId, nextEntity)

  return {
    ...compiled,
    entities,
    primitives,
    primitiveById,
    entityById,
    entityByAuthoringId,
  }
}

function sameMutationValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
    return left.every((value, index) => Object.is(value, right[index]))
  }
  return false
}

export function prepareFastEntityMutation(
  sourceDocument: WorldDocument,
  document: NormalizedWorldDocument,
  compiled: CompiledWorld,
  node: CompiledEntityNode,
  requestedMutations: readonly FastEntityMutation[],
): FastEntityMutationResult | null {
  if (!node.authoring.editable || node.parentId || node.childIds.length > 0 || node.primitiveIds.length === 0) return null

  const sourceEntity = getValueAtPointer(sourceDocument, node.sourcePath)
  if (!sourceEntity || typeof sourceEntity !== 'object' || Array.isArray(sourceEntity)) return null
  const entity = sourceEntity as EntityDefinition
  if (!FAST_ENTITY_TYPES.has(entity.type) || entity.surface || entity.use || entity.repeat || (entity.components?.length ?? 0) > 0) return null
  if (compiled.colliders.some((collider) => collider.entityId === node.id)) return null
  if (compiled.triggers.some((trigger) => trigger.entityId === node.id)) return null
  if (node.primitiveIds.some((id) => compiled.primitiveById.get(id)?.collision)) return null
  if (requestedMutations.some((mutation) => !validateMutation(mutation))) return null

  const mutations = requestedMutations.filter((mutation) => {
    const previous = (entity as unknown as Record<string, unknown>)[mutation.property]
    if (mutation.operation === 'remove') return hasOwn(entity, mutation.property)
    return !sameMutationValue(previous, mutation.value)
  })
  if (mutations.length === 0) {
    return {
      sourceDocument,
      document,
      compiled,
      changes: [],
      forward: [],
      inverse: [],
      entity,
    }
  }

  const normalizedIndex = findNormalizedEntityIndex(document, node)
  if (normalizedIndex < 0) return null
  const normalizedEntity = document.entities[normalizedIndex] as NormalizedEntityDefinition

  const nextSourceEntity = applyEntityMutations(entity, mutations)
  const nextNormalizedEntity = applyEntityMutations(normalizedEntity, mutations) as NormalizedEntityDefinition
  nextNormalizedEntity.__authoring = normalizedEntity.__authoring

  const sourceNext = replaceAtPointer(sourceDocument, node.sourcePath, nextSourceEntity)
  let documentNext = replaceAtPointer(document, node.sourcePath, nextNormalizedEntity)
  const normalizedEntities = documentNext.entities.slice()
  const nextNormalizedIndex = findNormalizedEntityIndex(documentNext, node)
  if (nextNormalizedIndex < 0) return null
  normalizedEntities[nextNormalizedIndex] = nextNormalizedEntity
  documentNext = { ...documentNext, entities: normalizedEntities }

  const transformChanged = mutations.some((mutation) => mutation.property === 'position' || mutation.property === 'rotation' || mutation.property === 'scale')
  const visibilityChanged = mutations.some((mutation) => mutation.property === 'visible')
  const transform = transformChanged ? computeTransform(nextNormalizedEntity, documentNext, node) : node.transform
  const visible = visibilityChanged
    ? (typeof nextNormalizedEntity.visible === 'boolean' ? nextNormalizedEntity.visible : true)
    : undefined

  const primitiveUpdates = new Map<string, CompiledPrimitive>()
  const changes: WorldChange[] = []
  let entityBounds = undefined

  for (const primitiveId of node.primitiveIds) {
    const primitive = compiled.primitiveById.get(primitiveId)
    if (!primitive) return null
    let nextPrimitive = primitive
    if (transformChanged) {
      nextPrimitive = {
        ...nextPrimitive,
        transform,
        bounds: nextPrimitive.size ? aabbFromTransformedSize(transform, nextPrimitive.size) : nextPrimitive.bounds,
      }
      changes.push({ type: 'primitive-transform', primitiveId, primitive: nextPrimitive })
    }
    if (visibilityChanged && visible !== undefined && nextPrimitive.visible !== visible) {
      nextPrimitive = { ...nextPrimitive, visible }
      changes.push({ type: 'primitive-visibility', primitiveId, visible, primitive: nextPrimitive })
    }
    primitiveUpdates.set(primitiveId, nextPrimitive)
    if (nextPrimitive.bounds) entityBounds = entityBounds ? mergeAabb(entityBounds, nextPrimitive.bounds) : nextPrimitive.bounds
  }

  const nextNode: CompiledEntityNode = {
    ...node,
    transform,
    bounds: entityBounds,
  }
  const compiledNext = replaceCompiledEntity(compiled, node, nextNode, primitiveUpdates)
  const patches = createPatchPairs(node.sourcePath, entity, mutations)

  return {
    sourceDocument: sourceNext,
    document: documentNext,
    compiled: compiledNext,
    changes,
    forward: patches.forward,
    inverse: patches.inverse,
    entity: nextSourceEntity,
  }
}
