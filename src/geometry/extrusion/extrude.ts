import type {
  ExtrudeBevelDefinition,
  GeometryDefinition,
  GeometryGroup,
  GeometryJsonValue,
  GeometryMeshDraft,
  GeometryUvPolicy,
} from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { indexArray, parameterError, withoutQuality } from '../primitives/common.js'
import { normalizeProfile } from '../profiles/normalizeProfile.js'
import { contourPerimeter, PROFILE_EPSILON } from '../profiles/contourMath.js'
import type { NormalizedProfile, ProfilePoint } from '../profiles/types.js'
import { triangulateProfile } from '../triangulation/triangulateProfile.js'
import { offsetProfile } from './bevelProfile.js'

interface ResolvedBevel { size: number; segments: number }
interface MeshBuilder { positions: number[]; indices: number[]; normals: number[]; uvs: number[]; groups: GeometryGroup[] }

export const extrudeGeometryKind: GeometryKindCompiler = {
  kind: 'extrude',
  normalize(definition, context) {
    const profile = normalizeProfile(definition.profile, { limits: context.limits, path: '/profile' })
    const depth = finitePositive(definition.depth, '/depth', 'depth')
    const cap = definition.cap ?? true
    if (typeof cap !== 'boolean') parameterError('/cap', 'cap must be boolean.')
    const bevel = normalizeBevel(definition.bevel, depth, context.limits.maxCurveSegments)
    const base = withoutQuality(definition)
    return {
      ...base,
      kind: 'extrude',
      profile: profileToJson(profile),
      depth,
      cap,
      ...(bevel ? { bevel } : {}),
    } as unknown as GeometryDefinition
  },
  compile(definition, context) {
    const profile = normalizeProfile(definition.profile, { limits: context.limits, path: '/profile' })
    const depth = definition.depth as number
    const cap = definition.cap as boolean
    const bevel = definition.bevel as unknown as ResolvedBevel | undefined
    return buildExtrusion(profile, depth, cap, bevel, definition.uv)
  },
}

function buildExtrusion(
  profile: NormalizedProfile,
  depth: number,
  cap: boolean,
  bevel: ResolvedBevel | undefined,
  uvPolicy: GeometryUvPolicy | undefined,
): GeometryMeshDraft {
  const half = depth / 2
  const builder: MeshBuilder = { positions: [], indices: [], normals: [], uvs: [], groups: [] }
  const bevelSize = bevel?.size ?? 0
  const frontSideZ = half - bevelSize
  const backSideZ = -half + bevelSize
  const capProfile = bevel ? offsetProfile(profile, bevelSize) : profile

  if (cap) {
    appendCap(builder, capProfile, half, true, 'front', uvPolicy)
    appendCap(builder, capProfile, -half, false, 'back', uvPolicy)
  }

  appendSideContour(builder, profile.outer, backSideZ, frontSideZ, 'outerSide', uvPolicy)
  for (let index = 0; index < profile.holes.length; index += 1) {
    appendSideContour(builder, profile.holes[index]!, backSideZ, frontSideZ, `holeSide:${index}`, uvPolicy)
  }

  if (bevel) {
    const rings: NormalizedProfile[] = []
    for (let step = 0; step <= bevel.segments; step += 1) {
      const amount = bevel.size * (1 - step / bevel.segments)
      rings.push(amount <= PROFILE_EPSILON ? profile : offsetProfile(profile, amount))
    }
    appendBevel(builder, rings, half, half - bevel.size, true, 'frontBevel', uvPolicy)
    appendBevel(builder, rings, -half, -half + bevel.size, false, 'backBevel', uvPolicy)
  }

  return {
    positions: new Float32Array(builder.positions),
    indices: indexArray(builder.indices, builder.positions.length / 3),
    normals: new Float32Array(builder.normals),
    uvs: new Float32Array(builder.uvs),
    groups: Object.freeze(builder.groups.map(group => Object.freeze({ ...group }))),
  }
}

