import type { GeometryIssue } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import {
  PROFILE_EPSILON,
  contourCross,
  pointInContour,
  pointOnSegment,
  pointsEqual,
  profilePointDistanceSquared,
  segmentsIntersectOrTouch,
} from '../profiles/contourMath.js'
import type { NormalizedProfile, ProfilePoint } from '../profiles/types.js'

export interface TriangulatedProfile {
  /** Weakly-simple cap contour after deterministic hole bridging. */
  points: readonly ProfilePoint[]
  /** CCW triangle-list indices facing +Z. */
  indices: readonly number[]
}

export function triangulateProfile(profile: NormalizedProfile, path = '/profile'): TriangulatedProfile {
  let polygon = profile.outer.map(copyPoint)
  const contours: readonly (readonly ProfilePoint[])[] = [profile.outer, ...profile.holes]
  for (let holeIndex = 0; holeIndex < profile.holes.length; holeIndex += 1) {
    const hole = profile.holes[holeIndex]!
    const holeVertex = 0 // normalized contours are canonically rotated to their leftmost point
    const bridge = selectBridge(polygon, hole[holeVertex]!, contours)
    if (bridge < 0) triangulationError(`${path}/holes/${holeIndex}`, 'No deterministic visibility bridge could be found for this hole.')
    polygon = spliceHole(polygon, hole, bridge, holeVertex)
  }
  const indices = earClipWeakPolygon(polygon, path)
  if (indices.length === 0) triangulationError(path, 'Profile triangulation produced no triangles.')
  return Object.freeze({
    points: Object.freeze(polygon.map(point => Object.freeze([point[0], point[1]]) as ProfilePoint)),
    indices: Object.freeze(indices),
  })
}

function selectBridge(
  polygon: readonly ProfilePoint[],
  holePoint: ProfilePoint,
  originalContours: readonly (readonly ProfilePoint[])[],
): number {
  let best = -1, bestDistance = Infinity
  for (let candidateIndex = 0; candidateIndex < polygon.length; candidateIndex += 1) {
    const candidate = polygon[candidateIndex]!
    if (pointsEqual(candidate, holePoint)) continue
    const distance = profilePointDistanceSquared(candidate, holePoint)
    if (distance <= PROFILE_EPSILON * PROFILE_EPSILON) continue
    if (!bridgeStaysInMaterial(candidate, holePoint, polygon, originalContours)) continue
    if (distance < bestDistance - PROFILE_EPSILON
      || (Math.abs(distance - bestDistance) <= PROFILE_EPSILON && compareBridgeCandidate(candidate, candidateIndex, polygon[best]!, best) < 0)) {
      best = candidateIndex
      bestDistance = distance
    }
  }
  return best
}

function bridgeStaysInMaterial(
  a: ProfilePoint,
  b: ProfilePoint,
  polygon: readonly ProfilePoint[],
  originalContours: readonly (readonly ProfilePoint[])[],
): boolean {
  // Do not cross the already-bridged weak polygon except at the chosen polygon endpoint.
  for (let index = 0; index < polygon.length; index += 1) {
    const c = polygon[index]!, d = polygon[(index + 1) % polygon.length]!
    if (pointsEqual(c, a) || pointsEqual(d, a)) continue
    if (segmentHitsAwayFromEndpoint(a, b, c, d, a, b)) return false
  }
  // Do not cross any authored boundary except at the hole bridge endpoint.
  for (const contour of originalContours) {
    for (let index = 0; index < contour.length; index += 1) {
      const c = contour[index]!, d = contour[(index + 1) % contour.length]!
      if (pointsEqual(c, a) || pointsEqual(d, a) || pointsEqual(c, b) || pointsEqual(d, b)) continue
      if (segmentHitsAwayFromEndpoint(a, b, c, d, a, b)) return false
    }
  }
  // Sample the open bridge; every point must lie in solid profile area.
  for (const t of [0.2, 0.5, 0.8]) {
    const sample: ProfilePoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    if (!pointInContour(sample, originalContours[0]!, true)) return false
    for (let index = 1; index < originalContours.length; index += 1) {
      if (pointInContour(sample, originalContours[index]!, false)) return false
    }
  }
  return true
}

