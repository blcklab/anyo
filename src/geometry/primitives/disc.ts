import type { GeometryDefinition } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { meshFromArrays, positiveInteger, positiveNumber, withoutQuality } from './common.js'
import { qualityDefaults } from './quality.js'

export const discGeometryKind: GeometryKindCompiler = {
  kind: 'disc',
  normalize(definition, context) {
    const radius = positiveNumber(definition, 'radius', 0.5)
    const segments = positiveInteger(definition, 'segments', qualityDefaults(definition).radialSegments, context.limits, 3)
    return { ...withoutQuality(definition), kind: 'disc', radius, segments } as GeometryDefinition
  },
  compile(definition) {
    const radius = Number(definition.radius), segments = Number(definition.segments)
    const positions = [0, 0, 0], normals = [0, 0, 1], uvs = [0.5, 0.5], indices: number[] = []
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2, x = Math.cos(angle) * radius, y = Math.sin(angle) * radius
      positions.push(x, y, 0); normals.push(0, 0, 1); uvs.push(0.5 + x / (2 * radius), 0.5 + y / (2 * radius))
    }
    for (let i = 0; i < segments; i += 1) indices.push(0, i + 1, i + 2)
    return meshFromArrays(positions, indices, normals, uvs, [{ start: 0, count: indices.length, materialIndex: 0, name: 'surface' }])
  },
}
