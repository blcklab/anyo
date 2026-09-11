import type { Aabb, CompileAccumulator, CompiledEntityNode, CompiledWorld, WorldPlugin } from './types.js'
import { aabbFromTransformedSize, mergeAabb } from '../math/aabb.js'
import { compileWorldChannels } from './architecture.js'

export function createCompileAccumulator(): CompileAccumulator {
  return {
    entities: [],
    primitives: [],
    materials: [],
    colliders: [],
    portals: [],
    rooms: [],
    triggers: [],
    cameras: [],
  }
}

function assertUniqueIds<T extends { id: string }>(items: readonly T[], label: string): void {
  const ids = new Set<string>()
  for (const item of items) {
    if (!item.id?.trim()) throw new Error(`Compiled ${label} contains an empty id.`)
    if (ids.has(item.id)) throw new Error(`Compiled ${label} id "${item.id}" is duplicated.`)
    ids.add(item.id)
  }
}

function computeEntityBounds(
  entity: CompiledEntityNode,
  entityById: Map<string, CompiledEntityNode>,
  primitiveById: Map<string, CompileAccumulator['primitives'][number]>,
  visiting: Set<string>,
): Aabb | undefined {
  if (entity.bounds) return entity.bounds
  if (visiting.has(entity.id)) throw new Error(`Compiled entity hierarchy contains a cycle at "${entity.id}".`)
  visiting.add(entity.id)
  let bounds: Aabb | undefined
  for (const primitiveId of entity.primitiveIds) {
    const primitive = primitiveById.get(primitiveId)
    if (!primitive) continue
    const primitiveBounds = primitive.bounds ?? (primitive.size ? aabbFromTransformedSize(primitive.transform, primitive.size) : undefined)
    if (primitiveBounds) {
      primitive.bounds = primitiveBounds
      bounds = bounds ? mergeAabb(bounds, primitiveBounds) : primitiveBounds
    }
  }
  for (const childId of entity.childIds) {
    const child = entityById.get(childId)
    if (!child) continue
    const childBounds = computeEntityBounds(child, entityById, primitiveById, visiting)
    if (childBounds) bounds = bounds ? mergeAabb(bounds, childBounds) : childBounds
  }
  visiting.delete(entity.id)
  entity.bounds = bounds
  return bounds
}

export function finalizeCompiledWorld(output: CompileAccumulator): CompiledWorld {
  assertUniqueIds(output.entities, 'entity')
  assertUniqueIds(output.primitives, 'primitive')
  assertUniqueIds(output.materials, 'material')
  assertUniqueIds(output.colliders, 'collider')
  assertUniqueIds(output.portals, 'portal')
  assertUniqueIds(output.rooms, 'room chunk')
  assertUniqueIds(output.triggers, 'trigger')
  assertUniqueIds(output.cameras, 'camera')

  const primitiveById = new Map(output.primitives.map((item) => [item.id, item]))
  const materialById = new Map(output.materials.map((item) => [item.id, item]))
  const colliderById = new Map(output.colliders.map((item) => [item.id, item]))
  const roomById = new Map(output.rooms.map((item) => [item.roomId, item]))
  const entityById = new Map(output.entities.map((item) => [item.id, item]))
  const entityByAuthoringId = new Map(output.entities.map((item) => [item.authoringId, item]))
  const cameraById = new Map(output.cameras.map((item) => [item.id, item]))

  if (roomById.size !== output.rooms.length) throw new Error('Compiled roomId values must be unique.')
  if (entityByAuthoringId.size !== output.entities.length) throw new Error('Compiled authoring identities must be unique.')

  for (const entity of output.entities) computeEntityBounds(entity, entityById, primitiveById, new Set())

  return {
    version: 1,
    units: 'meters',
    entities: output.entities,
    primitives: output.primitives,
    materials: output.materials,
    colliders: output.colliders,
    portals: output.portals,
    rooms: output.rooms,
    triggers: output.triggers,
    cameras: output.cameras,
    activeCameraId: output.activeCameraId,
    channels: output.channels ?? compileWorldChannels(),
    revision: output.revision ?? 0,
    cameraById,
    primitiveById,
    colliderById,
    materialById,
    roomById,
    entityById,
    entityByAuthoringId,
  }
}

export function assertUniquePluginNames(plugins: WorldPlugin[]): void {
  const names = new Set<string>()
  for (const plugin of plugins) {
    if (!plugin.name?.trim()) throw new Error('Anyo plugins must provide a non-empty name.')
    if (names.has(plugin.name)) throw new Error(`Duplicate Anyo plugin name: ${plugin.name}`)
    names.add(plugin.name)
  }
}
