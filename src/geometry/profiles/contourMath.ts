import type { ProfilePoint } from './types.js'

export const PROFILE_EPSILON = 1e-9

export function signedContourArea(points: readonly ProfilePoint[]): number {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!, b = points[(index + 1) % points.length]!
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

export function contourCross(a: ProfilePoint, b: ProfilePoint, c: ProfilePoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

export function profilePointDistanceSquared(a: ProfilePoint, b: ProfilePoint): number {
  const dx = a[0] - b[0], dy = a[1] - b[1]
  return dx * dx + dy * dy
}

export function pointsEqual(a: ProfilePoint, b: ProfilePoint, epsilon = PROFILE_EPSILON): boolean {
  return profilePointDistanceSquared(a, b) <= epsilon * epsilon
}

export function pointOnSegment(point: ProfilePoint, a: ProfilePoint, b: ProfilePoint, epsilon = PROFILE_EPSILON): boolean {
  if (Math.abs(contourCross(a, b, point)) > epsilon) return false
  return point[0] >= Math.min(a[0], b[0]) - epsilon && point[0] <= Math.max(a[0], b[0]) + epsilon
    && point[1] >= Math.min(a[1], b[1]) - epsilon && point[1] <= Math.max(a[1], b[1]) + epsilon
}

export function segmentsIntersectOrTouch(a: ProfilePoint, b: ProfilePoint, c: ProfilePoint, d: ProfilePoint, epsilon = PROFILE_EPSILON): boolean {
  const abC = contourCross(a, b, c), abD = contourCross(a, b, d)
  const cdA = contourCross(c, d, a), cdB = contourCross(c, d, b)
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true
  return pointOnSegment(c, a, b, epsilon) || pointOnSegment(d, a, b, epsilon)
    || pointOnSegment(a, c, d, epsilon) || pointOnSegment(b, c, d, epsilon)
}

export function pointInContour(point: ProfilePoint, contour: readonly ProfilePoint[], includeBoundary = true): boolean {
  let inside = false
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
    const a = contour[previous]!, b = contour[index]!
    if (pointOnSegment(point, a, b)) return includeBoundary
    const crosses = (a[1] > point[1]) !== (b[1] > point[1])
    if (!crosses) continue
    const x = (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]
    if (point[0] < x) inside = !inside
  }
  return inside
}

export function contourHasSelfIntersection(points: readonly ProfilePoint[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const a = points[first]!, b = points[(first + 1) % points.length]!
    for (let second = first + 1; second < points.length; second += 1) {
      if (second === first || second === (first + 1) % points.length || (second + 1) % points.length === first) continue
      const c = points[second]!, d = points[(second + 1) % points.length]!
      if (segmentsIntersectOrTouch(a, b, c, d)) return true
    }
  }
  return false
}

export function contoursIntersectOrTouch(a: readonly ProfilePoint[], b: readonly ProfilePoint[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const a0 = a[i]!, a1 = a[(i + 1) % a.length]!
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsIntersectOrTouch(a0, a1, b[j]!, b[(j + 1) % b.length]!)) return true
    }
  }
  return false
}

export function contourPerimeter(points: readonly ProfilePoint[]): number {
  let length = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!, b = points[(index + 1) % points.length]!
    length += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return length
}
