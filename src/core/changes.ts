import type {
  CompiledPortal,
  CompiledPrimitive,
  CompiledRoomChunk,
  CompiledWorld,
  MaterialDefinition,
  NormalizedWorldDocument,
  WorldChange,
} from './types.js'

function equalValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function equalTransform(a: CompiledPrimitive, b: CompiledPrimitive): boolean {
  return equalValue(a.transform, b.transform)
}

function primitiveGeometryChanged(a: CompiledPrimitive, b: CompiledPrimitive): boolean {
  return (
    a.kind !== b.kind ||
    !equalValue(a.size, b.size) ||
    a.radius !== b.radius ||
    a.height !== b.height ||
    a.roomId !== b.roomId ||
    a.floorId !== b.floorId ||
    a.parentId !== b.parentId ||
    a.geometryKey !== b.geometryKey ||
    a.batchKey !== b.batchKey ||
    a.static !== b.static
  )
}

function primitiveContentChanged(a: CompiledPrimitive, b: CompiledPrimitive): boolean {
  return (
    a.src !== b.src ||
    a.assetId !== b.assetId ||
    a.assetType !== b.assetType ||
    a.assetFormat !== b.assetFormat ||
    a.text !== b.text ||
    a.color !== b.color ||
    a.intensity !== b.intensity ||
    a.lightType !== b.lightType ||
    a.range !== b.range ||
    a.decay !== b.decay ||
    a.castShadow !== b.castShadow ||
    a.receiveShadow !== b.receiveShadow ||
    !equalValue(a.shadow, b.shadow) ||
    a.loading !== b.loading ||
    !equalValue(a.style, b.style) ||
    !equalValue(a.data, b.data) ||
    !equalValue(a.interaction, b.interaction) ||
    !equalValue(a.components, b.components) ||
    !equalValue(a.audio, b.audio) ||
    !equalValue(a.lod, b.lod) ||
    !equalValue(a.webSurface, b.webSurface)
  )
}

function worldTopologyChanged(previous: CompiledWorld, next: CompiledWorld): string | null {
  if (!equalValue(previous.colliders.map(stripColliderState), next.colliders.map(stripColliderState))) return 'Collider topology or bounds changed.'
  if (!equalValue(previous.triggers, next.triggers)) return 'Trigger topology or bounds changed.'

  const previousRooms = previous.rooms.map(stripRoomVisibility)
  const nextRooms = next.rooms.map(stripRoomVisibility)
  if (!equalValue(previousRooms, nextRooms)) return 'Room topology or membership changed.'

  const previousPortals = previous.portals.map(stripPortalState)
  const nextPortals = next.portals.map(stripPortalState)
  if (!equalValue(previousPortals, nextPortals)) return 'Portal topology or bounds changed.'
  return null
}


function stripColliderState(collider: CompiledWorld['colliders'][number]): Omit<CompiledWorld['colliders'][number], 'enabled'> {
  const { enabled: _enabled, ...rest } = collider
  return rest
}

function stripRoomVisibility(room: CompiledRoomChunk): Omit<CompiledRoomChunk, 'visible'> {
  const { visible: _visible, ...rest } = room
  return rest
}

function stripPortalState(portal: CompiledPortal): Omit<CompiledPortal, 'open'> {
  const { open: _open, ...rest } = portal
  return rest
}

function changedMaterialIds(
  previous: NormalizedWorldDocument,
  next: NormalizedWorldDocument,
): Set<string> {
  const ids = new Set([...Object.keys(previous.materials), ...Object.keys(next.materials)])
  const changed = new Set<string>()
  for (const id of ids) {
    if (!equalValue(previous.materials[id], next.materials[id])) changed.add(id)
  }
  return changed
}


