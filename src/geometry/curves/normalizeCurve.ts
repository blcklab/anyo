import type { CurveDefinition, CurveResourceMap, GeometryIssue, GeometryQualityPreset, GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import type { CurvePoint3, NormalizedCurveDefinition } from './types.js'
import { cross3, distance3, dot3, leastParallelAxis, normalize3, projectPerpendicular, scale3, add3, CURVE_EPSILON } from './vector.js'

const POINT_KINDS = new Set(['line', 'polyline', 'quadraticBezier', 'cubicBezier', 'catmullRom'])
const ANALYTIC_KINDS = new Set(['arc', 'circle', 'helix'])
const QUALITY: Record<GeometryQualityPreset, number> = { low: 8, medium: 16, high: 32, ultra: 64 }
const CATMULL_QUALITY: Record<GeometryQualityPreset, number> = { low: 4, medium: 8, high: 16, ultra: 32 }

export interface NormalizeCurveOptions {
  limits?: Partial<GeometrySafetyLimits>
  path?: string
  quality?: GeometryQualityPreset
  curves?: CurveResourceMap
}

export function normalizeCurve(input: unknown, options: NormalizeCurveOptions = {}): NormalizedCurveDefinition {
  const limits = resolveGeometrySafetyLimits(options.limits)
  const path = options.path ?? '/path'
  if (typeof input === 'string') {
    const id = input.trim()
    if (!id) curveError('CURVE_INVALID', path, 'Curve resource references must be non-empty strings.')
    const resource = options.curves?.[id]
    if (!resource) curveError('CURVE_INVALID', path, `Curve resource "${id}" was not found.`, 'Define the curve in the world curves map or inline the curve definition.')
    return normalizeCurve(resource, { ...options, path })
  }
  if (!isRecord(input)) curveError('CURVE_INVALID', path, 'Curve must be a plain JSON object or named curve resource reference.')
  const kind = input.kind
  if (typeof kind !== 'string' || (!POINT_KINDS.has(kind) && !ANALYTIC_KINDS.has(kind))) {
    curveError('CURVE_INVALID', `${path}/kind`, 'Curve kind must be line, polyline, quadraticBezier, cubicBezier, catmullRom, arc, circle, or helix.')
  }
  const quality = normalizeQuality(input.quality ?? options.quality ?? 'medium', `${path}/quality`)
  if (ANALYTIC_KINDS.has(kind)) return normalizeAnalytic(input as Record<string, unknown>, kind as 'arc' | 'circle' | 'helix', quality, limits, path)

  const points = normalizePoints(input.points, `${path}/points`, limits.maxProfilePoints)
  validatePointCount(kind, points.length, `${path}/points`)

  const closed = input.closed ?? false
  if (typeof closed !== 'boolean') curveError('CURVE_INVALID', `${path}/closed`, 'closed must be boolean.')
  if (closed && kind !== 'polyline' && kind !== 'catmullRom') curveError('CURVE_INVALID', `${path}/closed`, `${kind} curves do not support closed=true.`)
  if (closed && points.length < 3) curveError('CURVE_INVALID', `${path}/points`, 'Closed curves require at least three distinct points.')

  const spans = closed ? points.length : Math.max(1, points.length - 1)
  const fallback = kind === 'line' ? 1 : kind === 'polyline' ? spans : kind === 'catmullRom' ? spans * CATMULL_QUALITY[quality] : QUALITY[quality]
  const segments = normalizeSegments(input.segments, fallback, limits, `${path}/segments`)
  if (kind === 'polyline' && segments < spans) curveError('CURVE_INVALID', `${path}/segments`, `polyline segments must be at least ${spans} so authored vertices are not discarded.`)
  if (kind === 'polyline' && segments % spans !== 0) curveError('CURVE_INVALID', `${path}/segments`, `polyline segments must be a multiple of ${spans} so every authored vertex is sampled exactly.`)

  let tension: number | undefined
  if (kind === 'catmullRom') {
    const rawTension = input.tension ?? 0.5
    if (typeof rawTension !== 'number' || !Number.isFinite(rawTension) || rawTension < 0 || rawTension > 1) curveError('CURVE_INVALID', `${path}/tension`, 'catmullRom tension must be a finite number from 0 to 1.')
    tension = rawTension
  } else if (input.tension !== undefined) curveError('CURVE_INVALID', `${path}/tension`, 'tension is only valid for catmullRom curves.')

  if (kind === 'line' && distance3(points[0]!, points[1]!) <= CURVE_EPSILON) curveError('CURVE_DEGENERATE', `${path}/points`, 'Line endpoints must be distinct.')
  if ((kind === 'polyline' || kind === 'catmullRom') && consecutiveDuplicate(points, closed)) curveError('CURVE_DEGENERATE', `${path}/points`, 'Curve contains consecutive duplicate points.', 'Remove duplicate neighboring path points.')

  return {
    kind: kind as NormalizedCurveDefinition['kind'],
    points: points.map(point => [point[0], point[1], point[2]]),
    segments,
    ...(closed ? { closed: true } : {}),
    ...(tension === undefined ? {} : { tension }),
  }
}

function normalizeAnalytic(input: Record<string, unknown>, kind: 'arc' | 'circle' | 'helix', quality: GeometryQualityPreset, limits: GeometrySafetyLimits, path: string): NormalizedCurveDefinition {
  if (input.points !== undefined) curveError('CURVE_INVALID', `${path}/points`, `${kind} uses analytic parameters instead of points.`)
  if (input.closed !== undefined) curveError('CURVE_INVALID', `${path}/closed`, `${kind} manages its own open/closed state.`)
  if (input.tension !== undefined) curveError('CURVE_INVALID', `${path}/tension`, 'tension is only valid for catmullRom curves.')

  if (kind === 'helix') {
    const origin = finiteVec3(input.origin ?? [0, 0, 0], `${path}/origin`)
    const radius = finitePositive(input.radius, `${path}/radius`, 'radius')
    const height = finiteNumber(input.height, `${path}/height`, 'height')
    const turns = finiteNumber(input.turns, `${path}/turns`, 'turns')
    if (Math.abs(turns) <= CURVE_EPSILON) curveError('CURVE_DEGENERATE', `${path}/turns`, 'helix turns must be non-zero.')
    const startAngle = finiteNumber(input.startAngle ?? 0, `${path}/startAngle`, 'startAngle')
    const frame = normalizeFrame(input.axis ?? [0, 1, 0], input.radial, `${path}/axis`, `${path}/radial`)
    const fallbackSegments = Math.ceil(QUALITY[quality] * Math.max(1, Math.abs(turns)))
    const segments = normalizeSegments(input.segments, fallbackSegments, limits, `${path}/segments`, 3)
    const points: [number, number, number][] = []
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments
      const angle = startAngle + Math.PI * 2 * turns * t
      const radial = add3(scale3(frame.radial, Math.cos(angle) * radius), scale3(frame.perpendicular, Math.sin(angle) * radius))
      points.push(asMutable(add3(add3(origin, scale3(frame.axis, height * t)), radial)))
    }
    return { kind: 'polyline', points, segments }
  }

  const center = finiteVec3(input.center ?? [0, 0, 0], `${path}/center`)
  const radius = finitePositive(input.radius, `${path}/radius`, 'radius')
  const frame = normalizeFrame(input.normal ?? [0, 1, 0], input.radial, `${path}/normal`, `${path}/radial`)
  if (kind === 'circle') {
    const segments = normalizeSegments(input.segments, QUALITY[quality], limits, `${path}/segments`, 3)
    const points: [number, number, number][] = []
    for (let index = 0; index < segments; index += 1) {
      const angle = index / segments * Math.PI * 2
      points.push(asMutable(add3(center, add3(scale3(frame.radial, Math.cos(angle) * radius), scale3(frame.perpendicular, Math.sin(angle) * radius)))))
    }
    return { kind: 'polyline', points, segments, closed: true }
  }

  const startAngle = finiteNumber(input.startAngle, `${path}/startAngle`, 'startAngle')
  const endAngle = finiteNumber(input.endAngle, `${path}/endAngle`, 'endAngle')
  const span = endAngle - startAngle
  if (Math.abs(span) <= CURVE_EPSILON) curveError('CURVE_DEGENERATE', `${path}/endAngle`, 'arc startAngle and endAngle must describe a non-zero span.')
  const segments = normalizeSegments(input.segments, QUALITY[quality], limits, `${path}/segments`)
  const points: [number, number, number][] = []
  for (let index = 0; index <= segments; index += 1) {
    const angle = startAngle + span * (index / segments)
    points.push(asMutable(add3(center, add3(scale3(frame.radial, Math.cos(angle) * radius), scale3(frame.perpendicular, Math.sin(angle) * radius)))))
  }
  return { kind: 'polyline', points, segments }
}

