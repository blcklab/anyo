import type {
  GeometryDefinition,
  GeometryGroup,
  GeometryIssue,
  GeometryJsonValue,
  GeometryMeshDraft,
  GeometryQualityPreset,
  GeometrySafetyLimits,
  GeometryUvPolicy,
} from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { normalizeProfile } from '../profiles/normalizeProfile.js'
import { contourPerimeter, PROFILE_EPSILON } from '../profiles/contourMath.js'
import type { NormalizedProfile, ProfilePoint } from '../profiles/types.js'
import { canonicalAngle, interpolateAngle, interpolateProfile, profileToJson, profilesHaveCompatibleTopology, transformProfile } from '../profiles/morphProfile.js'
import { triangulateProfile } from '../triangulation/triangulateProfile.js'
import { sampleCurve } from '../curves/sampleCurve.js'
import { computeCurveFrames } from '../curves/frames.js'
import type { CurveFrame, CurvePoint3 } from '../curves/types.js'
import { add3, normalize3, scale3 } from '../curves/vector.js'
import { GeometryValidationError } from '../validation/errors.js'
import { indexArray, withoutQuality } from '../primitives/common.js'

interface MeshBuilder { positions: number[]; indices: number[]; normals: number[]; uvs: number[]; groups: GeometryGroup[] }
interface SweepStation {
  at: number
  profile: NormalizedProfile
  scale: readonly [number, number]
  rotation: number
  offset: readonly [number, number]
}

