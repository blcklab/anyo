import type { GeometryMeshDraft } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'

export function generateTangents(mesh: GeometryMeshDraft): GeometryMeshDraft {
  if (!mesh.normals) throw tangentError('/normals', 'Tangent generation requires normals.')
  if (!mesh.uvs) throw tangentError('/uvs', 'Tangent generation requires UV coordinates.')
  const vertexCount = mesh.positions.length / 3
  const tan1 = new Float64Array(vertexCount * 3)
  const tan2 = new Float64Array(vertexCount * 3)

  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const i1 = mesh.indices[offset]!, i2 = mesh.indices[offset + 1]!, i3 = mesh.indices[offset + 2]!
    const x1 = mesh.positions[i2 * 3]! - mesh.positions[i1 * 3]!, x2 = mesh.positions[i3 * 3]! - mesh.positions[i1 * 3]!
    const y1 = mesh.positions[i2 * 3 + 1]! - mesh.positions[i1 * 3 + 1]!, y2 = mesh.positions[i3 * 3 + 1]! - mesh.positions[i1 * 3 + 1]!
    const z1 = mesh.positions[i2 * 3 + 2]! - mesh.positions[i1 * 3 + 2]!, z2 = mesh.positions[i3 * 3 + 2]! - mesh.positions[i1 * 3 + 2]!
    const s1 = mesh.uvs[i2 * 2]! - mesh.uvs[i1 * 2]!, s2 = mesh.uvs[i3 * 2]! - mesh.uvs[i1 * 2]!
    const t1 = mesh.uvs[i2 * 2 + 1]! - mesh.uvs[i1 * 2 + 1]!, t2 = mesh.uvs[i3 * 2 + 1]! - mesh.uvs[i1 * 2 + 1]!
    const determinant = s1 * t2 - s2 * t1
    if (Math.abs(determinant) < 1e-14) continue
    const r = 1 / determinant
    const sdir: [number, number, number] = [(t2 * x1 - t1 * x2) * r, (t2 * y1 - t1 * y2) * r, (t2 * z1 - t1 * z2) * r]
    const tdir: [number, number, number] = [(s1 * x2 - s2 * x1) * r, (s1 * y2 - s2 * y1) * r, (s1 * z2 - s2 * z1) * r]
    for (const index of [i1, i2, i3]) {
      tan1[index * 3] = tan1[index * 3]! + sdir[0]; tan1[index * 3 + 1] = tan1[index * 3 + 1]! + sdir[1]; tan1[index * 3 + 2] = tan1[index * 3 + 2]! + sdir[2]
      tan2[index * 3] = tan2[index * 3]! + tdir[0]; tan2[index * 3 + 1] = tan2[index * 3 + 1]! + tdir[1]; tan2[index * 3 + 2] = tan2[index * 3 + 2]! + tdir[2]
    }
  }

  const tangents = new Float32Array(vertexCount * 4)
  for (let index = 0; index < vertexCount; index += 1) {
    const nx = mesh.normals[index * 3]!, ny = mesh.normals[index * 3 + 1]!, nz = mesh.normals[index * 3 + 2]!
    let tx = tan1[index * 3]!, ty = tan1[index * 3 + 1]!, tz = tan1[index * 3 + 2]!
    const projection = nx * tx + ny * ty + nz * tz
    tx -= nx * projection; ty -= ny * projection; tz -= nz * projection
    let length = Math.hypot(tx, ty, tz)
    if (length < 1e-12) {
      ;[tx, ty, tz] = fallbackTangent(nx, ny, nz)
      length = Math.hypot(tx, ty, tz)
    }
    tx /= length; ty /= length; tz /= length
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx
    const handedness = bx * tan2[index * 3]! + by * tan2[index * 3 + 1]! + bz * tan2[index * 3 + 2]! < 0 ? -1 : 1
    tangents[index * 4] = tx; tangents[index * 4 + 1] = ty; tangents[index * 4 + 2] = tz; tangents[index * 4 + 3] = handedness
  }
  return { ...mesh, tangents }
}

function fallbackTangent(nx: number, ny: number, nz: number): [number, number, number] {
  if (Math.abs(ny) < 0.999) {
    const x = nz, y = 0, z = -nx, length = Math.hypot(x, z) || 1
    return [x / length, y, z / length]
  }
  return [1, 0, 0]
}
function tangentError(path: string, message: string): GeometryValidationError { return new GeometryValidationError([{ code: 'GEOMETRY_PARAMETER_INVALID', path, message }]) }
