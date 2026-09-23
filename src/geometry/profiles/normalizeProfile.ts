import type { GeometryIssue, GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import {
  PROFILE_EPSILON,
  contourCross,
  contourHasSelfIntersection,
  contoursIntersectOrTouch,
  pointInContour,
  pointsEqual,
  signedContourArea,
} from './contourMath.js'
import type { NormalizedProfile, ProfileDefinition, ProfilePoint } from './types.js'

export function normalizeProfile(
  input: unknown,
  options: { limits?: Partial<GeometrySafetyLimits>; path?: string } = {},
): NormalizedProfile {
  const limits = resolveGeometrySafetyLimits(options.limits)
  const path = options.path ?? '/profile'
  if (!isPlainRecord(input)) profileError('PROFILE_INVALID', path, 'Profile must be a plain object with points and optional holes.')
  const outer = normalizeContour(input.points, `${path}/points`, limits.maxProfilePoints, 'ccw')
  const rawHoles = input.holes ?? []
  if (!Array.isArray(rawHoles)) profileError('PROFILE_INVALID', `${path}/holes`, 'Profile holes must be an array of contours.')
  let totalPoints = outer.length
  const holes = rawHoles.map((hole, index) => {
    const normalized = normalizeContour(hole, `${path}/holes/${index}`, limits.maxProfilePoints, 'cw')
    totalPoints += normalized.length
    if (totalPoints > limits.maxProfilePoints) profileError('GEOMETRY_DEFINITION_LIMIT', `${path}/holes`, `Profile exceeds maximum combined point count ${limits.maxProfilePoints}.`)
    return normalized
  })

  for (let index = 0; index < holes.length; index += 1) {
    const hole = holes[index]!
    if (!pointInContour(hole[0]!, outer, false) || contoursIntersectOrTouch(outer, hole)) {
      profileError('PROFILE_HOLE_OUTSIDE', `${path}/holes/${index}`, 'Hole must be strictly inside the outer contour without touching its boundary.')
    }
    for (let other = 0; other < index; other += 1) {
      const candidate = holes[other]!
      if (contoursIntersectOrTouch(candidate, hole)
        || pointInContour(hole[0]!, candidate, true)
        || pointInContour(candidate[0]!, hole, true)) {
        profileError('PROFILE_HOLE_OVERLAP', `${path}/holes/${index}`, 'Profile holes may not touch, overlap, or contain one another.')
      }
    }
  }

  const sortedHoles = [...holes].sort(compareContours)
  return freezeProfile({ outer, holes: sortedHoles })
}

function normalizeContour(raw: unknown, path: string, maximum: number, winding: 'ccw' | 'cw'): ProfilePoint[] {
  if (!Array.isArray(raw)) profileError('PROFILE_INVALID', path, 'Contour must be an array of [x, y] pairs.')
  if (raw.length > maximum) profileError('GEOMETRY_DEFINITION_LIMIT', path, `Contour exceeds maximum profile point count ${maximum}.`)
  const points: ProfilePoint[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index]
    if (!Array.isArray(value) || value.length !== 2 || value.some(component => typeof component !== 'number' || !Number.isFinite(component))) {
      profileError('PROFILE_INVALID', `${path}/${index}`, 'Profile point must be [x, y] with finite numbers.')
    }
    const point: ProfilePoint = [value[0] as number, value[1] as number]
    if (points.length === 0 || !pointsEqual(points[points.length - 1]!, point)) points.push(point)
  }
  if (points.length > 1 && pointsEqual(points[0]!, points[points.length - 1]!)) points.pop()
  removeCollinear(points)
  if (points.length < 3) profileError('PROFILE_INVALID', path, 'Contour requires at least three distinct non-collinear points.')
  if (contourHasSelfIntersection(points)) profileError('PROFILE_SELF_INTERSECTION', path, 'Contour contains intersecting or touching non-adjacent edges.', 'Reorder or remove the intersecting contour segments.')
  const area = signedContourArea(points)
  if (Math.abs(area) <= PROFILE_EPSILON) profileError('PROFILE_INVALID', path, 'Contour area must be non-zero.')
  if ((winding === 'ccw' && area < 0) || (winding === 'cw' && area > 0)) points.reverse()
  rotateCanonical(points)
  return points
}

function removeCollinear(points: ProfilePoint[]): void {
  let changed = true
  while (changed && points.length >= 3) {
    changed = false
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length]!, current = points[index]!, next = points[(index + 1) % points.length]!
      if (Math.abs(contourCross(previous, current, next)) <= PROFILE_EPSILON) {
        points.splice(index, 1)
        changed = true
        break
      }
    }
  }
}

function rotateCanonical(points: ProfilePoint[]): void {
  let best = 0
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index]!, candidate = points[best]!
    if (current[0] < candidate[0] || (current[0] === candidate[0] && current[1] < candidate[1])) best = index
  }
  if (best > 0) points.push(...points.splice(0, best))
}

function compareContours(a: readonly ProfilePoint[], b: readonly ProfilePoint[]): number {
  const ap = leftmost(a), bp = leftmost(b)
  return ap[0] - bp[0] || ap[1] - bp[1] || a.length - b.length || JSON.stringify(a).localeCompare(JSON.stringify(b))
}
function leftmost(points: readonly ProfilePoint[]): ProfilePoint {
  return points.reduce((best, point) => point[0] < best[0] || (point[0] === best[0] && point[1] < best[1]) ? point : best)
}
function freezeProfile(profile: { outer: ProfilePoint[]; holes: ProfilePoint[][] }): NormalizedProfile {
  return Object.freeze({
    outer: Object.freeze(profile.outer.map(point => Object.freeze([point[0], point[1]]) as ProfilePoint)),
    holes: Object.freeze(profile.holes.map(hole => Object.freeze(hole.map(point => Object.freeze([point[0], point[1]]) as ProfilePoint)))),
  })
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function profileError(code: GeometryIssue['code'], path: string, message: string, suggestion?: string): never {
  throw new GeometryValidationError([{ code, path, message, ...(suggestion ? { suggestion } : {}) }])
}
