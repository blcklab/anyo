import type { GeometryMeshDraft, GeometryUvAxis, GeometryUvMode, GeometryUvPolicy } from '../types/index.js'
import { indexArray } from '../primitives/common.js'
import { GeometryValidationError } from '../validation/errors.js'

interface ResolvedUvPolicy extends GeometryUvPolicy {
  mode: GeometryUvMode
  axis: GeometryUvAxis
  scale: [number, number]
  rotation: number
  offset: [number, number]
}

interface BoundsInfo {
  min: [number, number, number]
  max: [number, number, number]
  extent: [number, number, number]
  radius: number
}

export function generateUvs(mesh: GeometryMeshDraft, policy: ResolvedUvPolicy): GeometryMeshDraft {
  if (policy.mode === 'generated') {
    if (!mesh.uvs) throw surfaceError('/uv', 'Generated UV mode requires the geometry generator to provide UVs.')
    const transformed = new Float32Array(mesh.uvs.length)
    for (let index = 0; index < mesh.uvs.length; index += 2) {
      const [u, v] = transformUv(mesh.uvs[index]!, mesh.uvs[index + 1]!, policy)
      transformed[index] = u; transformed[index + 1] = v
    }
    return { ...mesh, uvs: transformed, tangents: undefined }
  }

  const bounds = measureBounds(mesh.positions)
  const perCorner: Array<[number, number]> = new Array(mesh.indices.length)
  const periods: number[] = new Array(mesh.indices.length).fill(0)

  for (let corner = 0; corner < mesh.indices.length; corner += 1) {
    const vertex = mesh.indices[corner]!
    const x = mesh.positions[vertex * 3]!, y = mesh.positions[vertex * 3 + 1]!, z = mesh.positions[vertex * 3 + 2]!
    let u = 0, v = 0, period = 0
    if (policy.mode === 'planar') {
      const axis = policy.axis === 'auto' ? autoPlanarAxis(bounds.extent) : policy.axis
      ;[u, v] = planarUv(x, y, z, axis, policy.metersPerTile, bounds)
    } else if (policy.mode === 'box') {
      const face = Math.floor(corner / 3)
      const normal = faceNormal(mesh, face)
      const axis = dominantAxis(normal)
      ;[u, v] = boxUv(x, y, z, axis, normal[axis], policy.metersPerTile, bounds)
    } else if (policy.mode === 'cylindrical') {
      const theta = positiveAngle(Math.atan2(z, x))
      const radial = Math.max(1e-12, bounds.radius)
      if (policy.metersPerTile) {
        period = Math.PI * 2 * radial / policy.metersPerTile
        u = theta * radial / policy.metersPerTile
        v = y / policy.metersPerTile
      } else {
        period = 1
        u = theta / (Math.PI * 2)
        v = normalizeAxis(y, bounds.min[1], bounds.max[1])
      }
    } else {
      const radius = Math.max(1e-12, Math.hypot(x, y, z))
      const representativeRadius = Math.max(1e-12, bounds.radius)
      const theta = positiveAngle(Math.atan2(z, x))
      const phi = Math.acos(Math.max(-1, Math.min(1, y / radius)))
      if (policy.metersPerTile) {
        period = Math.PI * 2 * representativeRadius / policy.metersPerTile
        u = theta * representativeRadius / policy.metersPerTile
        v = phi * representativeRadius / policy.metersPerTile
      } else {
        period = 1
        u = theta / (Math.PI * 2)
        v = 1 - phi / Math.PI
      }
    }
    perCorner[corner] = [u, v]
    periods[corner] = period
  }

  if (policy.mode === 'cylindrical' || policy.mode === 'spherical') {
    for (let offset = 0; offset < perCorner.length; offset += 3) {
      const period = periods[offset]!
      if (period <= 0) continue
      const values = [perCorner[offset]![0], perCorner[offset + 1]![0], perCorner[offset + 2]![0]]
      const min = Math.min(...values), max = Math.max(...values)
      if (max - min > period * 0.5) {
        for (let local = 0; local < 3; local += 1) if (perCorner[offset + local]![0] < period * 0.5) perCorner[offset + local]![0] += period
      }
    }
  }

  const positions: number[] = [], normals: number[] | undefined = mesh.normals ? [] : undefined, colors: number[] | undefined = mesh.colors ? [] : undefined
  const uvs: number[] = [], indices: number[] = []
  const remap = new Map<string, number>()
  for (let corner = 0; corner < mesh.indices.length; corner += 1) {
    const original = mesh.indices[corner]!
    const [rawU, rawV] = perCorner[corner]!
    const [u, v] = transformUv(rawU, rawV, policy)
    const key = `${original}|${quantize(u)},${quantize(v)}`
    let next = remap.get(key)
    if (next === undefined) {
      next = positions.length / 3
      remap.set(key, next)
      positions.push(mesh.positions[original * 3]!, mesh.positions[original * 3 + 1]!, mesh.positions[original * 3 + 2]!)
      if (normals && mesh.normals) normals.push(mesh.normals[original * 3]!, mesh.normals[original * 3 + 1]!, mesh.normals[original * 3 + 2]!)
      if (colors && mesh.colors) colors.push(mesh.colors[original * 4]!, mesh.colors[original * 4 + 1]!, mesh.colors[original * 4 + 2]!, mesh.colors[original * 4 + 3]!)
      uvs.push(u, v)
    }
    indices.push(next)
  }

  return {
    positions: new Float32Array(positions),
    indices: indexArray(indices, positions.length / 3),
    ...(normals ? { normals: new Float32Array(normals) } : {}),
    uvs: new Float32Array(uvs),
    ...(colors ? { colors: new Float32Array(colors) } : {}),
    ...(mesh.groups ? { groups: mesh.groups } : {}),
    ...(mesh.bounds ? { bounds: mesh.bounds } : {}),
  }
}