function segmentHitsAwayFromEndpoint(
  a: ProfilePoint, b: ProfilePoint, c: ProfilePoint, d: ProfilePoint,
  allowedA: ProfilePoint, allowedB: ProfilePoint,
): boolean {
  if (!segmentsIntersectOrTouch(a, b, c, d)) return false
  for (const point of [c, d]) {
    if ((pointsEqual(point, allowedA) || pointsEqual(point, allowedB)) && pointOnSegment(point, a, b)) return false
  }
  return true
}

function spliceHole(
  polygon: readonly ProfilePoint[],
  hole: readonly ProfilePoint[],
  polygonIndex: number,
  holeIndex: number,
): ProfilePoint[] {
  const ordered = hole.map((_, offset) => copyPoint(hole[(holeIndex + offset) % hole.length]!))
  const bridgePoint = copyPoint(polygon[polygonIndex]!)
  const firstHole = copyPoint(ordered[0]!)
  return [
    ...polygon.slice(0, polygonIndex + 1).map(copyPoint),
    firstHole,
    ...ordered.slice(1),
    copyPoint(firstHole),
    bridgePoint,
    ...polygon.slice(polygonIndex + 1).map(copyPoint),
  ]
}

function earClipWeakPolygon(points: readonly ProfilePoint[], path: string): number[] {
  const remaining = points.map((_, index) => index)
  const triangles: number[] = []
  let guard = 0
  const guardLimit = Math.max(64, points.length * points.length * 2)
  while (remaining.length > 3) {
    let clipped = false
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length]!
      const current = remaining[cursor]!
      const next = remaining[(cursor + 1) % remaining.length]!
      const a = points[previous]!, b = points[current]!, c = points[next]!
      if (contourCross(a, b, c) <= PROFILE_EPSILON) continue
      let contains = false
      for (const candidateIndex of remaining) {
        if (candidateIndex === previous || candidateIndex === current || candidateIndex === next) continue
        const candidate = points[candidateIndex]!
        if (pointsEqual(candidate, a) || pointsEqual(candidate, b) || pointsEqual(candidate, c)) continue
        if (pointStrictlyInTriangle(candidate, a, b, c)) { contains = true; break }
      }
      if (contains) continue
      triangles.push(previous, current, next)
      remaining.splice(cursor, 1)
      clipped = true
      break
    }
    guard += 1
    if (!clipped || guard > guardLimit) triangulationError(path, 'Profile could not be triangulated deterministically; check degenerate or numerically ambiguous edges.')
  }
  if (remaining.length === 3 && contourCross(points[remaining[0]!]!, points[remaining[1]!]!, points[remaining[2]!]!) > PROFILE_EPSILON) {
    triangles.push(remaining[0]!, remaining[1]!, remaining[2]!)
  }
  return triangles
}

function pointStrictlyInTriangle(point: ProfilePoint, a: ProfilePoint, b: ProfilePoint, c: ProfilePoint): boolean {
  return contourCross(a, b, point) > PROFILE_EPSILON
    && contourCross(b, c, point) > PROFILE_EPSILON
    && contourCross(c, a, point) > PROFILE_EPSILON
}
function compareBridgeCandidate(a: ProfilePoint, ai: number, b: ProfilePoint | undefined, bi: number): number {
  if (!b || bi < 0) return -1
  return a[0] - b[0] || a[1] - b[1] || ai - bi
}
function copyPoint(point: ProfilePoint): ProfilePoint { return [point[0], point[1]] }
function triangulationError(path: string, message: string): never {
  const issue: GeometryIssue = {
    code: 'PROFILE_TRIANGULATION_FAILED', path, message,
    suggestion: 'Simplify the contour, separate nearby boundaries, or remove numerically ambiguous points.',
  }
  throw new GeometryValidationError([issue])
}
