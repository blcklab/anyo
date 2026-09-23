import type { CurvePoint3 } from './types.js'

export const CURVE_EPSILON = 1e-9

export function add3(a: CurvePoint3, b: CurvePoint3): CurvePoint3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
export function sub3(a: CurvePoint3, b: CurvePoint3): CurvePoint3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
export function scale3(a: CurvePoint3, scale: number): CurvePoint3 { return [a[0] * scale, a[1] * scale, a[2] * scale] }
export function dot3(a: CurvePoint3, b: CurvePoint3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
export function cross3(a: CurvePoint3, b: CurvePoint3): CurvePoint3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
export function length3(a: CurvePoint3): number { return Math.hypot(a[0], a[1], a[2]) }
export function normalize3(a: CurvePoint3, fallback: CurvePoint3 = [0, 0, 1]): CurvePoint3 {
  const length = length3(a)
  return length <= CURVE_EPSILON ? fallback : [a[0] / length, a[1] / length, a[2] / length]
}
export function lerp3(a: CurvePoint3, b: CurvePoint3, t: number): CurvePoint3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
export function distance3(a: CurvePoint3, b: CurvePoint3): number { return length3(sub3(b, a)) }
export function projectPerpendicular(vector: CurvePoint3, tangent: CurvePoint3): CurvePoint3 {
  return sub3(vector, scale3(tangent, dot3(vector, tangent)))
}
export function rotateAroundAxis(vector: CurvePoint3, axisInput: CurvePoint3, angle: number): CurvePoint3 {
  const axis = normalize3(axisInput, [0, 1, 0])
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  const parallel = scale3(axis, dot3(axis, vector) * (1 - cosine))
  const crossed = scale3(cross3(axis, vector), sine)
  return add3(add3(scale3(vector, cosine), crossed), parallel)
}
export function signedAngleAround(from: CurvePoint3, to: CurvePoint3, axis: CurvePoint3): number {
  return Math.atan2(dot3(axis, cross3(from, to)), Math.max(-1, Math.min(1, dot3(from, to))))
}
export function leastParallelAxis(tangent: CurvePoint3): CurvePoint3 {
  const ax = Math.abs(tangent[0]), ay = Math.abs(tangent[1]), az = Math.abs(tangent[2])
  if (ax <= ay && ax <= az) return [1, 0, 0]
  if (ay <= az) return [0, 1, 0]
  return [0, 0, 1]
}
