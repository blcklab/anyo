import type { GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { normalizeCurve } from './normalizeCurve.js'
import type { CurvePoint3, NormalizedCurveDefinition, SampledCurve } from './types.js'
import { CURVE_EPSILON, distance3, lerp3, normalize3, sub3 } from './vector.js'

export interface SampleCurveOptions { limits?: Partial<GeometrySafetyLimits>; path?: string }

export function sampleCurve(input: unknown, options: SampleCurveOptions = {}): SampledCurve {
  const definition = isNormalized(input) ? input : normalizeCurve(input, options)
  const points: CurvePoint3[] = []
  for (let index = 0; index <= definition.segments; index += 1) points.push(evaluate(definition, index / definition.segments))
  if (definition.closed) points[points.length - 1] = points[0]!

  const distances: number[] = [0]
  for (let index = 1; index < points.length; index += 1) distances.push(distances[index - 1]! + distance3(points[index - 1]!, points[index]!))
  const totalLength = distances[distances.length - 1]!
  if (!Number.isFinite(totalLength) || totalLength <= CURVE_EPSILON) throw new GeometryValidationError([{ code: 'CURVE_DEGENERATE', path: options.path ?? '/path', message: 'Curve has effectively zero sampled length.', suggestion: 'Move curve points farther apart.' }])

  const tangents = points.map((_point, index) => sampleTangent(points, index, !!definition.closed))
  if (definition.closed) tangents[tangents.length - 1] = tangents[0]!
  return { definition, points, tangents, distances, totalLength, closed: !!definition.closed }
}

export function sampleCurveAtDistance(sampled: SampledCurve, distance: number): { position: CurvePoint3; tangent: CurvePoint3; segment: number; alpha: number } {
  const clamped = sampled.closed ? modulo(distance, sampled.totalLength) : Math.max(0, Math.min(sampled.totalLength, distance))
  if (!sampled.closed && clamped >= sampled.totalLength - CURVE_EPSILON) {
    const last = sampled.points.length - 1
    return { position: sampled.points[last]!, tangent: sampled.tangents[last]!, segment: last - 1, alpha: 1 }
  }
  let low = 0, high = sampled.distances.length - 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (sampled.distances[middle]! <= clamped) low = middle
    else high = middle
  }
  const span = sampled.distances[low + 1]! - sampled.distances[low]!
  const alpha = span <= CURVE_EPSILON ? 0 : (clamped - sampled.distances[low]!) / span
  return {
    position: lerp3(sampled.points[low]!, sampled.points[low + 1]!, alpha),
    tangent: normalize3(lerp3(sampled.tangents[low]!, sampled.tangents[low + 1]!, alpha), sampled.tangents[low]!),
    segment: low,
    alpha,
  }
}

function evaluate(curve: NormalizedCurveDefinition, t: number): CurvePoint3 {
  if (curve.kind === 'line') return lerp3(curve.points[0]!, curve.points[1]!, t)
  if (curve.kind === 'polyline') return evaluatePolyline(curve.points, t, !!curve.closed)
  if (curve.kind === 'quadraticBezier') {
    const [p0, p1, p2] = curve.points, u = 1 - t
    return [u*u*p0![0] + 2*u*t*p1![0] + t*t*p2![0], u*u*p0![1] + 2*u*t*p1![1] + t*t*p2![1], u*u*p0![2] + 2*u*t*p1![2] + t*t*p2![2]]
  }
  if (curve.kind === 'cubicBezier') {
    const [p0, p1, p2, p3] = curve.points, u = 1 - t, uu = u*u, tt = t*t
    return [uu*u*p0![0] + 3*uu*t*p1![0] + 3*u*tt*p2![0] + tt*t*p3![0], uu*u*p0![1] + 3*uu*t*p1![1] + 3*u*tt*p2![1] + tt*t*p3![1], uu*u*p0![2] + 3*uu*t*p1![2] + 3*u*tt*p2![2] + tt*t*p3![2]]
  }
  return evaluateCatmull(curve.points, t, !!curve.closed, curve.tension ?? 0.5)
}

function evaluatePolyline(points: readonly CurvePoint3[], t: number, closed: boolean): CurvePoint3 {
  const spans = closed ? points.length : points.length - 1
  if (t >= 1) return closed ? points[0]! : points[points.length - 1]!
  const scaled = Math.max(0, t) * spans, span = Math.min(spans - 1, Math.floor(scaled)), local = scaled - span
  return lerp3(points[span]!, points[(span + 1) % points.length]!, local)
}
function evaluateCatmull(points: readonly CurvePoint3[], t: number, closed: boolean, tension: number): CurvePoint3 {
  const spans = closed ? points.length : points.length - 1
  if (t >= 1) return closed ? points[0]! : points[points.length - 1]!
  const scaled = Math.max(0, t) * spans, span = Math.min(spans - 1, Math.floor(scaled)), u = scaled - span
  const p1 = pointAt(points, span, closed), p2 = pointAt(points, span + 1, closed)
  const p0 = pointAt(points, span - 1, closed), p3 = pointAt(points, span + 2, closed)
  const u2 = u*u, u3 = u2*u
  const h00 = 2*u3 - 3*u2 + 1, h10 = u3 - 2*u2 + u, h01 = -2*u3 + 3*u2, h11 = u3 - u2
  const m1 = [(p2[0]-p0[0])*tension, (p2[1]-p0[1])*tension, (p2[2]-p0[2])*tension] as CurvePoint3
  const m2 = [(p3[0]-p1[0])*tension, (p3[1]-p1[1])*tension, (p3[2]-p1[2])*tension] as CurvePoint3
  return [h00*p1[0] + h10*m1[0] + h01*p2[0] + h11*m2[0], h00*p1[1] + h10*m1[1] + h01*p2[1] + h11*m2[1], h00*p1[2] + h10*m1[2] + h01*p2[2] + h11*m2[2]]
}
function pointAt(points: readonly CurvePoint3[], index: number, closed: boolean): CurvePoint3 {
  if (closed) return points[modulo(index, points.length)]!
  return points[Math.max(0, Math.min(points.length - 1, index))]!
}
function sampleTangent(points: readonly CurvePoint3[], index: number, closed: boolean): CurvePoint3 {
  const last = points.length - 1
  let delta: CurvePoint3
  if (closed) {
    const unique = last
    const current = index === last ? 0 : index
    const previous = points[(current - 1 + unique) % unique]!, next = points[(current + 1) % unique]!
    delta = sub3(next, previous)
  } else if (index === 0) delta = sub3(points[1]!, points[0]!)
  else if (index === last) delta = sub3(points[last]!, points[last - 1]!)
  else delta = sub3(points[index + 1]!, points[index - 1]!)
  if (Math.hypot(delta[0], delta[1], delta[2]) <= CURVE_EPSILON) {
    for (let radius = 1; radius < points.length; radius += 1) {
      const before = Math.max(0, index - radius), after = Math.min(last, index + radius)
      delta = sub3(points[after]!, points[before]!)
      if (Math.hypot(delta[0], delta[1], delta[2]) > CURVE_EPSILON) break
    }
  }
  return normalize3(delta)
}
function isNormalized(value: unknown): value is NormalizedCurveDefinition { return !!value && typeof value === 'object' && Array.isArray((value as NormalizedCurveDefinition).points) && Number.isSafeInteger((value as NormalizedCurveDefinition).segments) }
function modulo(value: number, divisor: number): number { return ((value % divisor) + divisor) % divisor }
