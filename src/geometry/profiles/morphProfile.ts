import type { GeometryJsonValue } from '../types/index.js'
import type { NormalizedProfile, ProfilePoint } from './types.js'

export interface ProfileTransform2D {
  readonly scale: readonly [number, number]
  readonly rotation: number
  readonly offset: readonly [number, number]
}

export function profilesHaveCompatibleTopology(a: NormalizedProfile, b: NormalizedProfile): boolean {
  if (a.outer.length !== b.outer.length || a.holes.length !== b.holes.length) return false
  for (let index = 0; index < a.holes.length; index += 1) {
    if (a.holes[index]!.length !== b.holes[index]!.length) return false
  }
  return true
}

export function interpolateProfile(a: NormalizedProfile, b: NormalizedProfile, alpha: number): NormalizedProfile {
  return {
    outer: interpolateContour(a.outer, b.outer, alpha),
    holes: a.holes.map((hole, index) => interpolateContour(hole, b.holes[index]!, alpha)),
  }
}

export function transformProfile(profile: NormalizedProfile, transform: ProfileTransform2D): NormalizedProfile {
  return {
    outer: profile.outer.map(point => transformPoint(point, transform)),
    holes: profile.holes.map(hole => hole.map(point => transformPoint(point, transform))),
  }
}

export function profileToJson(profile: NormalizedProfile): GeometryJsonValue {
  return {
    points: profile.outer.map(point => [point[0], point[1]]),
    ...(profile.holes.length ? { holes: profile.holes.map(hole => hole.map(point => [point[0], point[1]])) } : {}),
  }
}

export function interpolateAngle(a: number, b: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + delta * alpha
}

export function canonicalAngle(value: number): number {
  const wrapped = Math.atan2(Math.sin(value), Math.cos(value))
  return Object.is(wrapped, -0) ? 0 : wrapped
}

function interpolateContour(a: readonly ProfilePoint[], b: readonly ProfilePoint[], alpha: number): ProfilePoint[] {
  return a.map((point, index) => {
    const other = b[index]!
    return [point[0] + (other[0] - point[0]) * alpha, point[1] + (other[1] - point[1]) * alpha]
  })
}

function transformPoint(point: ProfilePoint, transform: ProfileTransform2D): ProfilePoint {
  const x = point[0] * transform.scale[0]
  const y = point[1] * transform.scale[1]
  const c = Math.cos(transform.rotation)
  const s = Math.sin(transform.rotation)
  return [x * c - y * s + transform.offset[0], x * s + y * c + transform.offset[1]]
}
