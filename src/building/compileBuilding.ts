import type {
  CompileAccumulator,
  CompiledCollider,
  CompiledPortal,
  CompiledPrimitive,
  CompiledRoomChunk,
  NormalizedFloor,
  NormalizedOpening,
  NormalizedRoom,
  NormalizedWorldDocument,
  StairDefinition,
  Vec3,
  WallSide,
} from '../core/types.js'
import { aabbFromCenterSize, containsPoint } from '../math/aabb.js'
import { getWallFrame, pointOnWall, wallSegmentSize } from '../math/walls.js'
import { decomposeWall } from './wallGeometry.js'
import { decomposeSlab, type SlabCutout } from './slabGeometry.js'

function oppositeWall(wall: WallSide): WallSide {
  return ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[wall]
}

function makeBox(
  id: string,
  center: Vec3,
  size: readonly [number, number, number],
  material: string | undefined,
  roomId: string | undefined,
  floorId: string | undefined,
  tags: string[],
): CompiledPrimitive {
  return {
    id,
    kind: 'box',
    transform: { position: center, rotation: [0, 0, 0], scale: [1, 1, 1] },
    size,
    material,
    roomId,
    floorId,
    collision: false,
    visible: true,
    tags,
    static: true,
    geometryKey: 'unit-box',
    batchKey: `${roomId ?? 'world'}:${material ?? '__default'}:box`,
  }
}

function addCollider(
  output: CompileAccumulator,
  id: string,
  center: Vec3,
  size: readonly [number, number, number],
  roomId: string | undefined,
  kind: CompiledCollider['kind'],
  enabled = true,
): void {
  output.colliders.push({
    id,
    bounds: aabbFromCenterSize(center, size),
    roomId,
    enabled,
    kind,
  })
}

interface RoomSlabCutouts {
  floor: SlabCutout[]
  ceiling: SlabCutout[]
}

function stairFootprint(stair: StairDefinition): SlabCutout {
  const direction = stair.direction ?? 'north'
  const forward = directionVector(direction)
  const stepCount = stair.steps ?? 18
  const run = stair.run ?? stepCount * 0.28
  const width = stair.width ?? 1.2
  return {
    center: [
      stair.position[0] + forward[0] * run / 2,
      stair.position[1] + forward[2] * run / 2,
    ],
    size: direction === 'north' || direction === 'south' ? [width, run] : [run, width],
  }
}

function roomContainsXZ(room: NormalizedRoom, point: readonly [number, number]): boolean {
  return (
    point[0] >= room.position[0] - room.size[0] / 2 &&
    point[0] <= room.position[0] + room.size[0] / 2 &&
    point[1] >= room.position[1] - room.size[1] / 2 &&
    point[1] <= room.position[1] + room.size[1] / 2
  )
}

function collectStairwellCutouts(document: NormalizedWorldDocument): Map<string, RoomSlabCutouts> {
  const cutouts = new Map<string, RoomSlabCutouts>()
  const floors = new Map(document.building.floors.map((floor) => [floor.id, floor]))
  const add = (roomId: string, kind: keyof RoomSlabCutouts, cutout: SlabCutout): void => {
    const entry = cutouts.get(roomId) ?? { floor: [], ceiling: [] }
    entry[kind].push(cutout)
    cutouts.set(roomId, entry)
  }

  for (const floor of document.building.floors) {
    for (const stair of floor.stairs) {
      const from = floors.get(stair.fromFloor)
      const to = floors.get(stair.toFloor)
      if (!from || !to || from.elevation === to.elevation) continue
      const lower = from.elevation < to.elevation ? from : to
      const upper = from.elevation < to.elevation ? to : from
      const footprint = stairFootprint(stair)
      const lowerRoom = lower.rooms.find((room) => roomContainsXZ(room, footprint.center))
      const upperRoom = upper.rooms.find((room) => roomContainsXZ(room, footprint.center))
      if (lowerRoom) add(lowerRoom.id, 'ceiling', footprint)
      if (upperRoom) add(upperRoom.id, 'floor', footprint)
    }
  }
  return cutouts
}

