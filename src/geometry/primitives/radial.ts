import type { GeometryGroup } from '../types/index.js'
import { indexArray, normalize3 } from './common.js'

export function createCylinderLike(radiusBottom: number, radiusTop: number, height: number, segments: number, cap: boolean) {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = []
  const groups: GeometryGroup[] = []
  const half = height / 2
  const slope = (radiusBottom - radiusTop) / height
  const sideBase = positions.length / 3
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments, angle = u * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle)
    const normal = normalize3(c, slope, s)
    positions.push(c * radiusBottom, -half, s * radiusBottom, c * radiusTop, half, s * radiusTop)
    normals.push(...normal, ...normal)
    uvs.push(u, 0, u, 1)
  }
  for (let i = 0; i < segments; i += 1) {
    const b = sideBase + i * 2, t = b + 1, bn = b + 2, tn = b + 3
    if (radiusTop <= 1e-12) indices.push(b, t, bn)
    else indices.push(b, t, tn, b, tn, bn)
  }
  groups.push({ start: 0, count: indices.length, materialIndex: 0, name: 'side' })
  if (cap && radiusBottom > 1e-12) {
    const start = indices.length
    addCap(positions, normals, uvs, indices, radiusBottom, -half, segments, false)
    groups.push({ start, count: indices.length - start, materialIndex: 0, name: 'bottom' })
  }
  if (cap && radiusTop > 1e-12) {
    const start = indices.length
    addCap(positions, normals, uvs, indices, radiusTop, half, segments, true)
    groups.push({ start, count: indices.length - start, materialIndex: 0, name: 'top' })
  }
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs),
    indices: indexArray(indices, positions.length / 3), groups,
  }
}

function addCap(positions: number[], normals: number[], uvs: number[], indices: number[], radius: number, y: number, segments: number, top: boolean): void {
  const center = positions.length / 3
  positions.push(0, y, 0); normals.push(0, top ? 1 : -1, 0); uvs.push(0.5, 0.5)
  const ring = positions.length / 3
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle)
    positions.push(c * radius, y, s * radius); normals.push(0, top ? 1 : -1, 0); uvs.push(0.5 + c * 0.5, 0.5 + s * 0.5)
  }
  for (let i = 0; i < segments; i += 1) {
    if (top) indices.push(center, ring + i + 1, ring + i)
    else indices.push(center, ring + i, ring + i + 1)
  }
}