function normalizeFrame(axisRaw: unknown, radialRaw: unknown, axisPath: string, radialPath: string): { axis: CurvePoint3; radial: CurvePoint3; perpendicular: CurvePoint3 } {
  const axisInput = finiteVec3(axisRaw, axisPath)
  const axisLength = Math.hypot(axisInput[0], axisInput[1], axisInput[2])
  if (axisLength <= CURVE_EPSILON) curveError('CURVE_INVALID', axisPath, 'Curve axis/normal must be non-zero.')
  const axis = normalize3(axisInput)
  let radialCandidate: CurvePoint3
  if (radialRaw === undefined) {
    const preferred: CurvePoint3 = Math.abs(dot3(axis, [1, 0, 0])) < 0.999 ? [1, 0, 0] : leastParallelAxis(axis)
    radialCandidate = projectPerpendicular(preferred, axis)
  } else {
    radialCandidate = projectPerpendicular(finiteVec3(radialRaw, radialPath), axis)
    if (Math.hypot(radialCandidate[0], radialCandidate[1], radialCandidate[2]) <= CURVE_EPSILON) curveError('CURVE_INVALID', radialPath, 'radial must not be parallel to the curve axis/normal.')
  }
  const radial = normalize3(radialCandidate, leastParallelAxis(axis))
  const perpendicular = normalize3(cross3(axis, radial), leastParallelAxis(axis))
  return { axis, radial, perpendicular }
}

