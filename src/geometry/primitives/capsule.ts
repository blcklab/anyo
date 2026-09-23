import type { GeometryDefinition } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { indexArray, parameterError, positiveInteger, positiveNumber, withoutQuality } from './common.js'
import { qualityDefaults } from './quality.js'

export const capsuleGeometryKind: GeometryKindCompiler = {
  kind: 'capsule',
  normalize(definition, context) {
    const defaults = qualityDefaults(definition)
    const radius = positiveNumber(definition, 'radius', 0.5)
    const height = positiveNumber(definition, 'height', 2)
    if (height + 1e-12 < radius * 2) parameterError('/height', 'capsule height must be at least diameter (2 * radius).')
    const segments = positiveInteger(definition, 'segments', defaults.capsuleSegments, context.limits, 3)
    const rings = positiveInteger(definition, 'rings', defaults.capsuleRings, context.limits, 2)
    return { ...withoutQuality(definition), kind: 'capsule', radius, height, segments, rings } as GeometryDefinition
  },
  compile(definition) {
    const radius = Number(definition.radius), height = Number(definition.height), segments = Number(definition.segments), hemiRings = Number(definition.rings)
    const halfCylinder = (height - 2 * radius) / 2
    const profiles: Array<{ y: number; radial: number; normalY: number; normalRadial: number }> = []
    for (let ring = 0; ring <= hemiRings; ring += 1) {
      const a = (ring / hemiRings) * Math.PI / 2
      profiles.push({ y: halfCylinder + Math.cos(a) * radius, radial: Math.sin(a) * radius, normalY: Math.cos(a), normalRadial: Math.sin(a) })
    }
    const bottomStart = halfCylinder <= 1e-12 ? 1 : 0
    for (let ring = bottomStart; ring <= hemiRings; ring += 1) {
      const a = Math.PI / 2 + (ring / hemiRings) * Math.PI / 2
      profiles.push({ y: -halfCylinder + Math.cos(a) * radius, radial: Math.sin(a) * radius, normalY: Math.cos(a), normalRadial: Math.sin(a) })
    }
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = []
    for (let row = 0; row < profiles.length; row += 1) {
      const profile = profiles[row]!, v = (profile.y + height / 2) / height
      for (let column = 0; column <= segments; column += 1) {
        const u = column / segments, theta = u * Math.PI * 2, c = Math.cos(theta), s = Math.sin(theta)
        positions.push(c * profile.radial, profile.y, s * profile.radial)
        normals.push(c * profile.normalRadial, profile.normalY, s * profile.normalRadial)
        uvs.push(u, v)
      }
    }
    const columns = segments + 1
    for (let row = 0; row < profiles.length - 1; row += 1) for (let column = 0; column < segments; column += 1) {
      const a = row * columns + column, b = a + columns, c = b + 1, d = a + 1
      if (row !== 0) indices.push(a, d, b)
      if (row !== profiles.length - 2) indices.push(d, c, b)
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: indexArray(indices, positions.length / 3), groups: [{ start: 0, count: indices.length, materialIndex: 0, name: 'surface' }] }
  },
}