function appendCap(
  builder: MeshBuilder,
  profile: NormalizedProfile,
  z: number,
  front: boolean,
  name: string,
  uvPolicy: GeometryUvPolicy | undefined,
): void {
  const triangulated = triangulateProfile(profile)
  const start = builder.indices.length
  const vertexBase = builder.positions.length / 3
  const bounds = profileBounds(profile.outer)
  const metersPerTile = uvPolicy?.mode === 'generated' ? uvPolicy.metersPerTile : undefined
  for (const point of triangulated.points) {
    builder.positions.push(point[0], point[1], z)
    builder.normals.push(0, 0, front ? 1 : -1)
    const uv = capUv(point, bounds, metersPerTile)
    builder.uvs.push(uv[0], uv[1])
  }
  for (let offset = 0; offset < triangulated.indices.length; offset += 3) {
    const a = vertexBase + triangulated.indices[offset]!, b = vertexBase + triangulated.indices[offset + 1]!, c = vertexBase + triangulated.indices[offset + 2]!
    if (front) builder.indices.push(a, b, c)
    else builder.indices.push(a, c, b)
  }
  pushGroup(builder, start, name)
}

function appendSideContour(
  builder: MeshBuilder,
  contour: readonly ProfilePoint[],
  backZ: number,
  frontZ: number,
  name: string,
  uvPolicy: GeometryUvPolicy | undefined,
): void {
  const start = builder.indices.length
  const perimeter = Math.max(PROFILE_EPSILON, contourPerimeter(contour))
  const metersPerTile = uvPolicy?.mode === 'generated' ? uvPolicy.metersPerTile : undefined
  let travelled = 0
  for (let index = 0; index < contour.length; index += 1) {
    const a = contour[index]!, b = contour[(index + 1) % contour.length]!
    const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1])
    const normal = rightNormal(a, b)
    const base = builder.positions.length / 3
    const u0 = metersPerTile ? travelled / metersPerTile : travelled / perimeter
    const u1 = metersPerTile ? (travelled + edgeLength) / metersPerTile : (travelled + edgeLength) / perimeter
    const v0 = metersPerTile ? backZ / metersPerTile : 0
    const v1 = metersPerTile ? frontZ / metersPerTile : 1
    for (const [point, z, u, v] of [
      [a, backZ, u0, v0], [b, backZ, u1, v0], [b, frontZ, u1, v1], [a, frontZ, u0, v1],
    ] as const) {
      builder.positions.push(point[0], point[1], z)
      builder.normals.push(normal[0], normal[1], 0)
      builder.uvs.push(u, v)
    }
    builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    travelled += edgeLength
  }
  pushGroup(builder, start, name)
}

function appendBevel(
  builder: MeshBuilder,
  rings: readonly NormalizedProfile[],
  capZ: number,
  sideZ: number,
  front: boolean,
  name: string,
  uvPolicy: GeometryUvPolicy | undefined,
): void {
  const start = builder.indices.length
  const contourCount = 1 + rings[0]!.holes.length
  for (let contourIndex = 0; contourIndex < contourCount; contourIndex += 1) {
    const baseContour = contourAt(rings[rings.length - 1]!, contourIndex)
    const perimeter = Math.max(PROFILE_EPSILON, contourPerimeter(baseContour))
    const metersPerTile = uvPolicy?.mode === 'generated' ? uvPolicy.metersPerTile : undefined
    const cumulative = contourCumulative(baseContour)
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      const first = contourAt(rings[ring]!, contourIndex)
      const second = contourAt(rings[ring + 1]!, contourIndex)
      const t0 = ring / (rings.length - 1), t1 = (ring + 1) / (rings.length - 1)
      const z0 = capZ + (sideZ - capZ) * t0, z1 = capZ + (sideZ - capZ) * t1
      for (let edge = 0; edge < first.length; edge += 1) {
        const a0 = first[edge]!, b0 = first[(edge + 1) % first.length]!
        const a1 = second[edge]!, b1 = second[(edge + 1) % second.length]!
        const normal = quadNormal(a0, z0, b0, z0, b1, z1, front)
        const vertexBase = builder.positions.length / 3
        const u0 = metersPerTile ? cumulative[edge]! / metersPerTile : cumulative[edge]! / perimeter
        const u1Distance = edge + 1 === baseContour.length ? perimeter : cumulative[edge + 1]!
        const u1 = metersPerTile ? u1Distance / metersPerTile : u1Distance / perimeter
        const v0 = metersPerTile ? z0 / metersPerTile : t0
        const v1 = metersPerTile ? z1 / metersPerTile : t1
        for (const [point, z, u, v] of [
          [a0, z0, u0, v0], [b0, z0, u1, v0], [b1, z1, u1, v1], [a1, z1, u0, v1],
        ] as const) {
          builder.positions.push(point[0], point[1], z)
          builder.normals.push(normal[0], normal[1], normal[2])
          builder.uvs.push(u, v)
        }
        if (front) builder.indices.push(vertexBase, vertexBase + 2, vertexBase + 1, vertexBase, vertexBase + 3, vertexBase + 2)
        else builder.indices.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase, vertexBase + 2, vertexBase + 3)
      }
    }
  }
  pushGroup(builder, start, name)
}

