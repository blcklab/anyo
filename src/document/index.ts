import type { EntityDefinition, WorldDocument } from '../core/types.js'
import { canonicalizeWorldDocument } from './canonical.js'
import { hasOwn, parseJsonPointer } from '../schema/safePath.js'

export interface SerializeWorldOptions {
  indentation?: number
  stableOrder?: boolean
}

export interface EntityLocation {
  entity: EntityDefinition
  path: string
  parentEntity: EntityDefinition | null
  parentPath: string | null
  container: EntityDefinition[]
  index: number
  roomId?: string
}

export function cloneWorldDocument(document: WorldDocument): WorldDocument {
  try {
    return structuredClone(document)
  } catch (error) {
    // Frameworks such as Vue can wrap a valid world document in a reactive
    // Proxy. The browser structured-clone algorithm intentionally rejects
    // Proxy objects, even when every property is JSON-safe. Rebuild the
    // document as plain arrays and objects so runtime/editor callers receive
    // an isolated portable copy without taking a framework dependency.
    try {
      return stableValue(document) as WorldDocument
    } catch {
      throw error
    }
  }
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function findEntityInList(entities: EntityDefinition[], id: string): EntityDefinition | null {
  for (const entity of entities) {
    if (entity.id === id || entity.authoringId === id) return entity
    const child = entity.children ? findEntityInList(entity.children, id) : null
    if (child) return child
  }
  return null
}

function findLocationInList(
  entities: EntityDefinition[],
  id: string,
  basePath: string,
  parentEntity: EntityDefinition | null,
  parentPath: string | null,
  roomId?: string,
): EntityLocation | null {
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index] as EntityDefinition
    const path = `${basePath}/${index}`
    if (entity.id === id || entity.authoringId === id) {
      return { entity, path, parentEntity, parentPath, container: entities, index, roomId }
    }
    const child = entity.children
      ? findLocationInList(entity.children, id, `${path}/children`, entity, path, roomId)
      : null
    if (child) return child
  }
  return null
}

export function findEntityLocation(document: WorldDocument, id: string): EntityLocation | null {
  const direct = findLocationInList(document.entities ?? [], id, '/entities', null, null)
  if (direct) return direct
  for (let floorIndex = 0; floorIndex < (document.building?.floors.length ?? 0); floorIndex += 1) {
    const floor = document.building?.floors[floorIndex]
    if (!floor) continue
    for (let roomIndex = 0; roomIndex < floor.rooms.length; roomIndex += 1) {
      const room = floor.rooms[roomIndex]
      if (!room) continue
      const found = findLocationInList(
        room.entities ?? [],
        id,
        `/building/floors/${floorIndex}/rooms/${roomIndex}/entities`,
        null,
        null,
        room.id,
      )
      if (found) return found
    }
  }
  return null
}

export function findEntityInDocument(document: WorldDocument, id: string): EntityDefinition | null {
  return findEntityLocation(document, id)?.entity ?? null
}

export function getValueAtPointer(root: unknown, pointer: string): unknown {
  const parts = parseJsonPointer(pointer)
  let value = root
  for (const part of parts) {
    if (Array.isArray(value)) {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0 || index >= value.length) return undefined
      value = value[index]
    } else if (value && typeof value === 'object' && hasOwn(value, part)) {
      value = (value as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return value
}

export function ensureEntityAuthoringId(entity: EntityDefinition, prefix = 'entity'): string {
  if (entity.authoringId?.trim()) return entity.authoringId
  const safe = entity.id.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'node'
  let hash = 0x811c9dc5
  const input = `${prefix}:${entity.id}`
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  entity.authoringId = `${prefix}:${safe}:${(hash >>> 0).toString(36)}`
  return entity.authoringId
}

export function collectEntityIds(entities: readonly EntityDefinition[], output = new Set<string>()): Set<string> {
  for (const entity of entities) {
    output.add(entity.id)
    if (entity.authoringId) output.add(entity.authoringId)
    collectEntityIds(entity.children ?? [], output)
  }
  return output
}

export function createUniqueEntityId(base: string, used: ReadonlySet<string>): string {
  const safe = base.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'entity'
  if (!used.has(safe)) return safe
  let index = 2
  while (used.has(`${safe}-${index}`)) index += 1
  return `${safe}-${index}`
}

export function entityPathLabel(location: EntityLocation): string {
  return location.parentEntity ? `${location.parentEntity.id}/${location.entity.id}` : location.entity.id
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key]
    if (child !== undefined) result[key] = stableValue(child)
  }
  return result
}

export function serializeWorldDocument(
  document: WorldDocument,
  options: SerializeWorldOptions = {},
): string {
  const indentation = Math.max(0, Math.min(10, options.indentation ?? 2))
  const value = options.stableOrder ?? true ? canonicalizeWorldDocument(document) : document
  return `${JSON.stringify(value, null, indentation)}\n`
}

export function pointerForEntityChild(parentPath: string, index: number): string {
  return `${parentPath}/children/${index}`
}

export function pointerForObjectKey(base: string, key: string): string {
  return `${base}/${escapePointer(key)}`
}

export { canonicalizeJson, canonicalizeWorldDocument, canonicalWorldString, hashWorldDocument } from './canonical.js'
export type { CanonicalizeWorldOptions } from './canonical.js'