function normalizeSegments(raw: unknown, fallback: number, limits: GeometrySafetyLimits, path: string, minimum = 1): number {
  const segments = raw ?? fallback
  if (typeof segments !== 'number' || !Number.isSafeInteger(segments) || segments < minimum || segments > limits.maxCurveSegments) {
    curveError('CURVE_INVALID', path, `segments must be a safe integer from ${minimum} to ${limits.maxCurveSegments}.`)
  }
  return segments
}

function normalizeQuality(raw: unknown, path: string): GeometryQualityPreset {
  if (raw !== 'low' && raw !== 'medium' && raw !== 'high' && raw !== 'ultra') curveError('CURVE_INVALID', path, 'quality must be low, medium, high, or ultra.')
  return raw
}

function finiteNumber(raw: unknown, path: string, name: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) curveError('CURVE_INVALID', path, `${name} must be a finite number.`)
  return raw
}
function finitePositive(raw: unknown, path: string, name: string): number {
  const value = finiteNumber(raw, path, name)
  if (value <= 0) curveError('CURVE_INVALID', path, `${name} must be greater than zero.`)
  return value
}
function finiteVec3(raw: unknown, path: string): CurvePoint3 {
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some(value => typeof value !== 'number' || !Number.isFinite(value))) curveError('CURVE_INVALID', path, 'Expected three finite numbers [x, y, z].')
  return [raw[0] as number, raw[1] as number, raw[2] as number]
}
function asMutable(point: CurvePoint3): [number, number, number] { return [point[0], point[1], point[2]] }

function normalizePoints(raw: unknown, path: string, maximum: number): CurvePoint3[] {
  if (!Array.isArray(raw)) curveError('CURVE_INVALID', path, 'points must be an array of [x, y, z] coordinates.')
  if (raw.length > maximum) curveError('CURVE_INVALID', path, `points exceeds the safety limit of ${maximum}.`)
  return raw.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 3 || point.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      curveError('CURVE_INVALID', `${path}/${index}`, 'Each curve point must be three finite numbers [x, y, z].')
    }
    return [point[0], point[1], point[2]] as CurvePoint3
  })
}
function validatePointCount(kind: string, count: number, path: string): void {
  const exact = kind === 'line' ? 2 : kind === 'quadraticBezier' ? 3 : kind === 'cubicBezier' ? 4 : undefined
  if (exact !== undefined && count !== exact) curveError('CURVE_INVALID', path, `${kind} requires exactly ${exact} points.`)
  if ((kind === 'polyline' || kind === 'catmullRom') && count < 2) curveError('CURVE_INVALID', path, `${kind} requires at least two points.`)
}
function consecutiveDuplicate(points: readonly CurvePoint3[], closed: boolean): boolean {
  for (let index = 1; index < points.length; index += 1) if (distance3(points[index - 1]!, points[index]!) <= CURVE_EPSILON) return true
  return closed && distance3(points[points.length - 1]!, points[0]!) <= CURVE_EPSILON
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) }
function curveError(code: Extract<GeometryIssue['code'], 'CURVE_INVALID' | 'CURVE_DEGENERATE'>, path: string, message: string, suggestion?: string): never {
  throw new GeometryValidationError([{ code, path, message, ...(suggestion ? { suggestion } : {}) }])
}
