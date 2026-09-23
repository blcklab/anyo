import type {
  CompileAccumulator,
  CompiledCollider,
  CompiledPrimitive,
  EntityDefinition,
  NormalizedEntityDefinition,
  NormalizedFloor,
  NormalizedRoom,
  NormalizedWorldDocument,
  Size3,
  Vec3,
} from '../core/types.js'
import { resolveEntityComponents, type ComponentTypeRegistry, type UnknownComponentPolicy } from '../components/index.js'
import { aabbFromTransformedSize } from '../math/aabb.js'
import {
  composeTransforms,
  createTransform,
  finalizeTransform,
  normalizeScale,
  type ComposableTransform,
} from '../math/transform.js'
import { resolveSurfaceTransform } from './surface.js'
import type { EntityTypeRegistry } from './registry.js'
import { compileWebSurfaceTarget, resolveWebSurfaceTarget } from '../web-surface/target.js'
import { compileWorldChannels, resolveChannelMask } from '../core/architecture.js'
import { resourceGraphModelAsset } from '../core/resourceAssetPolicy.js'

const BUILTIN_TYPES = new Set([
  'box', 'plane', 'cylinder', 'disc', 'cone', 'sphere', 'text', 'image', 'model', 'light', 'group', 'trigger', 'audio', 'portal', 'web-surface', 'geometry', 'construction',
])

export interface CompileEntitiesOptions {
  registry?: EntityTypeRegistry
  componentRegistry?: ComponentTypeRegistry
  unknownComponents?: UnknownComponentPolicy
  warn?: (message: string) => void
}

function locateRoom(document: NormalizedWorldDocument, roomId?: string): { floor: NormalizedFloor; room: NormalizedRoom } | null {
  if (!roomId) return null
  for (const floor of document.building.floors) {
    const room = floor.rooms.find((candidate) => candidate.id === roomId)
    if (room) return { floor, room }
  }
  return null
}

function multiplyVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

function assetScale(entity: EntityDefinition, document: NormalizedWorldDocument): Vec3 {
  const raw = entity.asset ? document.assets[entity.asset]?.scale : undefined
  return normalizeScale(raw)
}

interface ResolvedEntityTransforms {
  local: ComposableTransform
  world: ComposableTransform
}

function resolveEntityTransforms(
  entity: EntityDefinition,
  document: NormalizedWorldDocument,
  parent: ComposableTransform | null,
): ResolvedEntityTransforms {
  const ownScale = multiplyVec3(normalizeScale(entity.scale), assetScale(entity, document))
  const local = entity.surface
    ? (() => {
        const surface = resolveSurfaceTransform(entity, document)
        return createTransform(
          surface.position,
          surface.rotation,
          multiplyVec3(surface.scale, ownScale),
        )
      })()
    : createTransform(entity.position ?? [0, 0, 0], entity.rotation ?? [0, 0, 0], ownScale)

  if (parent) return { local, world: composeTransforms(parent, local) }
  if (entity.surface) return { local, world: local }

  const roomLocation = locateRoom(document, entity.room)
  if (!roomLocation) return { local, world: local }
  const roomTransform = createTransform([
    roomLocation.room.position[0],
    roomLocation.floor.elevation,
    roomLocation.room.position[1],
  ])
  return { local, world: composeTransforms(roomTransform, local) }
}

function getSize(entity: EntityDefinition): Size3 {
  if (entity.type === 'web-surface' && entity.webSurface?.target?.type === 'plane' && entity.webSurface.target.size) {
    return [entity.webSurface.target.size[0], entity.webSurface.target.size[1], 0.02]
  }
  if (entity.type === 'cylinder' || entity.type === 'cone') {
    const diameter = (entity.radius ?? 0.5) * 2
    return [diameter, entity.height ?? 1, diameter]
  }
  if (entity.type === 'disc') {
    const diameter = (entity.radius ?? 0.5) * 2
    return [diameter, entity.height ?? 0.04, diameter]
  }
  if (entity.type === 'sphere') {
    const diameter = (entity.radius ?? 0.5) * 2
    return [diameter, diameter, diameter]
  }
  if (entity.type === 'text') {
    const size = entity.size ?? [3, 1]
    return [size[0] ?? 3, size[1] ?? 1, 0.02]
  }
  if (entity.type === 'image' || entity.type === 'plane' || entity.type === 'portal' || entity.type === 'web-surface') {
    const size = entity.size ?? [2, 1]
    return [size[0] ?? 2, size[1] ?? 1, 0.02]
  }
  const size = entity.size ?? [1, 1, 1]
  return [size[0] ?? 1, size[1] ?? 1, size[2] ?? 1]
}