function planarUv(x: number, y: number, z: number, axis: Exclude<GeometryUvAxis, 'auto'>, metersPerTile: number | undefined, bounds: BoundsInfo): [number, number] {
  if (axis === 'xy') return scaleOrNormalize(x, y, 0, 1, metersPerTile, bounds)
  if (axis === 'xz') return scaleOrNormalize(x, z, 0, 2, metersPerTile, bounds)
  return scaleOrNormalize(y, z, 1, 2, metersPerTile, bounds)
}

function boxUv(x: number, y: number, z: number, axis: 0 | 1 | 2, sign: number, metersPerTile: number | undefined, bounds: BoundsInfo): [number, number] {
  let result: [number, number]
  if (axis === 0) result = scaleOrNormalize(sign >= 0 ? -z : z, y, 2, 1, metersPerTile, bounds, sign >= 0)
  else if (axis === 1) result = scaleOrNormalize(x, sign >= 0 ? -z : z, 0, 2, metersPerTile, bounds, sign < 0)
  else result = scaleOrNormalize(sign >= 0 ? x : -x, y, 0, 1, metersPerTile, bounds, sign < 0)
  return result
}

function scaleOrNormalize(a: number, b: number, axisA: number, axisB: number, metersPerTile: number | undefined, bounds: BoundsInfo, mirrored = false): [number, number] {
  if (metersPerTile) return [a / metersPerTile, b / metersPerTile]
  const minA = bounds.min[axisA]!, maxA = bounds.max[axisA]!, minB = bounds.min[axisB]!, maxB = bounds.max[axisB]!
  const u = normalizeAxis(mirrored ? -a : a, mirrored ? -maxA : minA, mirrored ? -minA : maxA)
  return [u, normalizeAxis(b, minB, maxB)]
}

function transformUv(u: number, v: number, policy: ResolvedUvPolicy): [number, number] {
  let x = u * policy.scale[0], y = v * policy.scale[1]
  if (policy.rotation !== 0) {
    const c = Math.cos(policy.rotation), s = Math.sin(policy.rotation)
    const nextX = x * c - y * s
    y = x * s + y * c
    x = nextX
  }
  return [x + policy.offset[0], y + policy.offset[1]]
}

function autoPlanarAxis(extent: readonly [number, number, number]): 'xy' | 'xz' | 'yz' {
  if (extent[2] <= extent[0] && extent[2] <= extent[1]) return 'xy'
  if (extent[1] <= extent[0] && extent[1] <= extent[2]) return 'xz'
  return 'yz'
}

function dominantAxis(normal: readonly [number, number, number]): 0 | 1 | 2 {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  if (ax >= ay && ax >= az) return 0
  return ay >= az ? 1 : 2
}

function faceNormal(mesh: GeometryMeshDraft, face: number): [number, number, number] {
  const a = mesh.indices[face * 3]!, b = mesh.indices[face * 3 + 1]!, c = mesh.indices[face * 3 + 2]!
  const ax = mesh.positions[a * 3]!, ay = mesh.positions[a * 3 + 1]!, az = mesh.positions[a * 3 + 2]!
  const bx = mesh.positions[b * 3]!, by = mesh.positions[b * 3 + 1]!, bz = mesh.positions[b * 3 + 2]!
  const cx = mesh.positions[c * 3]!, cy = mesh.positions[c * 3 + 1]!, cz = mesh.positions[c * 3 + 2]!
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az
  const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
  const length = Math.hypot(nx, ny, nz) || 1
  return [nx / length, ny / length, nz / length]
}

function measureBounds(positions: Float32Array): BoundsInfo {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let radius = 0
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) { min[axis] = Math.min(min[axis]!, positions[i + axis]!); max[axis] = Math.max(max[axis]!, positions[i + axis]!) }
    radius = Math.max(radius, Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!))
  }
  return { min, max, extent: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], radius }
}

function normalizeAxis(value: number, min: number, max: number): number { const span = max - min; return Math.abs(span) < 1e-12 ? 0 : (value - min) / span }
function positiveAngle(value: number): number { return value < 0 ? value + Math.PI * 2 : value }
function quantize(value: number): number { return Math.round(value * 1e9) / 1e9 }
function surfaceError(path: string, message: string): GeometryValidationError { return new GeometryValidationError([{ code: 'GEOMETRY_PARAMETER_INVALID', path, message }]) }