function normalizeBevel(raw: unknown, depth: number, maximumSegments: number): ResolvedBevel | undefined {
  if (raw === undefined || raw === false) return undefined
  if (!isPlainRecord(raw)) parameterError('/bevel', 'bevel must be false or an object with size and optional segments.')
  const size = finitePositive(raw.size, '/bevel/size', 'bevel.size')
  const segments = raw.segments ?? 1
  if (typeof segments !== 'number' || !Number.isSafeInteger(segments) || segments < 1 || segments > maximumSegments) parameterError('/bevel/segments', `bevel.segments must be a safe integer from 1 to ${maximumSegments}.`)
  if (size * 2 >= depth - PROFILE_EPSILON) parameterError('/bevel/size', 'bevel.size must be less than half of extrusion depth.')
  return { size, segments }
}
function finitePositive(raw: unknown, path: string, label: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) parameterError(path, `${label} must be a finite number greater than zero.`)
  return raw
}
function profileToJson(profile: NormalizedProfile): GeometryJsonValue {
  return {
    points: profile.outer.map(point => [point[0], point[1]]),
    ...(profile.holes.length ? { holes: profile.holes.map(hole => hole.map(point => [point[0], point[1]])) } : {}),
  }
}
function profileBounds(points: readonly ProfilePoint[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]) }
  return [minX, minY, maxX, maxY]
}
function capUv(point: ProfilePoint, bounds: readonly [number, number, number, number], metersPerTile: number | undefined): [number, number] {
  if (metersPerTile) return [point[0] / metersPerTile, point[1] / metersPerTile]
  const width = Math.max(PROFILE_EPSILON, bounds[2] - bounds[0]), height = Math.max(PROFILE_EPSILON, bounds[3] - bounds[1])
  return [(point[0] - bounds[0]) / width, (point[1] - bounds[1]) / height]
}
function contourAt(profile: NormalizedProfile, index: number): readonly ProfilePoint[] { return index === 0 ? profile.outer : profile.holes[index - 1]! }
function contourCumulative(contour: readonly ProfilePoint[]): number[] {
  const output = [0]
  for (let index = 1; index < contour.length; index += 1) {
    const a = contour[index - 1]!, b = contour[index]!
    output.push(output[output.length - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  return output
}
function rightNormal(a: ProfilePoint, b: ProfilePoint): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1
  return [dy / length, -dx / length]
}
function quadNormal(a: ProfilePoint, az: number, b: ProfilePoint, bz: number, c: ProfilePoint, cz: number, front: boolean): [number, number, number] {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = bz - az
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = cz - az
  let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
  if (front) { nx = -nx; ny = -ny; nz = -nz }
  const length = Math.hypot(nx, ny, nz) || 1
  return [nx / length, ny / length, nz / length]
}
function pushGroup(builder: MeshBuilder, start: number, name: string): void {
  const count = builder.indices.length - start
  if (count > 0) builder.groups.push({ start, count, materialIndex: 0, name })
}
function isPlainRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
