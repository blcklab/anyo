import type { ArchitectureAnchor, ArchitectureTransform, ArchitectureVec3 } from './types.js'
import type { GeometryIssue } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'

export const ARCH_EPSILON = 1e-8

export function architectureError(
  code: Extract<GeometryIssue['code'], 'ARCHITECTURE_INVALID' | 'ARCHITECTURE_OPENING_OVERLAP' | 'ARCHITECTURE_LIMIT'>,
  path: string,
  message: string,
  suggestion?: string,
): never {
  throw new GeometryValidationError([{ code, path, message, ...(suggestion ? { suggestion } : {}) }])
}

export function finitePositive(value: unknown, path: string, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) architectureError('ARCHITECTURE_INVALID', path, `${label} must be a finite number greater than zero.`)
  return value
}

export function finiteNonNegative(value: unknown, path: string, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) architectureError('ARCHITECTURE_INVALID', path, `${label} must be a finite non-negative number.`)
  return value
}

export function vec3(value: unknown, path: string, fallback: ArchitectureVec3 = [0, 0, 0]): ArchitectureVec3 {
  const candidate = value ?? fallback
  if (!Array.isArray(candidate) || candidate.length !== 3 || candidate.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    architectureError('ARCHITECTURE_INVALID', path, `${path.slice(1) || 'value'} must contain three finite numbers.`)
  }
  return [candidate[0] as number, candidate[1] as number, candidate[2] as number]
}

export function vec2Positive(value: unknown, path: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || value.some(item => typeof item !== 'number' || !Number.isFinite(item) || item <= 0)) {
    architectureError('ARCHITECTURE_INVALID', path, `${path.slice(1)} must contain two finite numbers greater than zero.`)
  }
  return [value[0] as number, value[1] as number]
}

export function transform(
  position: ArchitectureVec3 = [0, 0, 0],
  rotation: ArchitectureVec3 = [0, 0, 0],
  scale: ArchitectureVec3 = [1, 1, 1],
): ArchitectureTransform {
  return Object.freeze({
    position: Object.freeze([...position]) as unknown as ArchitectureVec3,
    rotation: Object.freeze([...rotation]) as unknown as ArchitectureVec3,
    scale: Object.freeze([...scale]) as unknown as ArchitectureVec3,
  })
}

export function anchor(name: string, position: ArchitectureVec3, rotation?: ArchitectureVec3): ArchitectureAnchor {
  return Object.freeze({
    name,
    position: Object.freeze([...position]) as readonly [number, number, number],
    ...(rotation ? { rotation: Object.freeze([...rotation]) as readonly [number, number, number] } : {}),
  })
}

export function rotateY(point: ArchitectureVec3, yaw: number): ArchitectureVec3 {
  const cosine = Math.cos(yaw), sine = Math.sin(yaw)
  return [point[0] * cosine + point[2] * sine, point[1], -point[0] * sine + point[2] * cosine]
}

export function add3(a: ArchitectureVec3, b: ArchitectureVec3): ArchitectureVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function freezeArray<T>(values: T[]): readonly T[] {
  return Object.freeze(values)
}

export function geometryBox(size: [number, number, number], bevel = 0, bevelSegments?: number) {
  if (bevel > 0) return {
    kind: 'roundedBox',
    size,
    radius: bevel,
    ...(bevelSegments !== undefined ? { segments: bevelSegments } : {}),
  } as const
  return { kind: 'box', size } as const
}

export function horizontalYaw(from: ArchitectureVec3, to: ArchitectureVec3, path = '/to'): { length: number; yaw: number; dx: number; dz: number } {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  if (Math.abs(dy) > ARCH_EPSILON) architectureError('ARCHITECTURE_INVALID', path, 'This S7 semantic expects horizontal endpoints with matching Y coordinates.', 'Use a geometry-local transform for sloped structural members until a later architecture revision adds arbitrary-axis beams/walls.')
  const length = Math.hypot(dx, dz)
  if (length <= ARCH_EPSILON) architectureError('ARCHITECTURE_INVALID', path, 'Endpoints must describe a non-zero horizontal span.')
  return { length, yaw: Math.atan2(-dz, dx), dx, dz }
}
