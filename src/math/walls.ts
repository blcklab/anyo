import type { Euler, NormalizedRoom, Size3, Vec3, WallSide } from '../core/types.js'

export interface WallFrame {
  center: Vec3
  rotation: Euler
  length: number
  height: number
  thickness: number
  tangentAxis: 'x' | 'z'
  normal: Vec3
}

export function getWallLength(room: Pick<NormalizedRoom, 'size'>, wall: WallSide): number {
  return wall === 'north' || wall === 'south' ? room.size[0] : room.size[1]
}

export function getWallFrame(
  room: Pick<NormalizedRoom, 'position' | 'size' | 'height' | 'wallThickness'>,
  elevation: number,
  wall: WallSide,
): WallFrame {
  const [x, z] = room.position
  const [width, depth] = room.size
  const y = elevation + room.height / 2

  switch (wall) {
    case 'north':
      return {
        center: [x, y, z - depth / 2],
        rotation: [0, 0, 0],
        length: width,
        height: room.height,
        thickness: room.wallThickness,
        tangentAxis: 'x',
        normal: [0, 0, -1],
      }
    case 'south':
      return {
        center: [x, y, z + depth / 2],
        rotation: [0, Math.PI, 0],
        length: width,
        height: room.height,
        thickness: room.wallThickness,
        tangentAxis: 'x',
        normal: [0, 0, 1],
      }
    case 'east':
      return {
        center: [x + width / 2, y, z],
        rotation: [0, -Math.PI / 2, 0],
        length: depth,
        height: room.height,
        thickness: room.wallThickness,
        tangentAxis: 'z',
        normal: [1, 0, 0],
      }
    case 'west':
      return {
        center: [x - width / 2, y, z],
        rotation: [0, Math.PI / 2, 0],
        length: depth,
        height: room.height,
        thickness: room.wallThickness,
        tangentAxis: 'z',
        normal: [-1, 0, 0],
      }
  }
}

export function wallSegmentSize(frame: WallFrame, length: number, height: number): Size3 {
  return frame.tangentAxis === 'x'
    ? [length, height, frame.thickness]
    : [frame.thickness, height, length]
}

export function pointOnWall(frame: WallFrame, tangent: number, vertical: number, depth = 0): Vec3 {
  const x = frame.center[0] + (frame.tangentAxis === 'x' ? tangent : frame.normal[0] * depth)
  const z = frame.center[2] + (frame.tangentAxis === 'z' ? tangent : frame.normal[2] * depth)
  return [x, vertical, z]
}
