import type {
  GeometryDefinition,
  GeometryGroup,
  GeometryIssue,
  GeometryJsonValue,
  GeometryMeshDraft,
  GeometryQualityPreset,
  GeometryUvPolicy,
} from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { normalizeProfile } from '../profiles/normalizeProfile.js'
import { contourPerimeter, PROFILE_EPSILON } from '../profiles/contourMath.js'
import type { NormalizedProfile, ProfilePoint } from '../profiles/types.js'
import { triangulateProfile } from '../triangulation/triangulateProfile.js'
import { normalizeCurve } from '../curves/normalizeCurve.js'
import { sampleCurve } from '../curves/sampleCurve.js'
import { computeCurveFrames } from '../curves/frames.js'
import type { CurveFrame, CurvePoint3 } from '../curves/types.js'
import { add3, normalize3, scale3 } from '../curves/vector.js'
import { GeometryValidationError } from '../validation/errors.js'
import { indexArray, withoutQuality } from '../primitives/common.js'

interface MeshBuilder { positions: number[]; indices: number[]; normals: number[]; uvs: number[]; groups: GeometryGroup[] }

export const sweepGeometryKind: GeometryKindCompiler = {
  kind: 'sweep',
  normalize(definition, context) {
    const profile = normalizeProfile(definition.profile, { limits: context.limits, path: '/profile' })
    const inheritedQuality = definition.quality as GeometryQualityPreset | undefined
    const pathInput = isRecord(definition.path) && definition.path.quality === undefined && inheritedQuality
      ? { ...definition.path, quality: inheritedQuality }
      : definition.path
    const path = normalizeCurve(pathInput, { limits: context.limits, path: '/path', quality: inheritedQuality })
    let cap = definition.cap ?? !path.closed
    if (typeof cap !== 'boolean') parameterError('/cap', 'cap must be boolean.')
    if (path.closed && cap) parameterError('/cap', 'Closed sweep paths cannot be capped.', 'Set cap to false for closed paths.')
    if (path.closed) cap = false
    const up = definition.up === undefined ? undefined : normalizeUp(definition.up)
    const base = withoutQuality(definition)
    return {
      ...base,
      kind: 'sweep',
      profile: profileToJson(profile),
      path: curveToJson(path),
      cap,
      ...(up ? { up } : {}),
    } as unknown as GeometryDefinition
  },
  compile(definition, context) {
    const profile = normalizeProfile(definition.profile, { limits: context.limits, path: '/profile' })
    const path = normalizeCurve(definition.path, { limits: context.limits, path: '/path' })
    const sampled = sampleCurve(path, { limits: context.limits, path: '/path' })
    const up = definition.up as unknown as readonly [number, number, number] | undefined
    const frames = computeCurveFrames(sampled, up)
    const cap = definition.cap as boolean
    return buildSweep(profile, frames, sampled.totalLength, sampled.closed, cap, definition.uv, context.limits.maxGeometryVertices)
  },
}

