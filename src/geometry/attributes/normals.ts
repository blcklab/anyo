import type { GeometryMeshDraft, GeometryNormalMode } from '../types/index.js'
import { indexArray } from '../primitives/common.js'

const KEY_PRECISION = 1e8

interface FaceData {
  unit: readonly [number, number, number]
  area: readonly [number, number, number]
}

export function generateNormals(
  mesh: GeometryMeshDraft,
  options: { mode: GeometryNormalMode; creaseAngle?: number },
): GeometryMeshDraft {
  const faceCount = mesh.indices.length / 3
  const faces: FaceData[] = new Array(faceCount)
  const facesAtPosition = new Map<string, Set<number>>()

  for (let face = 0; face < faceCount; face += 1) {
    const i0 = mesh.indices[face * 3]!, i1 = mesh.indices[face * 3 + 1]!, i2 = mesh.indices[face * 3 + 2]!
    const ax = mesh.positions[i0 * 3]!, ay = mesh.positions[i0 * 3 + 1]!, az = mesh.positions[i0 * 3 + 2]!
    const bx = mesh.positions[i1 * 3]!, by = mesh.positions[i1 * 3 + 1]!, bz = mesh.positions[i1 * 3 + 2]!
    const cx = mesh.positions[i2 * 3]!, cy = mesh.positions[i2 * 3 + 1]!, cz = mesh.positions[i2 * 3 + 2]!
    const abx = bx - ax, aby = by - ay, abz = bz - az
    const acx = cx - ax, acy = cy - ay, acz = cz - az
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    const length = Math.hypot(nx, ny, nz)
    const unit: [number, number, number] = length > 1e-15 ? [nx / length, ny / length, nz / length] : [0, 1, 0]
    faces[face] = { unit, area: [nx, ny, nz] }
    for (const index of [i0, i1, i2]) {
      const key = positionKey(mesh.positions, index)
      let bucket = facesAtPosition.get(key)
      if (!bucket) facesAtPosition.set(key, bucket = new Set())
      bucket.add(face)
    }
  }

  const creaseAngle = options.mode === 'flat' ? 0 : (options.creaseAngle ?? Math.PI)
  const cosine = Math.cos(Math.max(0, Math.min(Math.PI, creaseAngle)))
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] | undefined = mesh.uvs ? [] : undefined
  const colors: number[] | undefined = mesh.colors ? [] : undefined
  const indices: number[] = []
  const remap = new Map<string, number>()

  for (let corner = 0; corner < mesh.indices.length; corner += 1) {
    const originalIndex = mesh.indices[corner]!
    const face = Math.floor(corner / 3)
    const faceNormal = faces[face]!.unit
    let nx = faceNormal[0], ny = faceNormal[1], nz = faceNormal[2]
    if (options.mode === 'smooth') {
      nx = 0; ny = 0; nz = 0
      const bucket = facesAtPosition.get(positionKey(mesh.positions, originalIndex))!
      for (const candidateIndex of bucket) {
        const candidate = faces[candidateIndex]!
        const dot = faceNormal[0] * candidate.unit[0] + faceNormal[1] * candidate.unit[1] + faceNormal[2] * candidate.unit[2]
        if (dot + 1e-12 >= cosine) {
          nx += candidate.area[0]; ny += candidate.area[1]; nz += candidate.area[2]
        }
      }
      const length = Math.hypot(nx, ny, nz)
      if (length > 1e-15) { nx /= length; ny /= length; nz /= length }
      else { nx = faceNormal[0]; ny = faceNormal[1]; nz = faceNormal[2] }
    }

    const normalKey = `${roundKey(nx)},${roundKey(ny)},${roundKey(nz)}`
    const key = `${originalIndex}|${normalKey}`
    let nextIndex = remap.get(key)
    if (nextIndex === undefined) {
      nextIndex = positions.length / 3
      remap.set(key, nextIndex)
      positions.push(mesh.positions[originalIndex * 3]!, mesh.positions[originalIndex * 3 + 1]!, mesh.positions[originalIndex * 3 + 2]!)
      normals.push(nx, ny, nz)
      if (uvs && mesh.uvs) uvs.push(mesh.uvs[originalIndex * 2]!, mesh.uvs[originalIndex * 2 + 1]!)
      if (colors && mesh.colors) colors.push(mesh.colors[originalIndex * 4]!, mesh.colors[originalIndex * 4 + 1]!, mesh.colors[originalIndex * 4 + 2]!, mesh.colors[originalIndex * 4 + 3]!)
    }
    indices.push(nextIndex)
  }

  return {
    positions: new Float32Array(positions),
    indices: indexArray(indices, positions.length / 3),
    normals: new Float32Array(normals),
    ...(uvs ? { uvs: new Float32Array(uvs) } : {}),
    ...(colors ? { colors: new Float32Array(colors) } : {}),
    ...(mesh.groups ? { groups: mesh.groups } : {}),
    ...(mesh.bounds ? { bounds: mesh.bounds } : {}),
  }
}

function positionKey(positions: Float32Array, index: number): string {
  return `${roundKey(positions[index * 3]!)},${roundKey(positions[index * 3 + 1]!)},${roundKey(positions[index * 3 + 2]!)}`
}

function roundKey(value: number): number {
  return Math.round(value * KEY_PRECISION) / KEY_PRECISION
}
