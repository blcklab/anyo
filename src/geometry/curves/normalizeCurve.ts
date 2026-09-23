import type { CurveDefinition, GeometryIssue, GeometryQualityPreset, GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import type { CurvePoint3, NormalizedCurveDefinition } from './types.js'
import { distance3, CURVE_EPSILON } from './vector.js'

const KINDS = new Set(['line', 'polyline', 'quadraticBezier', 'cubicBezier', 'catmullRom'])
const QUALITY: Record<GeometryQualityPreset, number> = { low: 8, medium: 16, high: 32, ultra: 64 }
const CATMULL_QUALITY: Record<GeometryQualityPreset, number> = { low: 4, medium: 8, high: 16, ultra: 32 }

export interface NormalizeCurveOptions { limits?: Partial<GeometrySafetyLimits>; path?: string; quality?: GeometryQualityPreset }

export function normalizeCurve(input: unknown, options: NormalizeCurveOptions = {}): NormalizedCurveDefinition {
  const limits = resolveGeometrySafetyLimits(options.limits)
  const path = options.path ?? '/path'
  if (!isRecord(input)) curveError('CURVE_INVALID', path, 'Curve must be a plain JSON object.')
  const kind = input.kind
  if (typeof kind !== 'string' || !KINDS.has(kind)) curveError('CURVE_INVALID', `${path}/kind`, 'Curve kind must be line, polyline, quadraticBezier, cubicBezier, or catmullRom.')
  const points = normalizePoints(input.points, `${path}/points`, limits.maxProfilePoints)
  validatePointCount(kind, points.length, `${path}/points`)

  const closed = input.closed ?? false
  if (typeof closed !== 'boolean') curveError('CURVE_INVALID', `${path}/closed`, 'closed must be boolean.')
  if (closed && kind !== 'polyline' && kind !== 'catmullRom') curveError('CURVE_INVALID', `${path}/closed`, `${kind} curves do not support closed=true.`)
  if (closed && points.length < 3) curveError('CURVE_INVALID', `${path}/points`, 'Closed curves require at least three distinct points.')

  const quality = (input.quality ?? options.quality ?? 'medium') as GeometryQualityPreset
  if (!(quality in QUALITY)) curveError('CURVE_INVALID', `${path}/quality`, 'quality must be low, medium, high, or ultra.')
  const spans = closed ? points.length : Math.max(1, points.length - 1)
  const fallback = kind === 'line' ? 1 : kind === 'polyline' ? spans : kind === 'catmullRom' ? spans * CATMULL_QUALITY[quality] : QUALITY[quality]
  const segments = input.segments ?? fallback
  if (typeof segments !== 'number' || !Number.isSafeInteger(segments) || segments < 1 || segments > limits.maxCurveSegments) {
    curveError('CURVE_INVALID', `${path}/segments`, `segments must be a safe integer from 1 to ${limits.maxCurveSegments}.`)
  }
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
