import type { GeometryDefinition } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { indexArray, positiveInteger, positiveNumber, withoutQuality } from './common.js'
import { qualityDefaults } from './quality.js'

export const sphereGeometryKind: GeometryKindCompiler = {
  kind: 'sphere',
  normalize(definition, context) {
    const defaults = qualityDefaults(definition)
    const radius = positiveNumber(definition, 'radius', 0.5)
    const segments = positiveInteger(definition, 'segments', defaults.sphereSegments, context.limits, 3)
    const rings = positiveInteger(definition, 'rings', defaults.sphereRings, context.limits, 2)
    return { ...withoutQuality(definition), kind: 'sphere', radius, segments, rings } as GeometryDefinition
  },
  compile(definition) {
    const radius = Number(definition.radius), segments = Number(definition.segments), rings = Number(definition.rings)
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = []
    for (let row = 0; row <= rings; row += 1) {
      const v = row / rings, phi = v * Math.PI, sinPhi = Math.sin(phi), cosPhi = Math.cos(phi)
      for (let column = 0; column <= segments; column += 1) {
        const u = column / segments, theta = u * Math.PI * 2, x = sinPhi * Math.cos(theta), y = cosPhi, z = sinPhi * Math.sin(theta)
        positions.push(x * radius, y * radius, z * radius); normals.push(x, y, z); uvs.push(u, 1 - v)
      }
    }
    const columns = segments + 1
    for (let row = 0; row < rings; row += 1) for (let column = 0; column < segments; column += 1) {
      const a = row * columns + column, b = a + columns, c = b + 1, d = a + 1
      if (row !== 0) indices.push(a, d, b)
      if (row !== rings - 1) indices.push(d, c, b)
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: indexArray(indices, positions.length / 3), groups: [{ start: 0, count: indices.length, materialIndex: 0, name: 'surface' }] }
  },
}