function compileRoom(
  document: NormalizedWorldDocument,
  floor: NormalizedFloor,
  room: NormalizedRoom,
  output: CompileAccumulator,
  sharedWallCuts: Map<string, NormalizedOpening[]>,
  portalIdSet: Set<string>,
  slabCutouts: RoomSlabCutouts,
): void {
  const defaults = document.building.defaults
  const primitiveIds: string[] = []
  const colliderIds: string[] = []
  const portalIds: string[] = []
  const [width, depth] = room.size
  const floorCenterY = floor.elevation - defaults.floorThickness / 2
  const ceilingCenterY = floor.elevation + room.height + defaults.ceilingThickness / 2
  const floorCells = decomposeSlab(room.position, room.size, slabCutouts.floor)
  const ceilingCells = decomposeSlab(room.position, room.size, slabCutouts.ceiling)

  floorCells.forEach((cell, index) => {
    const center: Vec3 = [cell.center[0], floorCenterY, cell.center[1]]
    const size = [cell.size[0], defaults.floorThickness, cell.size[1]] as const
    const id = floorCells.length === 1 ? `${room.id}:floor` : `${room.id}:floor:${index}`
    const primitive = makeBox(id, center, size, room.materials?.floor, room.id, floor.id, ['architecture', 'floor'])
    output.primitives.push(primitive)
    primitiveIds.push(id)
    const colliderId = `${id}:collider`
    addCollider(output, colliderId, center, size, room.id, 'floor')
    colliderIds.push(colliderId)
  })

  ceilingCells.forEach((cell, index) => {
    const center: Vec3 = [cell.center[0], ceilingCenterY, cell.center[1]]
    const size = [cell.size[0], defaults.ceilingThickness, cell.size[1]] as const
    const id = ceilingCells.length === 1 ? `${room.id}:ceiling` : `${room.id}:ceiling:${index}`
    const primitive = makeBox(id, center, size, room.materials?.ceiling, room.id, floor.id, ['architecture', 'ceiling'])
    output.primitives.push(primitive)
    primitiveIds.push(id)
  })

  const walls: WallSide[] = ['north', 'south', 'east', 'west']
  for (const wall of walls) {
    const frame = getWallFrame(room, floor.elevation, wall)
    const openings = room.openings.filter((opening) => opening.wall === wall)
    const cuts = sharedWallCuts.get(`${room.id}:${wall}`) ?? []
    const cells = decomposeWall(frame.length, frame.height, [...openings, ...cuts])

    cells.forEach((cell, index) => {
      const center = pointOnWall(frame, cell.tangentCenter, floor.elevation + cell.verticalCenter)
      const visualSize = [cell.length, cell.height, frame.thickness] as const
      const colliderSize = wallSegmentSize(frame, cell.length, cell.height)
      const id = `${room.id}:wall:${wall}:${index}`
      const primitive: CompiledPrimitive = {
        ...makeBox(id, center, visualSize, room.materials?.wall, room.id, floor.id, ['architecture', 'wall', wall]),
        transform: { position: center, rotation: frame.rotation, scale: [1, 1, 1] },
      }
      output.primitives.push(primitive)
      primitiveIds.push(id)

      const colliderId = `${id}:collider`
      addCollider(output, colliderId, center, colliderSize, room.id, 'solid')
      colliderIds.push(colliderId)
    })

    for (const opening of openings) {
      const openingCenter = pointOnWall(
        frame,
        opening.offset,
        floor.elevation + opening.elevation + opening.height / 2,
      )

      if (opening.type === 'window') {
        const paneThickness = Math.max(0.018, frame.thickness * 0.15)
        const visualSize = [opening.width, opening.height, paneThickness] as const
        const colliderSize = frame.tangentAxis === 'x'
          ? visualSize
          : [paneThickness, opening.height, opening.width] as const
        const windowId = `${room.id}:window:${opening.id}`
        const windowPrimitive: CompiledPrimitive = {
          ...makeBox(windowId, openingCenter, visualSize, opening.material, room.id, floor.id, ['architecture', 'window']),
          transform: { position: openingCenter, rotation: frame.rotation, scale: [1, 1, 1] },
        }
        output.primitives.push(windowPrimitive)
        primitiveIds.push(windowId)
        if (opening.collision) {
          const colliderId = `${windowId}:collider`
          addCollider(output, colliderId, openingCenter, colliderSize, room.id, 'solid')
          colliderIds.push(colliderId)
        }
      }

      if (!opening.targetRoom) continue
      const endpoints = [room.id, opening.targetRoom].sort()
      const portalId = `portal:${endpoints[0]}:${endpoints[1]}:${opening.id}`
      if (portalIdSet.has(portalId)) continue
      portalIdSet.add(portalId)

      const center = openingCenter
      const portalSize = frame.tangentAxis === 'x'
        ? [opening.width, opening.height, Math.max(frame.thickness * 2, 0.2)] as const
        : [Math.max(frame.thickness * 2, 0.2), opening.height, opening.width] as const
      const portal: CompiledPortal = {
        id: portalId,
        fromRoom: room.id,
        toRoom: opening.targetRoom,
        bounds: aabbFromCenterSize(center, portalSize),
        open: opening.open,
        sourceOpeningId: opening.id,
      }
      output.portals.push(portal)
      portalIds.push(portal.id)

      if (opening.type === 'door') {
        const doorThickness = Math.max(0.06, frame.thickness * 0.5)
        const doorVisualSize = [opening.width, opening.height, doorThickness] as const
        const doorColliderSize = frame.tangentAxis === 'x'
          ? doorVisualSize
          : [doorThickness, opening.height, opening.width] as const
        const doorId = `${room.id}:door:${opening.id}`
        const doorPrimitive: CompiledPrimitive = {
          ...makeBox(doorId, center, doorVisualSize, opening.material ?? room.materials?.wall, room.id, floor.id, ['architecture', 'door']),
          transform: { position: center, rotation: frame.rotation, scale: [1, 1, 1] },
          visible: !opening.open,
          static: false,
          batchKey: undefined,
        }
        output.primitives.push(doorPrimitive)
        primitiveIds.push(doorId)
        if (opening.collision) {
          const doorColliderId = `${doorId}:collider`
          addCollider(output, doorColliderId, center, doorColliderSize, room.id, 'door', !opening.open)
          colliderIds.push(doorColliderId)
        }
      }
    }
  }

  const bounds = {
    min: [room.position[0] - width / 2, floor.elevation, room.position[1] - depth / 2] as Vec3,
    max: [room.position[0] + width / 2, floor.elevation + room.height, room.position[1] + depth / 2] as Vec3,
  }
  const chunk: CompiledRoomChunk = {
    id: `chunk:${room.id}`,
    roomId: room.id,
    floorId: floor.id,
    bounds,
    primitiveIds,
    colliderIds,
    portalIds,
    visible: room.visible ?? floor.visible ?? true,
  }
  output.rooms.push(chunk)
}