function primitiveKind(entity: EntityDefinition): CompiledPrimitive['kind'] | null {
  if (entity.type === 'group' || entity.type === 'trigger') return null
  if (entity.type === 'portal') return 'plane'
  if (entity.type === 'web-surface') {
    const source = entity.webSurface?.source
    return source?.type === 'snapshot' || entity.webSurface?.fallback ? 'image' : 'plane'
  }
  if (
    entity.type === 'box' || entity.type === 'plane' || entity.type === 'cylinder' ||
    entity.type === 'disc' || entity.type === 'cone' || entity.type === 'sphere' ||
    entity.type === 'text' || entity.type === 'image' || entity.type === 'model' ||
    entity.type === 'light' || entity.type === 'audio'
  ) return entity.type
  return null
}

function resolvedString(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function resolvedNumber(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined }
function resolvedBoolean(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback }

function resolveSource(entity: EntityDefinition, document: NormalizedWorldDocument): string | undefined {
  if (entity.type === 'web-surface' && entity.webSurface) {
    if (entity.webSurface.source.type === 'snapshot') return entity.webSurface.source.image
    return entity.webSurface.fallback?.image
  }
  const direct = resolvedString(entity.src)
  if (direct) return direct
  if (!entity.asset) return undefined
  return resolvedString(document.assets[entity.asset]?.src)
}

function addToRoomChunk(output: CompileAccumulator, roomId: string | undefined, primitiveId?: string, colliderId?: string): void {
  if (!roomId) return
  const chunk = output.rooms.find((candidate) => candidate.roomId === roomId)
  if (!chunk) return
  if (primitiveId) chunk.primitiveIds.push(primitiveId)
  if (colliderId) chunk.colliderIds.push(colliderId)
}

function unsupportedEntityError(entity: EntityDefinition, sourcePath: string): Error {
  return new Error([
    'ANYO_ENTITY_TYPE_UNSUPPORTED',
    `Entity: ${entity.id}`,
    `Type: ${entity.type ?? '(missing)'}`,
    `Source: ${sourcePath}`,
  ].join('\n'))
}

const CARDINAL_WALLS = new Set(['north', 'south', 'east', 'west'])

function wallTargetSurface(entity: EntityDefinition): EntityDefinition['surface'] | undefined {
  const target = entity.type === 'web-surface' ? entity.webSurface?.target : undefined
  if (!target || target.type !== 'wall' || !CARDINAL_WALLS.has(target.wall)) return entity.surface
  return {
    room: target.room,
    wall: target.wall as 'north' | 'south' | 'east' | 'west',
    offset: target.offset,
  }
}

function compileEntity(
  entity: NormalizedEntityDefinition,
  document: NormalizedWorldDocument,
  output: CompileAccumulator,
  parent: ComposableTransform | null,
  options: CompileEntitiesOptions,
  inheritedRoom?: string,
  sourcePath = '/entities',
  parentId?: string,
  inheritedVisible = true,
): void {
  const target = entity.type === 'web-surface' ? entity.webSurface?.target : undefined
  const roomId = entity.room ?? entity.surface?.room ?? (target?.type === 'wall' ? target.room : undefined) ?? inheritedRoom
  const surface = wallTargetSurface(entity)
  const resolved = resolveEntityTransforms({ ...entity, room: roomId, surface }, document, parent)
  const transform = finalizeTransform(resolved.world)
  const localTransform = finalizeTransform(resolved.local)
  const size = getSize(entity)
  const resolvedComponents = resolveEntityComponents(entity, {
    registry: options.componentRegistry,
    unknown: options.unknownComponents,
    warn: options.warn,
    sourcePath,
    document,
    transform,
    size,
    roomId,
  })
  const enabled = entity.enabled ?? true
  const ownVisible = enabled && (resolvedComponents.visible ?? resolvedBoolean(entity.visible, true))
  const visible = inheritedVisible && ownVisible
  const channels = output.channels ?? compileWorldChannels(document.channels)
  output.channels ??= channels
  const authoring = entity.__authoring ?? {
    id: entity.authoringId ?? entity.id,
    sourcePath,
    editable: true,
  }
  const node = {
    id: entity.id,
    authoringId: authoring.id,
    type: entity.type ?? 'box',
    parentId,
    childIds: (entity.children ?? []).map((child) => child.id),
    transform,
    localTransform,
    components: resolvedComponents.components,
    roomId,
    sourcePath,
    authoring,
    primitiveIds: [] as string[],
    resourceInstanceIds: [] as string[],
    resourceInstanceTransforms: {} as Record<string, import('../core/types.js').TransformDefinition>,
    enabled,
    renderMask: resolveChannelMask(entity.layers, channels.render),
    pickingMask: resolveChannelMask(entity.pickLayers, channels.picking),
    editorMask: resolveChannelMask(entity.editorLayers, channels.editor),
    events: entity.events ? structuredClone(entity.events) : undefined,
  }
  output.entities.push(node)

  if (entity.type === 'group') {
    for (const [childIndex, child] of (entity.children ?? []).entries()) {
      compileEntity(child, document, output, resolved.world, options, roomId, `${sourcePath}/children/${childIndex}`, entity.id, visible)
    }
    return
  }

  const triggerDefinition = resolvedComponents.trigger
  if (triggerDefinition) {
    output.triggers.push({
      id: `trigger:${entity.id}`,
      entityId: entity.id,
      bounds: aabbFromTransformedSize(transform, triggerDefinition.size),
      roomId,
      once: triggerDefinition.once ?? false,
      onEnter: triggerDefinition.onEnter ?? [],
      onLeave: triggerDefinition.onLeave ?? [],
    })
  }
  if (entity.type === 'trigger') return
  if (entity.type === 'geometry' || entity.type === 'construction') return

  // S20: static schema-0.8 model assets are realized through ResourceGraph.
  // VRM/animated-model assets intentionally stay on the established legacy path.
  if (resourceGraphModelAsset(entity, document)) {
    if (resolvedComponents.collision) {
      const collider: CompiledCollider = {
        id: `resource-model:${entity.id}:collider`,
        bounds: aabbFromTransformedSize(transform, size),
        roomId,
        entityId: entity.id,
        enabled: true,
        kind: 'solid',
      }
      output.colliders.push(collider)
      addToRoomChunk(output, roomId, undefined, collider.id)
    }
    return
  }

  const kind = primitiveKind(entity)
  if (!kind) {
    const registration = entity.type ? options.registry?.get(entity.type) : undefined
    if (!registration) throw unsupportedEntityError(entity, sourcePath)
    registration.validate?.(entity, sourcePath)
    const primitiveStart = output.primitives.length
    registration.compile({ entity, document, output, transform, size, roomId, sourcePath, parentId, components: resolvedComponents })
    node.primitiveIds.push(...output.primitives.slice(primitiveStart).map((primitive) => primitive.id))
    for (const primitive of output.primitives.slice(primitiveStart)) {
      primitive.authoring ??= authoring
      primitive.renderMask ??= node.renderMask
      primitive.pickingMask ??= node.pickingMask
      primitive.editorMask ??= node.editorMask
      primitive.bounds ??= primitive.size ? aabbFromTransformedSize(primitive.transform, primitive.size) : undefined
    }
    return
  }

  const asset = entity.asset ? document.assets[entity.asset] : undefined
  const primitive: CompiledPrimitive = {
    id: `entity:${entity.id}`,
    kind,
    transform,
    size,
    radius: entity.radius,
    height: entity.height,
    material: entity.material,
    roomId,
    entityId: entity.id,
    src: resolveSource(entity, document),
    assetId: entity.asset,
    assetType: asset?.type,
    assetFormat: asset?.format,
    text: resolvedString(entity.content),
    lightType: entity.lightType,
    color: resolvedString(entity.color),
    intensity: resolvedNumber(entity.intensity),
    range: resolvedNumber(entity.range),
    decay: resolvedNumber(entity.decay),
    castShadow: resolvedBoolean(entity.castShadow, entity.type === 'light' ? false : true),
    receiveShadow: resolvedBoolean(entity.receiveShadow, true),
    shadow: entity.shadow,
    collision: resolvedComponents.collision,
    visible,
    renderMask: node.renderMask,
    pickingMask: node.pickingMask,
    editorMask: node.editorMask,
    interaction: resolvedComponents.interaction,
    components: resolvedComponents.components,
    audio: resolvedComponents.audio,
    lod: resolvedComponents.lod ?? asset?.lod,
    style: entity.style,
    data: entity.data,
    tags: ['entity', entity.type ?? 'custom'],
    parentId,
    sourcePath,
    authoring,
    bounds: aabbFromTransformedSize(transform, size),
    static: entity.type !== 'web-surface' && !resolvedComponents.dynamic && !resolvedComponents.collision && (kind === 'box' || kind === 'plane' || kind === 'cylinder' || kind === 'disc' || kind === 'cone' || kind === 'sphere'),
    geometryKey: kind === 'box' ? 'unit-box' : kind === 'plane' ? 'unit-plane' : (kind === 'cylinder' || kind === 'disc') ? 'unit-cylinder' : kind === 'cone' ? 'unit-cone' : kind === 'sphere' ? 'unit-sphere' : undefined,
    batchKey: entity.type === 'web-surface' || resolvedComponents.dynamic ? undefined : `${roomId ?? 'world'}:${entity.material ?? '__default'}:${kind}`,
    loading: entity.loading ?? asset?.loading,
    webSurface: entity.type === 'web-surface' && entity.webSurface ? {
      source: entity.webSurface.source,
      target: compileWebSurfaceTarget(entity.webSurface.target, [size[0], size[1]], entity.id, parentId),
      renderMode: entity.webSurface.renderMode ?? (entity.webSurface.presentation?.type === 'overlay' ? 'dom-overlay' : 'auto'),
      fallback: entity.webSurface.fallback,
      framePolicy: entity.webSurface.framePolicy ?? { mode: 'on-change', maxFps: 30 },
      presentation: entity.webSurface.presentation,
      animations: entity.webSurface.animations ?? [],
      interaction: {
        pointer: entity.webSurface.interaction?.pointer ?? true,
        keyboard: entity.webSurface.interaction?.keyboard ?? false,
        scroll: entity.webSurface.interaction?.scroll ?? true,
      },
      title: entity.webSurface.title,
      className: entity.webSurface.className,
    } : undefined,
  }
  output.primitives.push(primitive)
  node.primitiveIds.push(primitive.id)
  addToRoomChunk(output, roomId, primitive.id)

  if (primitive.collision) {
    const collider: CompiledCollider = {
      id: `${primitive.id}:collider`,
      bounds: aabbFromTransformedSize(transform, size),
      roomId,
      entityId: entity.id,
      enabled: true,
      kind: 'solid',
    }
    output.colliders.push(collider)
    addToRoomChunk(output, roomId, undefined, collider.id)
  }
}

export function compileEntities(document: NormalizedWorldDocument, output: CompileAccumulator, options: CompileEntitiesOptions = {}): void {
  output.entities ??= []
  for (const [index, entity] of document.entities.entries()) {
    if (entity.type && !BUILTIN_TYPES.has(entity.type) && !options.registry?.has(entity.type)) {
      throw unsupportedEntityError(entity, `/entities/${index}`)
    }
    compileEntity(entity, document, output, null, options, undefined, `/entities/${index}`)
  }

  const entityById = new Map(output.entities.map((entity) => [entity.id, entity]))
  const roomById = new Map(output.rooms.map((room) => [room.roomId, room]))
  for (const primitive of output.primitives) {
    if (!primitive.webSurface) continue
    const resolution = resolveWebSurfaceTarget({ entityById, roomById }, primitive as CompiledPrimitive & { webSurface: NonNullable<CompiledPrimitive['webSurface']> })
    if (!resolution.resolved) {
      options.warn?.([resolution.code, `Entity: ${primitive.entityId ?? primitive.id}`, resolution.message].join('\n'))
    }
  }
}
