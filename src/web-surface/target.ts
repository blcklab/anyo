import type {
  CompiledComponent,
  CompiledEntityNode,
  CompiledPrimitive,
  CompiledRoomChunk,
  CompiledWebSurfaceTarget,
  CompiledWorld,
  Size2,
  WebSurfaceHostSlotDefinition,
  WebSurfaceTarget,
} from '../core/types.js'

export type WebSurfaceTargetReference = '$self' | '$parent' | `$self/${string}` | `$parent/${string}` | string

export interface ResolvedWebSurfaceHostSlot extends WebSurfaceHostSlotDefinition {
  readonly entityId: string
  readonly slot: string
  readonly uvSet: number
}

export type WebSurfaceTargetResolution =
  | {
      readonly resolved: true
      readonly kind: 'plane'
      readonly target: Extract<CompiledWebSurfaceTarget, { type: 'plane' }>
      readonly primitive: CompiledPrimitive
    }
  | {
      readonly resolved: true
      readonly kind: 'wall'
      readonly target: Extract<CompiledWebSurfaceTarget, { type: 'wall' }>
      readonly room: CompiledRoomChunk
    }
  | {
      readonly resolved: true
      readonly kind: 'entity-slot'
      readonly target: Extract<CompiledWebSurfaceTarget, { type: 'entity-slot' }>
      readonly entity: CompiledEntityNode
      readonly slot: ResolvedWebSurfaceHostSlot
    }
  | {
      readonly resolved: true
      readonly kind: 'mesh'
      readonly target: Extract<CompiledWebSurfaceTarget, { type: 'mesh' }>
      readonly entity: CompiledEntityNode
    }
  | {
      readonly resolved: false
      readonly kind: CompiledWebSurfaceTarget['type']
      readonly target: CompiledWebSurfaceTarget
      readonly code:
        | 'WEB_SURFACE_TARGET_ROOM_NOT_FOUND'
        | 'WEB_SURFACE_TARGET_ENTITY_NOT_FOUND'
        | 'WEB_SURFACE_TARGET_HOST_MISSING'
        | 'WEB_SURFACE_TARGET_SLOT_NOT_FOUND'
      readonly message: string
      readonly details: Readonly<Record<string, unknown>>
    }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function surfaceHostComponent(entity: CompiledEntityNode): CompiledComponent | undefined {
  return entity.components?.find((component) => component.enabled && component.type === 'anyo.surface-host')
}

function slotFromComponent(
  component: CompiledComponent,
  entityId: string,
  slotName: string,
): ResolvedWebSurfaceHostSlot | null {
  const slots = component.data.slots
  if (!isRecord(slots)) return null
  const value = slots[slotName]
  if (!isRecord(value)) return null
  const mesh = value.mesh
  const materialSlot = value.materialSlot
  const uvSet = value.uvSet
  if (typeof mesh !== 'string' || !mesh.trim()) return null
  if (!Number.isInteger(materialSlot) || Number(materialSlot) < 0) return null
  if (uvSet !== undefined && (!Number.isInteger(uvSet) || Number(uvSet) < 0)) return null
  return Object.freeze({
    entityId,
    slot: slotName,
    mesh,
    materialSlot: Number(materialSlot),
    uvSet: uvSet === undefined ? 0 : Number(uvSet),
  })
}

/** Resolve `$self` and `$parent` without leaking authoring-only aliases into compiled worlds. */
export function resolveWebSurfaceTargetEntity(
  reference: WebSurfaceTargetReference,
  entityId: string,
  parentId?: string,
): string | null {
  if (reference === '$self') return entityId
  if (reference === '$parent') return parentId ?? null
  if (reference.startsWith('$self/')) return `${entityId}/${reference.slice('$self/'.length)}`
  if (reference.startsWith('$parent/')) return parentId ? `${parentId}/${reference.slice('$parent/'.length)}` : null
  const normalized = reference.trim()
  return normalized || null
}