function directionVector(direction: WallSide): Vec3 {
  switch (direction) {
    case 'north': return [0, 0, -1]
    case 'south': return [0, 0, 1]
    case 'east': return [1, 0, 0]
    case 'west': return [-1, 0, 0]
  }
}

function nearestRoom(floor: NormalizedFloor, point: Vec3): NormalizedRoom | undefined {
  return floor.rooms.find((room) => {
    const bounds = {
      min: [room.position[0] - room.size[0] / 2, floor.elevation - 0.5, room.position[1] - room.size[1] / 2] as Vec3,
      max: [room.position[0] + room.size[0] / 2, floor.elevation + room.height, room.position[1] + room.size[1] / 2] as Vec3,
    }
    return containsPoint(bounds, point)
  })
}

function compileStair(
  stair: StairDefinition,
  fromFloor: NormalizedFloor,
  toFloor: NormalizedFloor,
  output: CompileAccumulator,
  portalIds: Set<string>,
): void {
  const rise = toFloor.elevation - fromFloor.elevation
  if (Math.abs(rise) < 1e-6) return

  const direction = stair.direction ?? 'north'
  const forward = directionVector(direction)
  const stepCount = stair.steps ?? Math.max(2, Math.ceil(Math.abs(rise) / 0.18))
  const run = stair.run ?? stepCount * 0.28
  const tread = run / stepCount
  const stepRise = rise / stepCount
  const width = stair.width ?? 1.2
  const ownerRoom = nearestRoom(fromFloor, [stair.position[0], fromFloor.elevation, stair.position[1]])

  for (let index = 0; index < stepCount; index += 1) {
    const progress = (index + 0.5) * tread
    const height = Math.abs(stepRise) * (index + 1)
    const x = stair.position[0] + forward[0] * progress
    const z = stair.position[1] + forward[2] * progress
    const y = fromFloor.elevation + (stepRise > 0 ? height / 2 : -height / 2)
    const size = direction === 'north' || direction === 'south'
      ? [width, height, tread] as const
      : [tread, height, width] as const
    const center: Vec3 = [x, y, z]
    const id = `${stair.id}:step:${index}`
    output.primitives.push(makeBox(id, center, size, stair.material, ownerRoom?.id, fromFloor.id, ['architecture', 'stair']))
    const colliderId = `${id}:collider`
    addCollider(output, colliderId, center, size, ownerRoom?.id, 'stair')
    const ownerChunk = ownerRoom ? output.rooms.find((room) => room.roomId === ownerRoom.id) : undefined
    ownerChunk?.primitiveIds.push(id)
    ownerChunk?.colliderIds.push(colliderId)
  }

  const endPoint: Vec3 = [
    stair.position[0] + forward[0] * run,
    toFloor.elevation,
    stair.position[1] + forward[2] * run,
  ]
  const targetRoom = nearestRoom(toFloor, endPoint)
  if (ownerRoom && targetRoom && ownerRoom.id !== targetRoom.id) {
    const portalId = `portal:stair:${stair.id}`
    if (!portalIds.has(portalId)) {
      portalIds.add(portalId)
      output.portals.push({
        id: portalId,
        fromRoom: ownerRoom.id,
        toRoom: targetRoom.id,
        bounds: aabbFromCenterSize(
          [
            stair.position[0] + forward[0] * run / 2,
            (fromFloor.elevation + toFloor.elevation) / 2,
            stair.position[1] + forward[2] * run / 2,
          ],
          direction === 'north' || direction === 'south'
            ? [width, Math.abs(rise) + 1, run]
            : [run, Math.abs(rise) + 1, width],
        ),
        open: true,
      })
      output.rooms.find((room) => room.roomId === ownerRoom.id)?.portalIds.push(portalId)
      output.rooms.find((room) => room.roomId === targetRoom.id)?.portalIds.push(portalId)
    }
  }
}

