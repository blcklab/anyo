import type { CameraAdapter, CanvasProjection, CompiledPrimitive, Matrix4Tuple, Vec3 } from '../core/types.js'

export interface ProjectedSurfaceRect {
  centerX: number
  centerY: number
  width: number
  height: number
  angle: number
  depth: number
  visible: boolean
  /** Projected plane corners in top-left, top-right, bottom-right, bottom-left order. */
  corners: readonly [CanvasProjection, CanvasProjection, CanvasProjection, CanvasProjection]
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function transformPoint(matrix: Matrix4Tuple | undefined, point: Vec3): Vec3 | null {
  if (!matrix) return point.every(finite) ? point : null
  const [x, y, z] = point
  const w = (matrix[3] ?? 0) * x + (matrix[7] ?? 0) * y + (matrix[11] ?? 0) * z + (matrix[15] ?? 1)
  if (!finite(w) || Math.abs(w) <= Number.EPSILON) return null
  const invW = 1 / w
  const transformed: Vec3 = [
    ((matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0)) * invW,
    ((matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0)) * invW,
    ((matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0)) * invW,
  ]
  return transformed.every(finite) ? transformed : null
}

function validProjection(value: CanvasProjection): boolean {
  return finite(value.x) && finite(value.y) && finite(value.depth) && typeof value.visible === 'boolean'
}

function distance(a: CanvasProjection, b: CanvasProjection): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function projectWebSurface(
  camera: CameraAdapter,
  primitive: CompiledPrimitive,
  minimumPixels = 2,
): ProjectedSurfaceRect | null {
  if (!camera.projectWorldPoint || !primitive.size) return null
  const width = primitive.size[0] ?? 1
  const height = primitive.size[1] ?? 1
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0 || !finite(minimumPixels) || minimumPixels < 0) return null

  const matrix = primitive.transform.matrix
  const points = [
    transformPoint(matrix, [0, 0, 0]),
    transformPoint(matrix, [-width / 2, 0, 0]),
    transformPoint(matrix, [width / 2, 0, 0]),
    transformPoint(matrix, [0, height / 2, 0]),
    transformPoint(matrix, [0, -height / 2, 0]),
    transformPoint(matrix, [-width / 2, height / 2, 0]),
    transformPoint(matrix, [width / 2, height / 2, 0]),
    transformPoint(matrix, [width / 2, -height / 2, 0]),
    transformPoint(matrix, [-width / 2, -height / 2, 0]),
  ] as const
  if (points.some(point => point === null)) return null

  let projected: readonly CanvasProjection[]
  try {
    projected = points.map(point => camera.projectWorldPoint?.(point as Vec3) as CanvasProjection)
  } catch {
    return null
  }
  if (projected.length !== 9 || projected.some(value => !value || !validProjection(value))) return null

  const [center, left, right, top, bottom, topLeft, topRight, bottomRight, bottomLeft] = projected
  if (!center || !left || !right || !top || !bottom || !topLeft || !topRight || !bottomRight || !bottomLeft) return null
  const projectedWidth = distance(left, right)
  const projectedHeight = distance(top, bottom)
  const angle = normalizeReadableAngle(Math.atan2(right.y - left.y, right.x - left.x))
  if (![projectedWidth, projectedHeight, angle].every(finite)) return null

  return {
    centerX: center.x,
    centerY: center.y,
    width: projectedWidth,
    height: projectedHeight,
    angle,
    depth: center.depth,
    visible: projected.every(value => value.visible) && projectedWidth >= minimumPixels && projectedHeight >= minimumPixels,
    corners: [topLeft, topRight, bottomRight, bottomLeft],
  }
}

function normalizeReadableAngle(value: number): number {
  let angle = value
  while (angle > Math.PI / 2) angle -= Math.PI
  while (angle < -Math.PI / 2) angle += Math.PI
  return Math.abs(angle) <= 1e-12 ? 0 : angle
}