function appendArchitectureChanges(
  changes: WorldChange[],
  previous: CompiledWorld,
  next: CompiledWorld,
  previousDocument: NormalizedWorldDocument,
  nextDocument: NormalizedWorldDocument,
): void {
  const previousCameras = previous.cameraById
  for (const [id, camera] of previousCameras) {
    if (!next.cameraById.has(id)) changes.push({ type: 'camera-remove', cameraId: id })
    else if (!equalValue(camera, next.cameraById.get(id))) changes.push({ type: 'camera-update', camera: next.cameraById.get(id)! })
  }
  for (const [id, camera] of next.cameraById) if (!previousCameras.has(id)) changes.push({ type: 'camera-update', camera })
  if (previous.activeCameraId !== next.activeCameraId && next.activeCameraId) {
    changes.push({ type: 'camera-activate', cameraId: next.activeCameraId, transition: next.cameraById.get(next.activeCameraId)?.transition })
  }
  if (!equalValue(previous.channels, next.channels)) changes.push({ type: 'channels-update', channels: next.channels })
  if (!equalValue(previousDocument.rendering, nextDocument.rendering)) changes.push({ type: 'rendering-intent', rendering: nextDocument.rendering })
}

export interface WorldChangeClassification {
  changes: WorldChange[]
  incremental: boolean
  reason?: string
}

export function classifyWorldChanges(
  previous: CompiledWorld,
  next: CompiledWorld,
  previousDocument: NormalizedWorldDocument,
  nextDocument: NormalizedWorldDocument,
): WorldChangeClassification {
  if (!equalValue(previousDocument.environment, nextDocument.environment)) {
    const reason = 'Environment settings changed.'
    return { changes: [{ type: 'world-rebuild', reason }], incremental: false, reason }
  }

  const topologyReason = worldTopologyChanged(previous, next)
  if (topologyReason) {
    return { changes: [{ type: 'world-rebuild', reason: topologyReason }], incremental: false, reason: topologyReason }
  }

  const changes: WorldChange[] = []
  appendArchitectureChanges(changes, previous, next, previousDocument, nextDocument)
  const materialIds = changedMaterialIds(previousDocument, nextDocument)

  for (const [id, oldPrimitive] of previous.primitiveById) {
    if (!next.primitiveById.has(id)) changes.push({ type: 'primitive-remove', primitiveId: id })
    else {
      const primitive = next.primitiveById.get(id) as CompiledPrimitive
      if (primitiveGeometryChanged(oldPrimitive, primitive)) {
        changes.push({ type: 'primitive-replace', primitive })
        continue
      }
      if (!equalTransform(oldPrimitive, primitive)) {
        changes.push({ type: 'primitive-transform', primitiveId: id, primitive })
      }
      if (oldPrimitive.visible !== primitive.visible) {
        changes.push({ type: 'primitive-visibility', primitiveId: id, visible: primitive.visible, primitive })
      }
      if (oldPrimitive.material !== primitive.material || (primitive.material && materialIds.has(primitive.material))) {
        changes.push({ type: 'primitive-material', primitiveId: id, primitive })
      }
      if (primitiveContentChanged(oldPrimitive, primitive)) {
        changes.push({ type: 'primitive-content', primitiveId: id, primitive })
      }
    }
  }

  for (const [id, primitive] of next.primitiveById) {
    if (!previous.primitiveById.has(id)) changes.push({ type: 'primitive-replace', primitive })
  }

  const previousRooms = new Map(previous.rooms.map((room) => [room.roomId, room]))
  for (const room of next.rooms) {
    const old = previousRooms.get(room.roomId)
    if (old && old.visible !== room.visible) changes.push({ type: 'room-visibility', roomId: room.roomId, visible: room.visible })
  }

  const previousPortals = new Map(previous.portals.map((portal) => [portal.id, portal]))
  for (const portal of next.portals) {
    const old = previousPortals.get(portal.id)
    if (old && old.open !== portal.open) changes.push({ type: 'portal-state', portalId: portal.id, open: portal.open })
  }

  const previousColliders = new Map(previous.colliders.map((collider) => [collider.id, collider]))
  for (const collider of next.colliders) {
    const old = previousColliders.get(collider.id)
    if (old && old.enabled !== collider.enabled) changes.push({ type: 'collider-state', colliderId: collider.id, enabled: collider.enabled })
  }

  return { changes, incremental: true }
}

export function effectiveMaterialDefinition(
  primitive: CompiledPrimitive,
  document: NormalizedWorldDocument,
): MaterialDefinition | undefined {
  return primitive.material ? document.materials[primitive.material] : undefined
}