function findSharedWallCuts(document: NormalizedWorldDocument): Map<string, NormalizedOpening[]> {
  const cuts = new Map<string, NormalizedOpening[]>()
  const rooms = new Map<string, NormalizedRoom>()
  for (const floor of document.building.floors) {
    for (const room of floor.rooms) rooms.set(room.id, room)
  }

  for (const floor of document.building.floors) {
    for (const room of floor.rooms) {
      const attach = room.attachTo
      if (!attach || Math.abs(attach.gap ?? 0) > 1e-6) continue
      const parent = rooms.get(attach.room)
      if (!parent) continue
      const childWall = oppositeWall(attach.wall)
      const tangentIsX = childWall === 'north' || childWall === 'south'
      const childCenter = tangentIsX ? room.position[0] : room.position[1]
      const parentCenter = tangentIsX ? parent.position[0] : parent.position[1]
      const childLength = tangentIsX ? room.size[0] : room.size[1]
      const parentLength = tangentIsX ? parent.size[0] : parent.size[1]
      const overlapStart = Math.max(childCenter - childLength / 2, parentCenter - parentLength / 2)
      const overlapEnd = Math.min(childCenter + childLength / 2, parentCenter + parentLength / 2)
      const overlapLength = overlapEnd - overlapStart
      if (overlapLength <= 1e-6) continue
      const localCenter = (overlapStart + overlapEnd) / 2 - childCenter
      const key = `${room.id}:${childWall}`
      const entries = cuts.get(key) ?? []
      entries.push({
        id: `${room.id}:shared:${parent.id}:${childWall}`,
        type: 'portal',
        wall: childWall,
        offset: localCenter,
        width: overlapLength,
        height: room.height,
        elevation: 0,
        targetRoom: parent.id,
        open: true,
        collision: false,
      })
      cuts.set(key, entries)
    }
  }
  return cuts
}

export function compileBuilding(document: NormalizedWorldDocument, output: CompileAccumulator): void {
  const sharedWallCuts = findSharedWallCuts(document)
  const portalIds = new Set<string>()
  const stairwellCutouts = collectStairwellCutouts(document)

  for (const floor of document.building.floors) {
    for (const room of floor.rooms) {
      compileRoom(
        document,
        floor,
        room,
        output,
        sharedWallCuts,
        portalIds,
        stairwellCutouts.get(room.id) ?? { floor: [], ceiling: [] },
      )
    }
  }

  const floorsById = new Map(document.building.floors.map((floor) => [floor.id, floor]))
  for (const floor of document.building.floors) {
    for (const stair of floor.stairs) {
      const fromFloor = floorsById.get(stair.fromFloor)
      const toFloor = floorsById.get(stair.toFloor)
      if (fromFloor && toFloor) compileStair(stair, fromFloor, toFloor, output, portalIds)
    }
  }
}