export const sweepGeometryKind: GeometryKindCompiler = {
  kind: 'sweep',
  normalize(definition, context) {
    const profile = normalizeProfile(definition.profile, { limits: context.limits, path: '/profile' })
    const inheritedQuality = definition.quality as GeometryQualityPreset | undefined
    const pathInput = isRecord(definition.path) && definition.path.quality === undefined && inheritedQuality
      ? { ...definition.path, quality: inheritedQuality }
      : definition.path
    const path = context.resolveCurve(pathInput, '/path')
    let cap = definition.cap ?? !path.closed
    if (typeof cap !== 'boolean') parameterError('/cap', 'cap must be boolean.')
    if (path.closed && cap) parameterError('/cap', 'Closed sweep paths cannot be capped.', 'Set cap to false for closed paths.')
    if (path.closed) cap = false
    const up = definition.up === undefined ? undefined : normalizeUp(definition.up)
    const profileStations = normalizeProfileStations(definition.profileStations, profile, context.limits, !!path.closed)
    const base = withoutQuality(definition)
    delete base.profileStations
    return {
      ...base,
      kind: 'sweep',
      profile: profileToJson(profile),
      path: curveToJson(path),
      cap,
      ...(up ? { up } : {}),
      ...(profileStations ? { profileStations: profileStations.map(stationToJson) } : {}),
    } as unknown as GeometryDefinition
  },
  compile(definition, context) {
    const profile = normalizeProfile(definition.profile, { limits: context.limits, path: '/profile' })
    const path = context.resolveCurve(definition.path, '/path')
    const sampled = sampleCurve(path, { limits: context.limits, path: '/path' })
    const up = definition.up as unknown as readonly [number, number, number] | undefined
    const frames = computeCurveFrames(sampled, up)
    const cap = definition.cap as boolean
    const profileStations = normalizeProfileStations(definition.profileStations, profile, context.limits, sampled.closed)
    return profileStations
      ? buildVariableSweep(profileStations, frames, sampled.totalLength, sampled.closed, cap, definition.uv, context.limits.maxGeometryVertices)
      : buildSweep(profile, frames, sampled.totalLength, sampled.closed, cap, definition.uv, context.limits.maxGeometryVertices)
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
  assertSweepVertexBudget(profile, frames.length - 1, cap && !closed, maxVertices)
  const builder: MeshBuilder = { positions: [], indices: [], normals: [], uvs: [], groups: [] }
  if (cap && !closed) {
    appendCap(builder, profile, frames[0]!, false, 'startCap', uvPolicy)
    appendCap(builder, profile, frames[frames.length - 1]!, true, 'endCap', uvPolicy)
  }
  appendContourSweep(builder, profile.outer, frames, totalLength, 'outerSide', uvPolicy)
  for (let index = 0; index < profile.holes.length; index += 1) appendContourSweep(builder, profile.holes[index]!, frames, totalLength, `holeSide:${index}`, uvPolicy)
  return mesh(builder)
}

function buildVariableSweep(
  stations: readonly SweepStation[],
  frames: readonly CurveFrame[],
  totalLength: number,
  closed: boolean,
  cap: boolean,
  uvPolicy: GeometryUvPolicy | undefined,
  maxVertices: number,
): GeometryMeshDraft {
  const frameProfiles = frames.map(frame => sampleStationProfile(stations, totalLength <= PROFILE_EPSILON ? 0 : frame.distance / totalLength))
  assertSweepVertexBudget(frameProfiles[0]!, frames.length - 1, cap && !closed, maxVertices)
  const builder: MeshBuilder = { positions: [], indices: [], normals: [], uvs: [], groups: [] }
  if (cap && !closed) {
    appendCap(builder, frameProfiles[0]!, frames[0]!, false, 'startCap', uvPolicy)
    appendCap(builder, frameProfiles[frameProfiles.length - 1]!, frames[frames.length - 1]!, true, 'endCap', uvPolicy)
  }
  appendVariableContourSweep(builder, frameProfiles.map(profile => profile.outer), frames, totalLength, 'outerSide', uvPolicy)
  for (let holeIndex = 0; holeIndex < frameProfiles[0]!.holes.length; holeIndex += 1) {
    appendVariableContourSweep(builder, frameProfiles.map(profile => profile.holes[holeIndex]!), frames, totalLength, `holeSide:${holeIndex}`, uvPolicy)
  }
  return mesh(builder)
}

function assertSweepVertexBudget(profile: NormalizedProfile, pathSegments: number, caps: boolean, maxVertices: number): void {
  const contourEdges = profile.outer.length + profile.holes.reduce((sum, hole) => sum + hole.length, 0)
  const capVertices = caps ? contourEdges * 2 : 0
  const estimatedVertices = pathSegments * contourEdges * 4 + capVertices
  if (estimatedVertices > maxVertices) {
    throw new GeometryValidationError([{ code: 'GEOMETRY_MESH_LIMIT', path: '/path/segments', message: `Sweep would generate about ${estimatedVertices} vertices, above maxGeometryVertices ${maxVertices}.`, suggestion: 'Reduce path segments or profile point count.' }])
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

function appendVariableContourSweep(
  builder: MeshBuilder,
  contours: readonly (readonly ProfilePoint[])[],
  frames: readonly CurveFrame[],
  totalLength: number,
  name: string,
  uvPolicy: GeometryUvPolicy | undefined,
): void {
  const start = builder.indices.length
  const metersPerTile = uvPolicy?.mode === 'generated' ? uvPolicy.metersPerTile : undefined
  const metrics = contours.map(contour => ({ perimeter: Math.max(PROFILE_EPSILON, contourPerimeter(contour)), cumulative: contourCumulative(contour) }))
  for (let pathIndex = 0; pathIndex < frames.length - 1; pathIndex += 1) {
    const aFrame = frames[pathIndex]!, bFrame = frames[pathIndex + 1]!
    const aContour = contours[pathIndex]!, bContour = contours[pathIndex + 1]!
    const aMetrics = metrics[pathIndex]!, bMetrics = metrics[pathIndex + 1]!
    const v0 = metersPerTile ? aFrame.distance / metersPerTile : aFrame.distance / totalLength
    const v1 = metersPerTile ? bFrame.distance / metersPerTile : bFrame.distance / totalLength
    for (let edge = 0; edge < aContour.length; edge += 1) {
      const next = (edge + 1) % aContour.length
      const p00 = profilePointInFrame(aContour[edge]!, aFrame)
      const p10 = profilePointInFrame(aContour[next]!, aFrame)
      const p11 = profilePointInFrame(bContour[next]!, bFrame)
      const p01 = profilePointInFrame(bContour[edge]!, bFrame)
      const u00 = uvU(aMetrics, edge, aContour.length, metersPerTile)
      const u10 = uvU(aMetrics, edge + 1, aContour.length, metersPerTile)
      const u11 = uvU(bMetrics, edge + 1, bContour.length, metersPerTile)
      const u01 = uvU(bMetrics, edge, bContour.length, metersPerTile)
      pushQuad(builder, p00, p10, p11, p01, [u00, v0], [u10, v0], [u11, v1], [u01, v1])
    }
  }
  pushGroup(builder, start, name)
}

function normalizeProfileStations(raw: unknown, baseProfile: NormalizedProfile, limits: GeometrySafetyLimits, closed: boolean): SweepStation[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length < 2) parameterError('/profileStations', 'profileStations must contain at least two stations.')
  if (raw.length > limits.maxCurveSegments + 1) parameterError('/profileStations', `profileStations may contain at most ${limits.maxCurveSegments + 1} stations.`)
  const stations: SweepStation[] = raw.map((entry, index) => {
    if (!isRecord(entry)) parameterError(`/profileStations/${index}`, 'Sweep profile station must be a plain object.')
    const at = finiteNumber(entry.at, `/profileStations/${index}/at`)
    if (at < 0 || at > 1) parameterError(`/profileStations/${index}/at`, 'station at must be between 0 and 1.')
    const profile = entry.profile === undefined ? baseProfile : normalizeProfile(entry.profile, { limits, path: `/profileStations/${index}/profile` })
    if (!profilesHaveCompatibleTopology(baseProfile, profile)) parameterError(`/profileStations/${index}/profile`, 'Station profile topology must match the base profile point and hole counts.')
    return {
      at,
      profile,
      scale: positiveVec2(entry.scale ?? [1, 1], `/profileStations/${index}/scale`),
      rotation: canonicalAngle(finiteNumber(entry.rotation ?? 0, `/profileStations/${index}/rotation`)),
      offset: finiteVec2(entry.offset ?? [0, 0], `/profileStations/${index}/offset`),
    }
  })
  if (Math.abs(stations[0]!.at) > 1e-12 || Math.abs(stations[stations.length - 1]!.at - 1) > 1e-12) parameterError('/profileStations', 'profileStations must start at 0 and end at 1.')
  stations[0] = { ...stations[0]!, at: 0 }
  stations[stations.length - 1] = { ...stations[stations.length - 1]!, at: 1 }
  for (let index = 1; index < stations.length; index += 1) if (stations[index]!.at <= stations[index - 1]!.at) parameterError(`/profileStations/${index}/at`, 'profileStations at values must be strictly increasing.')
  if (closed && stationSignature(stations[0]!) !== stationSignature(stations[stations.length - 1]!)) {
    parameterError('/profileStations', 'Closed sweeps require matching first and last profile stations for a continuous seam.')
  }
  return stations
}

function sampleStationProfile(stations: readonly SweepStation[], at: number): NormalizedProfile {
  if (at <= 0) return transformedStationProfile(stations[0]!)
  if (at >= 1) return transformedStationProfile(stations[stations.length - 1]!)
  let upper = 1
  while (upper < stations.length && stations[upper]!.at < at) upper += 1
  const a = stations[upper - 1]!, b = stations[upper]!
  const alpha = (at - a.at) / Math.max(PROFILE_EPSILON, b.at - a.at)
  const profile = interpolateProfile(a.profile, b.profile, alpha)
  return transformProfile(profile, {
    scale: [lerp(a.scale[0], b.scale[0], alpha), lerp(a.scale[1], b.scale[1], alpha)],
    rotation: interpolateAngle(a.rotation, b.rotation, alpha),
    offset: [lerp(a.offset[0], b.offset[0], alpha), lerp(a.offset[1], b.offset[1], alpha)],
  })
}

function transformedStationProfile(station: SweepStation): NormalizedProfile {
  return transformProfile(station.profile, { scale: station.scale, rotation: station.rotation, offset: station.offset })
}

function stationToJson(station: SweepStation): GeometryJsonValue {
  return { at: station.at, profile: profileToJson(station.profile), scale: [station.scale[0], station.scale[1]], rotation: station.rotation, offset: [station.offset[0], station.offset[1]] }
}
function stationSignature(station: SweepStation): string {
  return JSON.stringify({ profile: profileToJson(station.profile), scale: station.scale, rotation: station.rotation, offset: station.offset })
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
function pushQuad(builder: MeshBuilder, a: CurvePoint3, b: CurvePoint3, c: CurvePoint3, d: CurvePoint3, uva: readonly [number, number], uvb: readonly [number, number], uvc: readonly [number, number], uvd: readonly [number, number]): void {
  const normal = quadNormal(a, b, c, d)
  const base = builder.positions.length / 3
  for (const [point, uv] of [[a, uva], [b, uvb], [c, uvc], [d, uvd]] as const) {
    builder.positions.push(point[0], point[1], point[2])
    builder.normals.push(normal[0], normal[1], normal[2])
    builder.uvs.push(uv[0], uv[1])
  }
  builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}
function quadNormal(a: CurvePoint3, b: CurvePoint3, c: CurvePoint3, d: CurvePoint3): CurvePoint3 {
  const n1 = cross(sub(b, a), sub(c, a)), n2 = cross(sub(c, a), sub(d, a))
  return normalize3(add3(n1, n2), normalize3(n1, [0, 1, 0]))
}
function sub(a: CurvePoint3, b: CurvePoint3): CurvePoint3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a: CurvePoint3, b: CurvePoint3): CurvePoint3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
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
function normalizeUp(raw: unknown): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some(value => typeof value !== 'number' || !Number.isFinite(value)) || Math.hypot(raw[0] as number, raw[1] as number, raw[2] as number) <= 1e-9) parameterError('/up', 'up must be a finite non-zero [x, y, z] vector.')
  const length = Math.hypot(raw[0] as number, raw[1] as number, raw[2] as number)
  return [(raw[0] as number) / length, (raw[1] as number) / length, (raw[2] as number) / length]
}
function curveToJson(curve: import('../curves/types.js').NormalizedCurveDefinition): GeometryJsonValue {
  return { kind: curve.kind, points: curve.points.map(point => [point[0], point[1], point[2]]), segments: curve.segments, ...(curve.closed ? { closed: true } : {}), ...(curve.tension === undefined ? {} : { tension: curve.tension }) }
}
function mesh(builder: MeshBuilder): GeometryMeshDraft {
  return { positions: new Float32Array(builder.positions), indices: indexArray(builder.indices, builder.positions.length / 3), normals: new Float32Array(builder.normals), uvs: new Float32Array(builder.uvs), groups: Object.freeze(builder.groups.map(group => Object.freeze({ ...group }))) }
}
function pushGroup(builder: MeshBuilder, start: number, name: string): void {
  const count = builder.indices.length - start
  if (count > 0) builder.groups.push({ start, count, materialIndex: 0, name })
}
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
function lerp(a: number, b: number, alpha: number): number { return a + (b - a) * alpha }
function parameterError(path: string, message: string, suggestion?: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message, ...(suggestion ? { suggestion } : {}) }
  throw new GeometryValidationError([issue])
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) }
