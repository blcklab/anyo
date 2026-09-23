import type { GeometryDefinition, GeometryJsonValue } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { meshFromArrays, parameterError, type Vec2, withoutQuality } from './common.js'

const EPSILON = 1e-10

export const polygonGeometryKind: GeometryKindCompiler = {
  kind: 'polygon',
  normalize(definition, context) {
    const points = normalizePoints(definition.points as GeometryJsonValue | undefined, context.limits.maxProfilePoints)
    return { ...withoutQuality(definition), kind: 'polygon', points: points.map(point => [...point]) as GeometryJsonValue } as GeometryDefinition
  },
  compile(definition) {
    const points = definition.points as unknown as Vec2[]
    const indices = triangulate(points)
    const positions: number[] = [], normals: number[] = [], uvs: number[] = []
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const width = Math.max(EPSILON, maxX - minX), height = Math.max(EPSILON, maxY - minY)
    for (const [x, y] of points) { positions.push(x, y, 0); normals.push(0, 0, 1); uvs.push((x - minX) / width, (y - minY) / height) }
    return meshFromArrays(positions, indices, normals, uvs, [{ start: 0, count: indices.length, materialIndex: 0, name: 'surface' }])
  },
}

function normalizePoints(raw: GeometryJsonValue | undefined, maximum: number): Vec2[] {
  if (!Array.isArray(raw)) parameterError('/points', 'polygon points must be an array of [x, y] pairs.')
  if (raw.length > maximum) parameterError('/points', `polygon exceeds maximum profile point count ${maximum}.`)
  const cleaned: Vec2[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const point = raw[i]
    if (!Array.isArray(point) || point.length !== 2 || point.some(value => typeof value !== 'number' || !Number.isFinite(value))) parameterError(`/points/${i}`, 'polygon point must be [x, y] with finite numbers.')
    const next: Vec2 = [point[0] as number, point[1] as number]
    if (cleaned.length === 0 || distanceSquared(cleaned[cleaned.length - 1]!, next) > EPSILON * EPSILON) cleaned.push(next)
  }
  if (cleaned.length > 1 && distanceSquared(cleaned[0]!, cleaned[cleaned.length - 1]!) <= EPSILON * EPSILON) cleaned.pop()
  removeCollinear(cleaned)
  if (cleaned.length < 3) parameterError('/points', 'polygon requires at least three distinct points.')
  if (hasSelfIntersection(cleaned)) parameterError('/points', 'polygon must be simple and may not self-intersect.')
  let area = signedArea(cleaned)
  if (Math.abs(area) <= EPSILON) parameterError('/points', 'polygon area must be non-zero.')
  if (area < 0) cleaned.reverse()
  rotateCanonical(cleaned)
  area = signedArea(cleaned)
  if (area <= EPSILON) parameterError('/points', 'polygon winding normalization failed.')
  return cleaned
}


function removeCollinear(points: Vec2[]): void {
  let changed = true
  while (changed && points.length >= 3) {
    changed = false
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[(i - 1 + points.length) % points.length]!, curr = points[i]!, next = points[(i + 1) % points.length]!
      if (Math.abs(cross(prev, curr, next)) <= EPSILON) {
        points.splice(i, 1)
        changed = true
        break
      }
    }
  }
}

function rotateCanonical(points: Vec2[]): void {
  let best = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i]!, b = points[best]!
    if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) best = i
  }
  if (best > 0) points.push(...points.splice(0, best))
}

function triangulate(points: readonly Vec2[]): number[] {
  const remaining = points.map((_, index) => index), triangles: number[] = []
  let guard = 0
  while (remaining.length > 3) {
    let clipped = false
    for (let i = 0; i < remaining.length; i += 1) {
      const prev = remaining[(i - 1 + remaining.length) % remaining.length]!, curr = remaining[i]!, next = remaining[(i + 1) % remaining.length]!
      if (cross(points[prev]!, points[curr]!, points[next]!) <= EPSILON) continue
      let contains = false
      for (const candidate of remaining) {
        if (candidate === prev || candidate === curr || candidate === next) continue
        if (pointInTriangle(points[candidate]!, points[prev]!, points[curr]!, points[next]!)) { contains = true; break }
      }
      if (contains) continue
      triangles.push(prev, curr, next)
      remaining.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped || ++guard > points.length * points.length) parameterError('/points', 'polygon could not be triangulated; check collinear or degenerate edges.')
  }
  triangles.push(remaining[0]!, remaining[1]!, remaining[2]!)
  return triangles
}

function signedArea(points: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) { const a = points[i]!, b = points[(i + 1) % points.length]!; sum += a[0] * b[1] - b[0] * a[1] }
  return sum / 2
}
function cross(a: Vec2, b: Vec2, c: Vec2): number { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) }
function distanceSquared(a: Vec2, b: Vec2): number { const x = a[0] - b[0], y = a[1] - b[1]; return x * x + y * y }
function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const c1 = cross(a, b, p), c2 = cross(b, c, p), c3 = cross(c, a, p)
  return c1 >= -EPSILON && c2 >= -EPSILON && c3 >= -EPSILON
}
function hasSelfIntersection(points: readonly Vec2[]): boolean {
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!, b = points[(i + 1) % points.length]!
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i || j === (i + 1) % points.length || (j + 1) % points.length === i) continue
      const c = points[j]!, d = points[(j + 1) % points.length]!
      if (segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
}
