import type { GeometryDefinition, GeometryGroup, GeometryIssue, GeometryMeshDraft, GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}

export function positiveNumber(definition: GeometryDefinition, key: string, fallback: number): number {
  const raw = definition[key] ?? fallback
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) parameterError(`/${key}`, `${key} must be a finite number greater than zero.`)
  return raw
}

export function nonNegativeNumber(definition: GeometryDefinition, key: string, fallback: number): number {
  const raw = definition[key] ?? fallback
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) parameterError(`/${key}`, `${key} must be a finite number greater than or equal to zero.`)
  return raw
}

export function booleanValue(definition: GeometryDefinition, key: string, fallback: boolean): boolean {
  const raw = definition[key] ?? fallback
  if (typeof raw !== 'boolean') parameterError(`/${key}`, `${key} must be boolean.`)
  return raw
}

export function positiveInteger(
  definition: GeometryDefinition,
  key: string,
  fallback: number,
  limits: GeometrySafetyLimits,
  minimum = 1,
): number {
  const raw = definition[key] ?? fallback
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < minimum || raw > limits.maxCurveSegments) {
    parameterError(`/${key}`, `${key} must be a safe integer from ${minimum} to ${limits.maxCurveSegments}.`)
  }
  return raw
}

export function size2(definition: GeometryDefinition, fallback: Vec2 = [1, 1]): Vec2 {
  const raw = definition.size ?? fallback
  if (!Array.isArray(raw) || raw.length !== 2 || raw.some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    parameterError('/size', 'size must be [width, height] with finite positive values.')
  }
  return [raw[0] as number, raw[1] as number]
}

export function size3(definition: GeometryDefinition, fallback: Vec3 = [1, 1, 1]): Vec3 {
  const raw = definition.size ?? fallback
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    parameterError('/size', 'size must be [width, height, depth] with finite positive values.')
  }
  return [raw[0] as number, raw[1] as number, raw[2] as number]
}

export function indexArray(indices: readonly number[], vertexCount: number): Uint16Array | Uint32Array {
  return vertexCount > 65_535 ? new Uint32Array(indices) : new Uint16Array(indices)
}

export function meshFromArrays(
  positions: number[],
  indices: number[],
  normals?: number[],
  uvs?: number[],
  groups?: readonly GeometryGroup[],
): GeometryMeshDraft {
  const vertexCount = positions.length / 3
  return {
    positions: new Float32Array(positions),
    indices: indexArray(indices, vertexCount),
    ...(normals ? { normals: new Float32Array(normals) } : {}),
    ...(uvs ? { uvs: new Float32Array(uvs) } : {}),
    ...(groups ? { groups } : {}),
  }
}

export function withoutQuality(definition: GeometryDefinition): Record<string, unknown> {
  const { quality: _quality, ...rest } = definition
  return rest
}

export function normalize3(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z)
  if (length <= 1e-15) return [0, 1, 0]
  return [x / length, y / length, z / length]
}

export function triangleAreaSquared(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
): number {
  const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!
  const bx = positions[b * 3]!, by = positions[b * 3 + 1]!, bz = positions[b * 3 + 2]!
  const cx = positions[c * 3]!, cy = positions[c * 3 + 1]!, cz = positions[c * 3 + 2]!
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const nx = aby * acz - abz * acy
  const ny = abz * acx - abx * acz
  const nz = abx * acy - aby * acx
  return nx * nx + ny * ny + nz * nz
}
