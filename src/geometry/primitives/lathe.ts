import type { GeometryDefinition, GeometryGroup, GeometryJsonValue, GeometryMeshDraft } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { indexArray, parameterError, positiveInteger, withoutQuality } from './common.js'
import { qualityDefaults } from './quality.js'

const EPSILON = 1e-9

type LathePoint = readonly [number, number]

export const latheGeometryKind: GeometryKindCompiler = {
  kind: 'lathe',
  normalize(definition, context) {
    const defaults = qualityDefaults(definition)
    const profile = normalizeLatheProfile(definition.profile, context.limits.maxProfilePoints)
    const segments = positiveInteger(definition, 'segments', defaults.radialSegments, context.limits, 3)
    const cap = definition.cap ?? true
    if (typeof cap !== 'boolean') parameterError('/cap', 'cap must be boolean.')
    return {
      ...withoutQuality(definition),
      kind: 'lathe',
      profile: profile.map(point => [point[0], point[1]]) as unknown as GeometryJsonValue,
      segments,
      cap,
    } as GeometryDefinition
  },
  compile(definition) {
    const profile = definition.profile as unknown as LathePoint[]
    const segments = Number(definition.segments)
    const cap = Boolean(definition.cap)
    return buildLathe(profile, segments, cap)
  },
}

function buildLathe(profile: readonly LathePoint[], segments: number, cap: boolean): GeometryMeshDraft {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const groups: GeometryGroup[] = []
  const columns = segments + 1
  const distances = profileDistances(profile)
  const totalDistance = Math.max(EPSILON, distances[distances.length - 1]!)

  for (let row = 0; row < profile.length; row += 1) {
    const [radius, height] = profile[row]!
    const [nr, ny] = profileNormal(profile, row)
    const v = distances[row]! / totalDistance
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments
      const theta = u * Math.PI * 2
      const cosine = Math.cos(theta)
      const sine = Math.sin(theta)
      positions.push(radius * cosine, height, radius * sine)
      normals.push(nr * cosine, ny, nr * sine)
      uvs.push(u, v)
    }
  }

  const sideStart = indices.length
  for (let row = 0; row < profile.length - 1; row += 1) {
    const radius0 = profile[row]![0]
    const radius1 = profile[row + 1]![0]
    for (let segment = 0; segment < segments; segment += 1) {
      const a = row * columns + segment
      const b = (row + 1) * columns + segment
      const c = b + 1
      const d = a + 1
      if (radius0 > EPSILON && radius1 > EPSILON) indices.push(a, b, d, d, b, c)
      else if (radius0 <= EPSILON && radius1 > EPSILON) indices.push(d, b, c)
      else if (radius0 > EPSILON && radius1 <= EPSILON) indices.push(a, b, d)
    }
  }
  pushGroup(groups, sideStart, indices.length, 'surface')

  if (cap) {
    const start = profile[0]!
    const end = profile[profile.length - 1]!
    if (start[0] > EPSILON) appendCap(positions, normals, uvs, indices, groups, start[0], start[1], segments, false, 'startCap')
    if (end[0] > EPSILON) appendCap(positions, normals, uvs, indices, groups, end[0], end[1], segments, true, 'endCap')
  }

  return {
    positions: new Float32Array(positions),
    indices: indexArray(indices, positions.length / 3),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    groups: Object.freeze(groups.map(group => Object.freeze({ ...group }))),
  }
}

function appendCap(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  groups: GeometryGroup[],
  radius: number,
  height: number,
  segments: number,
  positiveY: boolean,
  name: string,
): void {
  const start = indices.length
  const center = positions.length / 3
  positions.push(0, height, 0)
  normals.push(0, positiveY ? 1 : -1, 0)
  uvs.push(0.5, 0.5)
  const ring = positions.length / 3
  for (let segment = 0; segment <= segments; segment += 1) {
    const u = segment / segments
    const theta = u * Math.PI * 2
    const cosine = Math.cos(theta)
    const sine = Math.sin(theta)
    positions.push(radius * cosine, height, radius * sine)
    normals.push(0, positiveY ? 1 : -1, 0)
    uvs.push(0.5 + cosine * 0.5, 0.5 + sine * 0.5)
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const current = ring + segment
    const next = current + 1
    if (positiveY) indices.push(center, next, current)
    else indices.push(center, current, next)
  }
  pushGroup(groups, start, indices.length, name)
}

function normalizeLatheProfile(input: unknown, maxPoints: number): readonly LathePoint[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > maxPoints) {
    parameterError('/profile', `profile must contain from 2 to ${maxPoints} [radius, height] points.`)
  }
  const output: LathePoint[] = []
  let previousHeight = -Infinity
  for (let index = 0; index < input.length; index += 1) {
    const point = input[index]
    if (!Array.isArray(point) || point.length !== 2 || point.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      parameterError(`/profile/${index}`, 'lathe profile points must be [radius, height] finite numbers.')
    }
    const radius = point[0] as number
    const height = point[1] as number
    if (radius < 0) parameterError(`/profile/${index}/0`, 'lathe profile radius must be greater than or equal to zero.')
    if (!(height > previousHeight)) parameterError(`/profile/${index}/1`, 'lathe profile heights must be strictly increasing.')
    previousHeight = height
    output.push([radius, height])
  }
  if (output.every(point => point[0] <= EPSILON)) parameterError('/profile', 'lathe profile must contain at least one positive radius.')
  return Object.freeze(output.map(point => Object.freeze([point[0], point[1]]) as LathePoint))
}

function profileDistances(profile: readonly LathePoint[]): number[] {
  const output = [0]
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1]!
    const current = profile[index]!
    output.push(output[index - 1]! + Math.hypot(current[0] - previous[0], current[1] - previous[1]))
  }
  return output
}

function profileNormal(profile: readonly LathePoint[], index: number): readonly [number, number] {
  const previous = profile[Math.max(0, index - 1)]!
  const next = profile[Math.min(profile.length - 1, index + 1)]!
  const dr = next[0] - previous[0]
  const dy = next[1] - previous[1]
  const length = Math.hypot(dy, dr)
  if (length <= EPSILON) return [1, 0]
  return [dy / length, -dr / length]
}

function pushGroup(groups: GeometryGroup[], start: number, end: number, name: string): void {
  const count = end - start
  if (count > 0) groups.push({ start, count, materialIndex: 0, name })
}
