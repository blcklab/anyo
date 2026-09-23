import type { GeometryGroup, GeometryMesh, GeometryMeshDraft } from '../types/index.js'
import { quaternionFromEulerXYZ, rotateVectorByQuaternion } from '../../math/quaternion.js'
import type { Euler, Quaternion, Vec3 } from '../../core/types.js'

export interface GeometryLocalTransform {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export function transformGeometryMesh(mesh: GeometryMesh, transform: GeometryLocalTransform): GeometryMeshDraft {
  const quaternion = quaternionFromEulerXYZ(transform.rotation as Euler)
  const determinant = transform.scale[0] * transform.scale[1] * transform.scale[2]
  const positions = new Float32Array(mesh.positions.length)
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    const point = transformPoint([
      mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!,
    ], transform, quaternion)
    positions[offset] = point[0]
    positions[offset + 1] = point[1]
    positions[offset + 2] = point[2]
  }

  const normals = mesh.normals ? transformNormals(mesh.normals, transform.scale, quaternion) : undefined
  const tangents = mesh.tangents ? transformTangents(mesh.tangents, normals, transform.scale, quaternion, determinant) : undefined
  const indices = cloneIndices(mesh.indices)
  if (determinant < 0) reverseTriangleWinding(indices)

  return {
    positions,
    indices,
    ...(normals ? { normals } : {}),
    ...(mesh.uvs ? { uvs: new Float32Array(mesh.uvs) } : {}),
    ...(tangents ? { tangents } : {}),
    ...(mesh.colors ? { colors: new Float32Array(mesh.colors) } : {}),
    ...(mesh.groups ? { groups: cloneGroups(mesh.groups) } : {}),
  }
}

export function mergeGeometryMeshes(a: GeometryMesh, b: GeometryMesh): GeometryMeshDraft {
  const aVertices = a.positions.length / 3
  const totalVertices = aVertices + b.positions.length / 3
  const positions = concatFloat32(a.positions, b.positions)
  const indices = totalVertices > 65_535
    ? new Uint32Array(a.indices.length + b.indices.length)
    : new Uint16Array(a.indices.length + b.indices.length)
  indices.set(a.indices, 0)
  for (let index = 0; index < b.indices.length; index += 1) indices[a.indices.length + index] = b.indices[index]! + aVertices

  const normals = concatOptional(a.normals, b.normals)
  const uvs = concatOptional(a.uvs, b.uvs)
  const tangents = concatOptional(a.tangents, b.tangents)
  const colors = concatOptional(a.colors, b.colors)
  const groups: GeometryGroup[] = []
  if (a.groups) for (const group of a.groups) groups.push({ ...group })
  if (b.groups) for (const group of b.groups) groups.push({ ...group, start: group.start + a.indices.length })

  return {
    positions,
    indices,
    ...(normals ? { normals } : {}),
    ...(uvs ? { uvs } : {}),
    ...(tangents ? { tangents } : {}),
    ...(colors ? { colors } : {}),
    ...(groups.length ? { groups: Object.freeze(groups.map(group => Object.freeze(group))) } : {}),
  }
}

function transformPoint(value: Vec3, transform: GeometryLocalTransform, quaternion: Quaternion): Vec3 {
  const scaled: Vec3 = [
    value[0] * transform.scale[0],
    value[1] * transform.scale[1],
    value[2] * transform.scale[2],
  ]
  const rotated = rotateVectorByQuaternion(scaled, quaternion)
  return [
    rotated[0] + transform.position[0],
    rotated[1] + transform.position[1],
    rotated[2] + transform.position[2],
  ]
}

function transformNormals(values: Float32Array, scale: [number, number, number], quaternion: Quaternion): Float32Array {
  const output = new Float32Array(values.length)
  for (let offset = 0; offset < values.length; offset += 3) {
    const inverseScaled: Vec3 = [values[offset]! / scale[0], values[offset + 1]! / scale[1], values[offset + 2]! / scale[2]]
    const rotated = rotateVectorByQuaternion(inverseScaled, quaternion)
    const normal = normalize(rotated)
    output[offset] = normal[0]
    output[offset + 1] = normal[1]
    output[offset + 2] = normal[2]
  }
  return output
}

function transformTangents(
  values: Float32Array,
  normals: Float32Array | undefined,
  scale: [number, number, number],
  quaternion: Quaternion,
  determinant: number,
): Float32Array {
  const output = new Float32Array(values.length)
  for (let vertex = 0; vertex < values.length / 4; vertex += 1) {
    const offset = vertex * 4
    const scaled: Vec3 = [values[offset]! * scale[0], values[offset + 1]! * scale[1], values[offset + 2]! * scale[2]]
    let tangent = normalize(rotateVectorByQuaternion(scaled, quaternion))
    if (normals) {
      const no = vertex * 3
      const normal: Vec3 = [normals[no]!, normals[no + 1]!, normals[no + 2]!]
      const projection = tangent[0] * normal[0] + tangent[1] * normal[1] + tangent[2] * normal[2]
      tangent = normalize([
        tangent[0] - normal[0] * projection,
        tangent[1] - normal[1] * projection,
        tangent[2] - normal[2] * projection,
      ])
    }
    output[offset] = tangent[0]
    output[offset + 1] = tangent[1]
    output[offset + 2] = tangent[2]
    output[offset + 3] = values[offset + 3]! * (determinant < 0 ? -1 : 1)
  }
  return output
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  if (length <= 1e-12) return [1, 0, 0]
  return [value[0] / length, value[1] / length, value[2] / length]
}
function reverseTriangleWinding(indices: Uint16Array | Uint32Array): void {
  for (let offset = 0; offset < indices.length; offset += 3) {
    const b = indices[offset + 1]!
    indices[offset + 1] = indices[offset + 2]!
    indices[offset + 2] = b
  }
}
function cloneIndices(indices: Uint16Array | Uint32Array): Uint16Array | Uint32Array {
  return indices instanceof Uint32Array ? new Uint32Array(indices) : new Uint16Array(indices)
}
function cloneGroups(groups: readonly GeometryGroup[]): readonly GeometryGroup[] {
  return Object.freeze(groups.map(group => Object.freeze({ ...group })))
}
function concatFloat32(a: Float32Array, b: Float32Array): Float32Array {
  const output = new Float32Array(a.length + b.length)
  output.set(a, 0)
  output.set(b, a.length)
  return output
}
function concatOptional(a: Float32Array | undefined, b: Float32Array | undefined): Float32Array | undefined {
  if (!a && !b) return undefined
  if (!a || !b) throw new Error('Cannot merge geometry meshes with incompatible vertex attribute sets.')
  return concatFloat32(a, b)
}
