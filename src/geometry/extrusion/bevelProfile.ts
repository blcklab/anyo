import type { GeometryIssue } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import {
  PROFILE_EPSILON,
  contourHasSelfIntersection,
  contoursIntersectOrTouch,
  pointInContour,
  signedContourArea,
} from '../profiles/contourMath.js'
import type { NormalizedProfile, ProfilePoint } from '../profiles/types.js'

export function offsetProfile(profile: NormalizedProfile, amount: number, path = '/bevel'): NormalizedProfile {
  if (!Number.isFinite(amount) || amount < 0) bevelError(path, 'Bevel offset must be a finite non-negative number.')
  if (amount === 0) return profile
  const outer = offsetContour(profile.outer, amount, path)
  const holes = profile.holes.map((hole, index) => offsetContour(hole, amount, `${path}/holes/${index}`))
  validateOffsetProfile(outer, holes, path)
  return { outer, holes }
}

function offsetContour(contour: readonly ProfilePoint[], amount: number, path: string): ProfilePoint[] {
  const output: ProfilePoint[] = []
  for (let index = 0; index < contour.length; index += 1) {
    const previous = contour[(index - 1 + contour.length) % contour.length]!
    const current = contour[index]!
    const next = contour[(index + 1) % contour.length]!
    const prevDirection = unit(previous, current)
    const nextDirection = unit(current, next)
    const prevNormal: ProfilePoint = [-prevDirection[1], prevDirection[0]]
    const nextNormal: ProfilePoint = [-nextDirection[1], nextDirection[0]]
    const prevOrigin: ProfilePoint = [current[0] + prevNormal[0] * amount, current[1] + prevNormal[1] * amount]
    const nextOrigin: ProfilePoint = [current[0] + nextNormal[0] * amount, current[1] + nextNormal[1] * amount]
    const denominator = cross2(prevDirection, nextDirection)
    if (Math.abs(denominator) <= PROFILE_EPSILON) bevelError(path, 'Bevel offset encountered an unstable nearly-parallel corner.')
    const delta: ProfilePoint = [nextOrigin[0] - prevOrigin[0], nextOrigin[1] - prevOrigin[1]]
    const t = cross2(delta, nextDirection) / denominator
    const point: ProfilePoint = [prevOrigin[0] + prevDirection[0] * t, prevOrigin[1] + prevDirection[1] * t]
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) bevelError(path, 'Bevel offset produced non-finite coordinates.')
    if (Math.hypot(point[0] - current[0], point[1] - current[1]) > Math.max(amount * 32, 1e-6)) {
      bevelError(path, 'Bevel offset creates an excessive miter at a sharp corner.', 'Reduce bevel size or simplify the profile corner.')
    }
    output.push(point)
  }
  return output
}

function validateOffsetProfile(outer: readonly ProfilePoint[], holes: readonly (readonly ProfilePoint[])[], path: string): void {
  if (signedContourArea(outer) <= PROFILE_EPSILON || contourHasSelfIntersection(outer)) bevelError(path, 'Bevel collapses or self-intersects the outer profile.', 'Reduce bevel size.')
  for (let index = 0; index < holes.length; index += 1) {
    const hole = holes[index]!
    if (signedContourArea(hole) >= -PROFILE_EPSILON || contourHasSelfIntersection(hole)) bevelError(path, `Bevel collapses or self-intersects hole ${index}.`, 'Reduce bevel size.')
    if (!pointInContour(hole[0]!, outer, false) || contoursIntersectOrTouch(outer, hole)) bevelError(path, `Bevel makes hole ${index} touch or escape the outer contour.`, 'Reduce bevel size.')
    for (let other = 0; other < index; other += 1) {
      const candidate = holes[other]!
      if (contoursIntersectOrTouch(candidate, hole) || pointInContour(hole[0]!, candidate, true) || pointInContour(candidate[0]!, hole, true)) {
        bevelError(path, `Bevel causes hole ${index} to overlap another hole.`, 'Reduce bevel size.')
      }
    }
  }
}

function unit(a: ProfilePoint, b: ProfilePoint): ProfilePoint {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
  if (length <= PROFILE_EPSILON) bevelError('/bevel', 'Bevel encountered a zero-length profile edge.')
  return [dx / length, dy / length]
}
function cross2(a: ProfilePoint, b: ProfilePoint): number { return a[0] * b[1] - a[1] * b[0] }
function bevelError(path: string, message: string, suggestion = 'Reduce bevel size or simplify the profile.'): never {
  const issue: GeometryIssue = { code: 'EXTRUSION_BEVEL_COLLAPSE', path, message, suggestion }
  throw new GeometryValidationError([issue])
}
