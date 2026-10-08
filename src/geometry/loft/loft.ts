import type {
  GeometryDefinition,
  GeometryGroup,
  GeometryIssue,
  GeometryJsonValue,
  GeometryMeshDraft,
  GeometrySafetyLimits,
  GeometryUvPolicy,
} from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { contourPerimeter, PROFILE_EPSILON } from '../profiles/contourMath.js'
import type { NormalizedProfile, ProfilePoint } from '../profiles/types.js'
import { canonicalAngle, profileToJson, profilesHaveCompatibleTopology, transformProfile } from '../profiles/morphProfile.js'
import { triangulateProfile } from '../triangulation/triangulateProfile.js'
import { GeometryValidationError } from '../validation/errors.js'
import { indexArray, withoutQuality } from '../primitives/common.js'

interface MeshBuilder { positions: number[]; indices: number[]; normals: number[]; uvs: number[]; groups: GeometryGroup[] }
interface LoftSection {
  z: number
  profile: NormalizedProfile
  scale: readonly [number, number]
  rotation: number
  offset: readonly [number, number]
}
type Vec3 = readonly [number, number, number]

export const loftGeometryKind: GeometryKindCompiler = {
  kind: 'loft',
  normalize(definition, context) {
    const sections = normalizeSections(definition.sections, context.limits, context.resolveProfile)
    const cap = definition.cap ?? true
    if (typeof cap !== 'boolean') parameterError('/cap', 'cap must be boolean.')
    const base = withoutQuality(definition)
    delete base.sections
    return {
      ...base,
      kind: 'loft',
      sections: sections.map(sectionToJson),
      cap,
    } as unknown as GeometryDefinition
  },
  compile(definition, context) {
    const sections = normalizeSections(definition.sections, context.limits, context.resolveProfile)
    return buildLoft(sections, definition.cap as boolean, definition.uv, context.limits.maxGeometryVertices)
  },
}

function normalizeSections(
  raw: unknown,
  limits: GeometrySafetyLimits,
  resolveProfile: (input: unknown, path?: string) => NormalizedProfile,
): LoftSection[] {
  if (!Array.isArray(raw) || raw.length < 2) parameterError('/sections', 'loft sections must contain at least two sections.')
  if (raw.length > limits.maxCurveSegments + 1) parameterError('/sections', `loft sections may contain at most ${limits.maxCurveSegments + 1} sections.`)
  let reference: NormalizedProfile | undefined
  const sections = raw.map((entry, index) => {
    if (!isRecord(entry)) parameterError(`/sections/${index}`, 'Loft section must be a plain object.')
    const z = finiteNumber(entry.z, `/sections/${index}/z`)
    const profile = resolveProfile(entry.profile, `/sections/${index}/profile`)
    if (!reference) reference = profile
    else if (!profilesHaveCompatibleTopology(reference, profile)) parameterError(`/sections/${index}/profile`, 'All loft section profiles must have matching outer and hole point counts.')
    return {
      z,
      profile,
      scale: positiveVec2(entry.scale ?? [1, 1], `/sections/${index}/scale`),
      rotation: canonicalAngle(finiteNumber(entry.rotation ?? 0, `/sections/${index}/rotation`)),
      offset: finiteVec2(entry.offset ?? [0, 0], `/sections/${index}/offset`),
    }
  })
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index]!.z <= sections[index - 1]!.z) parameterError(`/sections/${index}/z`, 'Loft section z values must be strictly increasing.')
  }
  return sections
}

