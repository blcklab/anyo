import type { GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import type { CsgPlane, CsgPolygon, CsgVec3, CsgVertex } from './types.js'

const COPLANAR = 0
const FRONT = 1
const BACK = 2
const SPANNING = 3

export class CsgWorkBudget {
  readonly epsilon: number
  readonly maxTreeDepth: number
  readonly maxWork: number
  #work = 0

  constructor(limits: GeometrySafetyLimits, epsilon: number) {
    this.epsilon = epsilon
    this.maxTreeDepth = Math.min(256, Math.max(32, limits.maxBooleanDepth * 16))
    // Boolean splitting can temporarily exceed final triangle counts. Keep a conservative
    // derived budget without adding another public safety knob in S8.
    this.maxWork = Math.min(600_000, Math.max(20_000, limits.maxGeometryIndices))
  }

  consume(amount = 1): void {
    this.#work += amount
    if (this.#work > this.maxWork) {
      throw new GeometryValidationError([{
        code: 'CSG_COMPLEXITY_LIMIT', path: '/',
        message: `Boolean geometry exceeded its derived work budget (${this.maxWork} polygon operations).`,
        suggestion: 'Reduce operand segment counts, simplify the solids, or split the Boolean into smaller staged operations.',
      }])
    }
  }

  assertTreeDepth(depth: number): void {
    if (depth > this.maxTreeDepth) {
      throw new GeometryValidationError([{
        code: 'CSG_COMPLEXITY_LIMIT', path: '/',
        message: `Boolean BSP tree exceeded its safe depth (${this.maxTreeDepth}).`,
        suggestion: 'Simplify highly coplanar/fragmented operands or reduce primitive quality before the Boolean.',
      }])
    }
  }
}

export class BspNode {
  plane?: CsgPlane
  polygons: CsgPolygon[] = []
  front?: BspNode
  back?: BspNode
  readonly #budget: CsgWorkBudget
  readonly #depth: number

  constructor(polygons: CsgPolygon[] = [], budget: CsgWorkBudget, depth = 0) {
    this.#budget = budget
    this.#depth = depth
    this.#budget.assertTreeDepth(depth)
    if (polygons.length > 0) this.build(polygons)
  }

  invert(): void {
    this.polygons = this.polygons.map(flipPolygon)
    if (this.plane) this.plane = flipPlane(this.plane)
    this.front?.invert()
    this.back?.invert()
    const front = this.front
    this.front = this.back
    this.back = front
  }

  clipPolygons(polygons: readonly CsgPolygon[]): CsgPolygon[] {
    if (!this.plane) return polygons.slice()
    let front: CsgPolygon[] = []
    let back: CsgPolygon[] = []
    for (const polygon of polygons) {
      this.#budget.consume()
      splitPolygon(this.plane, polygon, front, back, front, back, this.#budget)
    }
    if (this.front) front = this.front.clipPolygons(front)
    if (this.back) back = this.back.clipPolygons(back)
    else back = []
    return front.concat(back)
  }

  clipTo(node: BspNode): void {
    this.polygons = node.clipPolygons(this.polygons)
    this.front?.clipTo(node)
    this.back?.clipTo(node)
  }

  allPolygons(): CsgPolygon[] {
    let polygons = this.polygons.slice()
    if (this.front) polygons = polygons.concat(this.front.allPolygons())
    if (this.back) polygons = polygons.concat(this.back.allPolygons())
    return polygons
  }

  build(polygons: readonly CsgPolygon[]): void {
    if (polygons.length === 0) return
    this.#budget.assertTreeDepth(this.#depth)
    if (!this.plane) this.plane = clonePlane(polygons[0]!.plane)
    const front: CsgPolygon[] = []
    const back: CsgPolygon[] = []
    for (const polygon of polygons) {
      this.#budget.consume()
      splitPolygon(this.plane, polygon, this.polygons, this.polygons, front, back, this.#budget)
    }
    if (front.length > 0) {
      this.front ??= new BspNode([], this.#budget, this.#depth + 1)
      this.front.build(front)
    }
    if (back.length > 0) {
      this.back ??= new BspNode([], this.#budget, this.#depth + 1)
      this.back.build(back)
    }
  }
}

export function splitPolygon(
  plane: CsgPlane,
  polygon: CsgPolygon,
  coplanarFront: CsgPolygon[],
  coplanarBack: CsgPolygon[],
  front: CsgPolygon[],
  back: CsgPolygon[],
  budget: CsgWorkBudget,
): void {
  let polygonType = COPLANAR
  const types: number[] = []
  for (const vertex of polygon.vertices) {
    const distance = dot(plane.normal, vertex.position) - plane.w
    const type = distance < -budget.epsilon ? BACK : distance > budget.epsilon ? FRONT : COPLANAR
    polygonType |= type
    types.push(type)
  }

  switch (polygonType) {
    case COPLANAR:
      (dot(plane.normal, polygon.plane.normal) >= 0 ? coplanarFront : coplanarBack).push(polygon)
      return
    case FRONT:
      front.push(polygon)
      return
    case BACK:
      back.push(polygon)
      return
    default: {
      const frontVertices: CsgVertex[] = []
      const backVertices: CsgVertex[] = []
      for (let index = 0; index < polygon.vertices.length; index += 1) {
        const next = (index + 1) % polygon.vertices.length
        const type = types[index]!
        const nextType = types[next]!
        const vertex = polygon.vertices[index]!
        const nextVertex = polygon.vertices[next]!
        if (type !== BACK) frontVertices.push(vertex)
        if (type !== FRONT) backVertices.push(vertex)
        if ((type | nextType) === SPANNING) {
          const direction = subtract(nextVertex.position, vertex.position)
          const denominator = dot(plane.normal, direction)
          if (Math.abs(denominator) <= Number.EPSILON) {
            throw new GeometryValidationError([{
              code: 'CSG_NUMERICAL_FAILURE', path: '/',
              message: 'Boolean edge/plane intersection became numerically unstable.',
              suggestion: 'Avoid nearly coincident surfaces or move one operand by a small meaningful distance.',
            }])
          }
          const t = clamp((plane.w - dot(plane.normal, vertex.position)) / denominator, 0, 1)
          const split = interpolateVertex(vertex, nextVertex, t)
          frontVertices.push(split)
          backVertices.push(split)
        }
      }
      const cleanFront = sanitizeVertices(frontVertices, budget.epsilon)
      const cleanBack = sanitizeVertices(backVertices, budget.epsilon)
      if (cleanFront.length >= 3) {
        budget.consume(cleanFront.length)
        front.push({ ...polygon, vertices: cleanFront })
      }
      if (cleanBack.length >= 3) {
        budget.consume(cleanBack.length)
        back.push({ ...polygon, vertices: cleanBack })
      }
    }
  }
}

export function flipPolygon(polygon: CsgPolygon): CsgPolygon {
  return {
    ...polygon,
    vertices: polygon.vertices.slice().reverse().map(flipVertex),
    plane: flipPlane(polygon.plane),
  }
}

function flipVertex(vertex: CsgVertex): CsgVertex {
  return {
    ...vertex,
    position: [...vertex.position],
    ...(vertex.normal ? { normal: scale(vertex.normal, -1) } : {}),
    ...(vertex.uv ? { uv: [...vertex.uv] as [number, number] } : {}),
    ...(vertex.tangent ? { tangent: [vertex.tangent[0], vertex.tangent[1], vertex.tangent[2], -vertex.tangent[3]] as [number, number, number, number] } : {}),
    ...(vertex.color ? { color: [...vertex.color] as [number, number, number, number] } : {}),
  }
}

function interpolateVertex(a: CsgVertex, b: CsgVertex, t: number): CsgVertex {
  const position = lerp3(a.position, b.position, t)
  const normal = a.normal && b.normal ? normalize(lerp3(a.normal, b.normal, t)) : undefined
  const uv = a.uv && b.uv ? [lerp(a.uv[0], b.uv[0], t), lerp(a.uv[1], b.uv[1], t)] as [number, number] : undefined
  let tangent: [number, number, number, number] | undefined
  if (a.tangent && b.tangent) {
    const xyz = normalize([
      lerp(a.tangent[0], b.tangent[0], t),
      lerp(a.tangent[1], b.tangent[1], t),
      lerp(a.tangent[2], b.tangent[2], t),
    ])
    tangent = [xyz[0], xyz[1], xyz[2], t < 0.5 ? a.tangent[3] : b.tangent[3]]
  }
  const color = a.color && b.color ? [
    lerp(a.color[0], b.color[0], t), lerp(a.color[1], b.color[1], t),
    lerp(a.color[2], b.color[2], t), lerp(a.color[3], b.color[3], t),
  ] as [number, number, number, number] : undefined
  return { position, ...(normal ? { normal } : {}), ...(uv ? { uv } : {}), ...(tangent ? { tangent } : {}), ...(color ? { color } : {}) }
}

function sanitizeVertices(vertices: CsgVertex[], epsilon: number): CsgVertex[] {
  const output: CsgVertex[] = []
  for (const vertex of vertices) {
    if (output.length === 0 || distanceSquared(output[output.length - 1]!.position, vertex.position) > epsilon * epsilon) output.push(vertex)
  }
  if (output.length > 2 && distanceSquared(output[0]!.position, output[output.length - 1]!.position) <= epsilon * epsilon) output.pop()
  if (output.length < 4) return output
  let changed = true
  while (changed && output.length > 3) {
    changed = false
    for (let index = 0; index < output.length; index += 1) {
      const previous = output[(index - 1 + output.length) % output.length]!.position
      const current = output[index]!.position
      const next = output[(index + 1) % output.length]!.position
      const a = subtract(current, previous)
      const b = subtract(next, current)
      const crossLength = length(cross(a, b))
      const scaleLength = Math.max(epsilon, length(a) + length(b))
      if (crossLength <= epsilon * scaleLength) {
        output.splice(index, 1)
        changed = true
        break
      }
    }
  }
  return output
}

function flipPlane(plane: CsgPlane): CsgPlane { return { normal: scale(plane.normal, -1), w: -plane.w } }
function clonePlane(plane: CsgPlane): CsgPlane { return { normal: [...plane.normal], w: plane.w } }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
function lerp3(a: CsgVec3, b: CsgVec3, t: number): CsgVec3 { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] }
function subtract(a: CsgVec3, b: CsgVec3): CsgVec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function scale(a: CsgVec3, scalar: number): CsgVec3 { return [a[0] * scalar, a[1] * scalar, a[2] * scalar] }
function dot(a: CsgVec3, b: CsgVec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross(a: CsgVec3, b: CsgVec3): CsgVec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function length(value: CsgVec3): number { return Math.hypot(value[0], value[1], value[2]) }
function normalize(value: CsgVec3): CsgVec3 { const l = length(value); return l <= 1e-15 ? [1, 0, 0] : [value[0] / l, value[1] / l, value[2] / l] }
function distanceSquared(a: CsgVec3, b: CsgVec3): number { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)) }
