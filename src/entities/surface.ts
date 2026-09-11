import type {
  EntityDefinition,
  Euler,
  NormalizedWorldDocument,
  Size2,
  TransformDefinition,
  Vec3,
} from '../core/types.js'
import { getWallFrame } from '../math/walls.js'

function entitySurfaceSize(entity: EntityDefinition): Size2 {
  if (Array.isArray(entity.size)) {
    return [entity.size[0] ?? 1, entity.size[1] ?? 1]
  }
  return [3, 1]
}

export function resolveSurfaceTransform(
  entity: EntityDefinition,
  document: NormalizedWorldDocument,
): TransformDefinition {
  const surface = entity.surface
  if (!surface) throw new Error(`Entity "${entity.id}" has no surface attachment.`)

  const floor = document.building.floors.find((candidate) => candidate.rooms.some((room) => room.id === surface.room))
  const room = floor?.rooms.find((candidate) => candidate.id === surface.room)
  if (!floor || !room) throw new Error(`Entity "${entity.id}" references unknown surface room "${surface.room}".`)

  const frame = getWallFrame(room, floor.elevation, surface.wall)
  const [entityWidth] = entitySurfaceSize(entity)
  const anchor = surface.anchor ?? 'center'
  const anchorOffset = anchor === 'start'
    ? -frame.length / 2 + entityWidth / 2
    : anchor === 'end'
      ? frame.length / 2 - entityWidth / 2
      : 0
  const [tangentOffset, verticalOffset] = surface.offset ?? [0, 0]
  const faceRoom = surface.faceRoom ?? true
  const depth = Math.max(0.002, surface.depth ?? 0.012)
  const interiorSign = faceRoom ? -1 : 1
  const tangent = anchorOffset + tangentOffset

  const position: Vec3 = [
    frame.center[0] + (frame.tangentAxis === 'x' ? tangent : 0) + frame.normal[0] * interiorSign * (frame.thickness / 2 + depth),
    floor.elevation + room.height / 2 + verticalOffset,
    frame.center[2] + (frame.tangentAxis === 'z' ? tangent : 0) + frame.normal[2] * interiorSign * (frame.thickness / 2 + depth),
  ]
  const rotation: Euler = [
    entity.rotation?.[0] ?? 0,
    frame.rotation[1] + (faceRoom ? 0 : Math.PI) + (entity.rotation?.[1] ?? 0),
    entity.rotation?.[2] ?? 0,
  ]
  const rawScale = entity.scale ?? 1
  const scale: Vec3 = typeof rawScale === 'number' ? [rawScale, rawScale, rawScale] : rawScale

  return { position, rotation, scale }
}
