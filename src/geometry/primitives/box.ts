import type { GeometryDefinition, GeometryGroup } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { meshFromArrays, size3, withoutQuality } from './common.js'

function addFace(
  positions: number[], normals: number[], uvs: number[], indices: number[],
  origin: readonly [number, number, number], u: readonly [number, number, number], v: readonly [number, number, number], normal: readonly [number, number, number],
): void {
  const base = positions.length / 3
  const corners = [
    origin,
    [origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]],
    [origin[0] + u[0] + v[0], origin[1] + u[1] + v[1], origin[2] + u[2] + v[2]],
    [origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]],
  ] as const
  for (const point of corners) positions.push(point[0], point[1], point[2])
  for (let i = 0; i < 4; i += 1) normals.push(...normal)
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

export const boxGeometryKind: GeometryKindCompiler = {
  kind: 'box',
  normalize(definition) {
    return { ...withoutQuality(definition), kind: 'box', size: [...size3(definition)] } as GeometryDefinition
  },
  compile(definition) {
    const [width, height, depth] = size3(definition)
    const x = width / 2, y = height / 2, z = depth / 2
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = []
    const groups: GeometryGroup[] = []
    const face = (name: string, origin: readonly [number, number, number], u: readonly [number, number, number], v: readonly [number, number, number], normal: readonly [number, number, number]) => {
      const start = indices.length
      addFace(positions, normals, uvs, indices, origin, u, v, normal)
      groups.push({ start, count: indices.length - start, materialIndex: 0, name })
    }
    face('front', [-x, -y, z], [width, 0, 0], [0, height, 0], [0, 0, 1])
    face('back', [x, -y, -z], [-width, 0, 0], [0, height, 0], [0, 0, -1])
    face('right', [x, -y, z], [0, 0, -depth], [0, height, 0], [1, 0, 0])
    face('left', [-x, -y, -z], [0, 0, depth], [0, height, 0], [-1, 0, 0])
    face('top', [-x, y, z], [width, 0, 0], [0, 0, -depth], [0, 1, 0])
    face('bottom', [-x, -y, -z], [width, 0, 0], [0, 0, depth], [0, -1, 0])
    return meshFromArrays(positions, indices, normals, uvs, groups)
  },
}