function buildLoft(sections: readonly LoftSection[], cap: boolean, uvPolicy: GeometryUvPolicy | undefined, maxVertices: number): GeometryMeshDraft {
  const profiles = sections.map(section => transformProfile(section.profile, { scale: section.scale, rotation: section.rotation, offset: section.offset }))
  const reference = profiles[0]!
  const contourEdges = reference.outer.length + reference.holes.reduce((sum, hole) => sum + hole.length, 0)
  const capVertices = cap ? contourEdges * 2 : 0
  const estimatedVertices = (sections.length - 1) * contourEdges * 4 + capVertices
  if (estimatedVertices > maxVertices) {
    throw new GeometryValidationError([{ code: 'GEOMETRY_MESH_LIMIT', path: '/sections', message: `Loft would generate about ${estimatedVertices} vertices, above maxGeometryVertices ${maxVertices}.`, suggestion: 'Reduce section count or profile point count.' }])
  }

  const builder: MeshBuilder = { positions: [], indices: [], normals: [], uvs: [], groups: [] }
  if (cap) {
    appendCap(builder, profiles[0]!, sections[0]!.z, false, 'startCap', uvPolicy)
    appendCap(builder, profiles[profiles.length - 1]!, sections[sections.length - 1]!.z, true, 'endCap', uvPolicy)
  }

  const distances = centerlineDistances(sections)
  appendContourLoft(builder, profiles.map(profile => profile.outer), sections, distances, 'outerSide', uvPolicy)
  for (let holeIndex = 0; holeIndex < reference.holes.length; holeIndex += 1) {
    appendContourLoft(builder, profiles.map(profile => profile.holes[holeIndex]!), sections, distances, `holeSide:${holeIndex}`, uvPolicy)
  }
  return {
    positions: new Float32Array(builder.positions),
    indices: indexArray(builder.indices, builder.positions.length / 3),
    normals: new Float32Array(builder.normals),
    uvs: new Float32Array(builder.uvs),
    groups: Object.freeze(builder.groups.map(group => Object.freeze({ ...group }))),
  }
}

function appendCap(builder: MeshBuilder, profile: NormalizedProfile, z: number, forward: boolean, name: string, uvPolicy: GeometryUvPolicy | undefined): void {
  const triangulated = triangulateProfile(profile)
  const start = builder.indices.length
  const base = builder.positions.length / 3
  const bounds = profileBounds(profile.outer)
  const metersPerTile = uvPolicy?.mode === 'generated' ? uvPolicy.metersPerTile : undefined
  const normal: Vec3 = forward ? [0, 0, 1] : [0, 0, -1]
  for (const point of triangulated.points) {
    builder.positions.push(point[0], point[1], z)
    builder.normals.push(normal[0], normal[1], normal[2])
    const uv = capUv(point, bounds, metersPerTile)
    builder.uvs.push(uv[0], uv[1])
  }
  for (let offset = 0; offset < triangulated.indices.length; offset += 3) {
    const a = base + triangulated.indices[offset]!, b = base + triangulated.indices[offset + 1]!, c = base + triangulated.indices[offset + 2]!
    if (forward) builder.indices.push(a, b, c)
    else builder.indices.push(a, c, b)
  }
  pushGroup(builder, start, name)
}

function appendContourLoft(
  builder: MeshBuilder,
  contours: readonly (readonly ProfilePoint[])[],
  sections: readonly LoftSection[],
  distances: readonly number[],
  name: string,
  uvPolicy: GeometryUvPolicy | undefined,
): void {
  const start = builder.indices.length
  const totalLength = Math.max(PROFILE_EPSILON, distances[distances.length - 1]!)
  const metersPerTile = uvPolicy?.mode === 'generated' ? uvPolicy.metersPerTile : undefined
  const metrics = contours.map(contour => ({ perimeter: Math.max(PROFILE_EPSILON, contourPerimeter(contour)), cumulative: contourCumulative(contour) }))
  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    const aContour = contours[sectionIndex]!, bContour = contours[sectionIndex + 1]!
    const aMetrics = metrics[sectionIndex]!, bMetrics = metrics[sectionIndex + 1]!
    const z0 = sections[sectionIndex]!.z, z1 = sections[sectionIndex + 1]!.z
    const v0 = metersPerTile ? distances[sectionIndex]! / metersPerTile : distances[sectionIndex]! / totalLength
    const v1 = metersPerTile ? distances[sectionIndex + 1]! / metersPerTile : distances[sectionIndex + 1]! / totalLength
    for (let edge = 0; edge < aContour.length; edge += 1) {
      const next = (edge + 1) % aContour.length
      const p00: Vec3 = [aContour[edge]![0], aContour[edge]![1], z0]
      const p10: Vec3 = [aContour[next]![0], aContour[next]![1], z0]
      const p11: Vec3 = [bContour[next]![0], bContour[next]![1], z1]
      const p01: Vec3 = [bContour[edge]![0], bContour[edge]![1], z1]
      const u00 = uvU(aMetrics, edge, aContour.length, metersPerTile)
      const u10 = uvU(aMetrics, edge + 1, aContour.length, metersPerTile)
      const u11 = uvU(bMetrics, edge + 1, bContour.length, metersPerTile)
      const u01 = uvU(bMetrics, edge, bContour.length, metersPerTile)
      pushQuad(builder, p00, p10, p11, p01, [u00, v0], [u10, v0], [u11, v1], [u01, v1])
    }
  }
  pushGroup(builder, start, name)
}