/** Normalize an optional authoring target while preserving the legacy plane size contract. */
export function compileWebSurfaceTarget(
  target: WebSurfaceTarget | undefined,
  fallbackSize: Size2,
  entityId: string,
  parentId?: string,
): CompiledWebSurfaceTarget {
  if (!target || target.type === 'plane') {
    const size = target?.size ?? fallbackSize
    return Object.freeze({ type: 'plane', size: Object.freeze([size[0], size[1]]) as Size2 })
  }
  if (target.type === 'wall') {
    return Object.freeze({
      type: 'wall',
      room: target.room,
      wall: target.wall,
      offset: target.offset ? Object.freeze([target.offset[0], target.offset[1]]) as Size2 : undefined,
    })
  }
  const resolvedEntity = resolveWebSurfaceTargetEntity(target.entity, entityId, parentId)
  if (target.type === 'entity-slot') {
    return Object.freeze({ type: 'entity-slot', entity: resolvedEntity ?? target.entity, slot: target.slot })
  }
  return Object.freeze({
    type: 'mesh',
    entity: resolvedEntity ?? target.entity,
    mesh: target.mesh,
    materialSlot: target.materialSlot,
    uvSet: target.uvSet,
  })
}

/** Read one validated named screen slot from a compiled surface-host entity. */
export function getWebSurfaceHostSlot(
  compiled: Pick<CompiledWorld, 'entityById'>,
  entityId: string,
  slotName: string,
): ResolvedWebSurfaceHostSlot | null {
  const entity = compiled.entityById.get(entityId)
  if (!entity) return null
  const component = surfaceHostComponent(entity)
  if (!component) return null
  return slotFromComponent(component, entityId, slotName)
}

/**
 * Resolve renderer-neutral target references only. This does not allocate GPU resources,
 * mutate materials, or require a renderer implementation.
 */
export function resolveWebSurfaceTarget(
  compiled: Pick<CompiledWorld, 'entityById' | 'roomById'>,
  primitive: CompiledPrimitive & { webSurface: { target?: CompiledWebSurfaceTarget } },
): WebSurfaceTargetResolution {
  const target = primitive.webSurface.target ?? {
    type: 'plane',
    size: [primitive.size?.[0] ?? 2, primitive.size?.[1] ?? 1] as Size2,
  }
  if (target.type === 'plane') return { resolved: true, kind: 'plane', target, primitive }
  if (target.type === 'wall') {
    const room = compiled.roomById.get(target.room)
    if (room) return { resolved: true, kind: 'wall', target, room }
    return {
      resolved: false,
      kind: 'wall',
      target,
      code: 'WEB_SURFACE_TARGET_ROOM_NOT_FOUND',
      message: `Web-surface target room "${target.room}" is not present in the compiled world.`,
      details: { room: target.room, wall: target.wall },
    }
  }
  const entity = compiled.entityById.get(target.entity)
  if (!entity) {
    return {
      resolved: false,
      kind: target.type,
      target,
      code: 'WEB_SURFACE_TARGET_ENTITY_NOT_FOUND',
      message: `Web-surface target entity "${target.entity}" is not present in the compiled world.`,
      details: { entity: target.entity },
    }
  }
  if (target.type === 'mesh') return { resolved: true, kind: 'mesh', target, entity }
  const component = surfaceHostComponent(entity)
  if (!component) {
    return {
      resolved: false,
      kind: 'entity-slot',
      target,
      code: 'WEB_SURFACE_TARGET_HOST_MISSING',
      message: `Web-surface target entity "${target.entity}" does not declare an enabled anyo.surface-host component.`,
      details: { entity: target.entity, slot: target.slot },
    }
  }
  const slot = slotFromComponent(component, target.entity, target.slot)
  if (!slot) {
    return {
      resolved: false,
      kind: 'entity-slot',
      target,
      code: 'WEB_SURFACE_TARGET_SLOT_NOT_FOUND',
      message: `Web-surface target slot "${target.slot}" is not declared by entity "${target.entity}".`,
      details: { entity: target.entity, slot: target.slot },
    }
  }
  return { resolved: true, kind: 'entity-slot', target, entity, slot }
}
