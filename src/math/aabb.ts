import type { Aabb, Size3, TransformDefinition, Vec3 } from '../core/types.js'
import { matrixFromTransform, transformPoint } from './matrix4.js'

export function aabbFromCenterSize(center: Vec3, size: Size3): Aabb {
  const halfX = size[0] / 2
  const halfY = size[1] / 2
  const halfZ = size[2] / 2
  return {
    min: [center[0] - halfX, center[1] - halfY, center[2] - halfZ],
    max: [center[0] + halfX, center[1] + halfY, center[2] + halfZ],
  }
}

export function aabbFromTransformedSize(transform: TransformDefinition, size: Size3): Aabb {
  const matrix = transform.matrix ?? matrixFromTransform(transform)
  const hx = size[0] / 2
  const hy = size[1] / 2
  const hz = size[2] / 2
  const corners: Vec3[] = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz],
  ]
  const first = transformPoint(matrix, corners[0] as Vec3)
  const min: [number, number, number] = [...first]
  const max: [number, number, number] = [...first]
  for (const corner of corners.slice(1)) {
    const point = transformPoint(matrix, corner)
    min[0] = Math.min(min[0], point[0])
    min[1] = Math.min(min[1], point[1])
    min[2] = Math.min(min[2], point[2])
    max[0] = Math.max(max[0], point[0])
    max[1] = Math.max(max[1], point[1])
    max[2] = Math.max(max[2], point[2])
  }
  return { min, max }
}

export function containsPoint(bounds: Aabb, point: Vec3): boolean {
  return (
    point[0] >= bounds.min[0] &&
    point[0] <= bounds.max[0] &&
    point[1] >= bounds.min[1] &&
    point[1] <= bounds.max[1] &&
    point[2] >= bounds.min[2] &&
    point[2] <= bounds.max[2]
  )
}

export function intersectsAabb(a: Aabb, b: Aabb): boolean {
  return !(
    a.max[0] < b.min[0] ||
    a.min[0] > b.max[0] ||
    a.max[1] < b.min[1] ||
    a.min[1] > b.max[1] ||
    a.max[2] < b.min[2] ||
    a.min[2] > b.max[2]
  )
}

export function expandAabb(bounds: Aabb, amount: number): Aabb {
  return {
    min: [bounds.min[0] - amount, bounds.min[1] - amount, bounds.min[2] - amount],
    max: [bounds.max[0] + amount, bounds.max[1] + amount, bounds.max[2] + amount],
  }
}

export function mergeAabb(a: Aabb, b: Aabb): Aabb {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  }
}

export function distanceToAabbXZ(point: Vec3, bounds: Aabb): number {
  const dx = Math.max(bounds.min[0] - point[0], 0, point[0] - bounds.max[0])
  const dz = Math.max(bounds.min[2] - point[2], 0, point[2] - bounds.max[2])
  return Math.hypot(dx, dz)
}