function centerlineDistances(sections: readonly LoftSection[]): number[] {
  const distances = [0]
  for (let index = 1; index < sections.length; index += 1) {
    const a = sections[index - 1]!, b = sections[index]!
    const dx = b.offset[0] - a.offset[0], dy = b.offset[1] - a.offset[1], dz = b.z - a.z
    distances.push(distances[distances.length - 1]! + Math.hypot(dx, dy, dz))
  }
  return distances
}

function sectionToJson(section: LoftSection): GeometryJsonValue {
  return { z: section.z, profile: profileToJson(section.profile), scale: [section.scale[0], section.scale[1]], rotation: section.rotation, offset: [section.offset[0], section.offset[1]] }
}
function pushQuad(builder: MeshBuilder, a: Vec3, b: Vec3, c: Vec3, d: Vec3, uva: readonly [number, number], uvb: readonly [number, number], uvc: readonly [number, number], uvd: readonly [number, number]): void {
  const normal = normalize(add(cross(sub(b, a), sub(c, a)), cross(sub(c, a), sub(d, a))))
  const base = builder.positions.length / 3
  for (const [point, uv] of [[a, uva], [b, uvb], [c, uvc], [d, uvd]] as const) {
    builder.positions.push(point[0], point[1], point[2])
    builder.normals.push(normal[0], normal[1], normal[2])
    builder.uvs.push(uv[0], uv[1])
  }
  builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}
function contourCumulative(contour: readonly ProfilePoint[]): number[] {
  const output = [0]
  for (let index = 1; index < contour.length; index += 1) {
    const a = contour[index - 1]!, b = contour[index]!
    output.push(output[output.length - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  return output
}
function uvU(metrics: { perimeter: number; cumulative: number[] }, edge: number, count: number, metersPerTile: number | undefined): number {
  const distance = edge === count ? metrics.perimeter : metrics.cumulative[edge]!
  return metersPerTile ? distance / metersPerTile : distance / metrics.perimeter
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
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function normalize(v: Vec3): Vec3 { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-15 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0] }
function finiteNumber(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) parameterError(path, `${path.split('/').at(-1)} must be a finite number.`)
  return raw
}
function finiteVec2(raw: unknown, path: string): [number, number] {
  if (!Array.isArray(raw) || raw.length !== 2 || raw.some(value => typeof value !== 'number' || !Number.isFinite(value))) parameterError(path, `${path.split('/').at(-1)} must be two finite numbers.`)
  return [raw[0] as number, raw[1] as number]
}
function positiveVec2(raw: unknown, path: string): [number, number] {
  const value = finiteVec2(raw, path)
  if (value[0] <= 0 || value[1] <= 0) parameterError(path, `${path.split('/').at(-1)} components must be greater than zero.`)
  return value
}
function pushGroup(builder: MeshBuilder, start: number, name: string): void {
  const count = builder.indices.length - start
  if (count > 0) builder.groups.push({ start, count, materialIndex: 0, name })
}
function parameterError(path: string, message: string, suggestion?: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message, ...(suggestion ? { suggestion } : {}) }
  throw new GeometryValidationError([issue])
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) }