function buildSweep(
  profile: NormalizedProfile,
  frames: readonly CurveFrame[],
  totalLength: number,
  closed: boolean,
  cap: boolean,
  uvPolicy: GeometryUvPolicy | undefined,
  maxVertices: number,
): GeometryMeshDraft {
  const contourEdges = profile.outer.length + profile.holes.reduce((sum, hole) => sum + hole.length, 0)
  const pathSegments = frames.length - 1
  const capVertices = cap && !closed ? (profile.outer.length + profile.holes.reduce((sum, hole) => sum + hole.length, 0)) * 2 : 0
  const estimatedVertices = pathSegments * contourEdges * 4 + capVertices
  if (estimatedVertices > maxVertices) {
    throw new GeometryValidationError([{ code: 'GEOMETRY_MESH_LIMIT', path: '/path/segments', message: `Sweep would generate about ${estimatedVertices} vertices, above maxGeometryVertices ${maxVertices}.`, suggestion: 'Reduce path segments or profile point count.' }])
  }

  const builder: MeshBuilder = { positions: [], indices: [], normals: [], uvs: [], groups: [] }
  if (cap && !closed) {
    appendCap(builder, profile, frames[0]!, false, 'startCap', uvPolicy)
    appendCap(builder, profile, frames[frames.length - 1]!, true, 'endCap', uvPolicy)
  }
  appendContourSweep(builder, profile.outer, frames, totalLength, 'outerSide', uvPolicy)
  for (let index = 0; index < profile.holes.length; index += 1) appendContourSweep(builder, profile.holes[index]!, frames, totalLength, `holeSide:${index}`, uvPolicy)

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
  frame: CurveFrame,
  forward: boolean,
  name: string,
  uvPolicy: GeometryUvPolicy | undefined,
): void {
  const triangulated = triangulateProfile(profile)
  const start = builder.indices.length
  const base = builder.positions.length / 3
  const bounds = profileBounds(profile.outer)
  const metersPerTile = uvPolicy?.mode === 'generated' ? uvPolicy.metersPerTile : undefined
  const outward = forward ? frame.tangent : scale3(frame.tangent, -1)
  for (const point of triangulated.points) {
    const position = profilePointInFrame(point, frame)
    builder.positions.push(position[0], position[1], position[2])
    builder.normals.push(outward[0], outward[1], outward[2])
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

function appendContourSweep(
  builder: MeshBuilder,
  contour: readonly ProfilePoint[],
  frames: readonly CurveFrame[],
  totalLength: number,
  name: string,
  uvPolicy: GeometryUvPolicy | undefined,
): void {
  const start = builder.indices.length
  const perimeter = Math.max(PROFILE_EPSILON, contourPerimeter(contour))
  const cumulative = contourCumulative(contour)
  const metersPerTile = uvPolicy?.mode === 'generated' ? uvPolicy.metersPerTile : undefined
  for (let pathIndex = 0; pathIndex < frames.length - 1; pathIndex += 1) {
    const aFrame = frames[pathIndex]!, bFrame = frames[pathIndex + 1]!
    const v0 = metersPerTile ? aFrame.distance / metersPerTile : aFrame.distance / totalLength
    const v1 = metersPerTile ? bFrame.distance / metersPerTile : bFrame.distance / totalLength
    for (let edge = 0; edge < contour.length; edge += 1) {
      const a = contour[edge]!, b = contour[(edge + 1) % contour.length]!
      const localNormal = rightNormal(a, b)
      const u0Distance = cumulative[edge]!
      const u1Distance = edge + 1 === contour.length ? perimeter : cumulative[edge + 1]!
      const u0 = metersPerTile ? u0Distance / metersPerTile : u0Distance / perimeter
      const u1 = metersPerTile ? u1Distance / metersPerTile : u1Distance / perimeter
      const base = builder.positions.length / 3
      pushSweepVertex(builder, a, aFrame, localNormal, u0, v0)
      pushSweepVertex(builder, b, aFrame, localNormal, u1, v0)
      pushSweepVertex(builder, b, bFrame, localNormal, u1, v1)
      pushSweepVertex(builder, a, bFrame, localNormal, u0, v1)
      builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  pushGroup(builder, start, name)
}

function pushSweepVertex(builder: MeshBuilder, point: ProfilePoint, frame: CurveFrame, localNormal: readonly [number, number], u: number, v: number): void {
  const position = profilePointInFrame(point, frame)
  const normal = normalize3(add3(scale3(frame.normal, localNormal[0]), scale3(frame.binormal, localNormal[1])), frame.normal)
  builder.positions.push(position[0], position[1], position[2])
  builder.normals.push(normal[0], normal[1], normal[2])
  builder.uvs.push(u, v)
}
function profilePointInFrame(point: ProfilePoint, frame: CurveFrame): CurvePoint3 {
  return add3(frame.position, add3(scale3(frame.normal, point[0]), scale3(frame.binormal, point[1])))
}
function rightNormal(a: ProfilePoint, b: ProfilePoint): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1
  return [dy / length, -dx / length]
}
function contourCumulative(contour: readonly ProfilePoint[]): number[] {
  const output = [0]
  for (let index = 1; index < contour.length; index += 1) {
    const a = contour[index - 1]!, b = contour[index]!
    output.push(output[output.length - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  return output
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
function normalizeUp(raw: unknown): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some(value => typeof value !== 'number' || !Number.isFinite(value)) || Math.hypot(raw[0] as number, raw[1] as number, raw[2] as number) <= 1e-9) parameterError('/up', 'up must be a finite non-zero [x, y, z] vector.')
  const length = Math.hypot(raw[0] as number, raw[1] as number, raw[2] as number)
  return [(raw[0] as number) / length, (raw[1] as number) / length, (raw[2] as number) / length]
}
function profileToJson(profile: NormalizedProfile): GeometryJsonValue {
  return { points: profile.outer.map(point => [point[0], point[1]]), ...(profile.holes.length ? { holes: profile.holes.map(hole => hole.map(point => [point[0], point[1]])) } : {}) }
}
function curveToJson(curve: ReturnType<typeof normalizeCurve>): GeometryJsonValue {
  return { kind: curve.kind, points: curve.points.map(point => [point[0], point[1], point[2]]), segments: curve.segments, ...(curve.closed ? { closed: true } : {}), ...(curve.tension === undefined ? {} : { tension: curve.tension }) }
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
