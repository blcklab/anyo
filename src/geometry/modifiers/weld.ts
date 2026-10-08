import type {
  GeometryGroup,
  GeometryIssue,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryOperator,
  GeometryWeldOperator,
} from '../types/index.js'
import type { GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import { GeometryValidationError } from '../validation/errors.js'

const DEFAULT_TOLERANCE = 1e-6

export const weldGeometryOperator: GeometryOperatorCompiler = {
  kind: 'weld',
  normalize(operator) {
    return normalizeWeldOperator(operator)
  },
  apply(mesh, operator) {
    return applyWeldOperator(mesh, operator)
  },
}

export function normalizeWeldOperator(input: GeometryOperator): GeometryWeldOperator {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance <= 0) {
    parameterError('/tolerance', 'tolerance must be a finite number greater than zero.')
  }
  return { kind: 'weld', tolerance }
}

/**
 * Welds position-near vertices only when every authored vertex attribute is also
 * identical. This preserves UV seams, hard-normal splits, tangent handedness,
 * colors, material groups, and triangle order while removing safe duplicates.
 */
export function applyWeldOperator(source: GeometryMesh, input: GeometryOperator): GeometryMeshDraft {
  const tolerance = normalizeWeldOperator(input).tolerance!
  const toleranceSquared = tolerance * tolerance
  const vertexCount = source.positions.length / 3
  const remap = new Uint32Array(vertexCount)
  const buckets = new Map<string, number[]>()
  const positions: number[] = []
  const normals: number[] | undefined = source.normals ? [] : undefined
  const uvs: number[] | undefined = source.uvs ? [] : undefined
  const tangents: number[] | undefined = source.tangents ? [] : undefined
  const colors: number[] | undefined = source.colors ? [] : undefined

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const po = vertex * 3
    const x = source.positions[po]!
    const y = source.positions[po + 1]!
    const z = source.positions[po + 2]!
    const cx = Math.floor(x / tolerance)
    const cy = Math.floor(y / tolerance)
    const cz = Math.floor(z / tolerance)
    const signature = attributeSignature(source, vertex)
    let welded = -1

    search:
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const candidates = buckets.get(bucketKey(cx + dx, cy + dy, cz + dz, signature))
          if (!candidates) continue
          for (const candidate of candidates) {
            const co = candidate * 3
            const qx = positions[co]!
            const qy = positions[co + 1]!
            const qz = positions[co + 2]!
            const ddx = x - qx
            const ddy = y - qy
            const ddz = z - qz
            if (ddx * ddx + ddy * ddy + ddz * ddz <= toleranceSquared) {
              welded = candidate
              break search
            }
          }
        }
      }
    }

    if (welded < 0) {
      welded = positions.length / 3
      positions.push(x, y, z)
      if (normals) copyAttribute(source.normals!, vertex, 3, normals)
      if (uvs) copyAttribute(source.uvs!, vertex, 2, uvs)
      if (tangents) copyAttribute(source.tangents!, vertex, 4, tangents)
      if (colors) copyAttribute(source.colors!, vertex, 4, colors)
      const key = bucketKey(cx, cy, cz, signature)
      const list = buckets.get(key)
      if (list) list.push(welded)
      else buckets.set(key, [welded])
    }
    remap[vertex] = welded
  }

  const weldedVertexCount = positions.length / 3
  const indices = weldedVertexCount > 65_535 ? new Uint32Array(source.indices.length) : new Uint16Array(source.indices.length)
  for (let index = 0; index < source.indices.length; index += 1) indices[index] = remap[source.indices[index]!]!

  return {
    positions: Float32Array.from(positions),
    indices,
    ...(normals ? { normals: Float32Array.from(normals) } : {}),
    ...(uvs ? { uvs: Float32Array.from(uvs) } : {}),
    ...(tangents ? { tangents: Float32Array.from(tangents) } : {}),
    ...(colors ? { colors: Float32Array.from(colors) } : {}),
    ...(source.groups ? { groups: cloneGroups(source.groups) } : {}),
  }
}

function attributeSignature(source: GeometryMesh, vertex: number): string {
  const values: number[] = []
  if (source.normals) appendAttribute(source.normals, vertex, 3, values)
  if (source.uvs) appendAttribute(source.uvs, vertex, 2, values)
  if (source.tangents) appendAttribute(source.tangents, vertex, 4, values)
  if (source.colors) appendAttribute(source.colors, vertex, 4, values)
  return values.join(',')
}
function appendAttribute(source: Float32Array, vertex: number, width: number, output: number[]): void {
  const start = vertex * width
  for (let index = 0; index < width; index += 1) output.push(source[start + index]!)
}
function copyAttribute(source: Float32Array, vertex: number, width: number, output: number[]): void {
  appendAttribute(source, vertex, width, output)
}
function bucketKey(x: number, y: number, z: number, signature: string): string {
  return `${x},${y},${z}|${signature}`
}
function cloneGroups(groups: readonly GeometryGroup[]): readonly GeometryGroup[] {
  return Object.freeze(groups.map(group => Object.freeze({ ...group })))
}
function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}
