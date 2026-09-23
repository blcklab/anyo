import type { GeometryDefinition } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { indexArray, positiveInteger, positiveNumber, withoutQuality } from './common.js'
import { qualityDefaults } from './quality.js'

export const torusGeometryKind: GeometryKindCompiler = {
  kind: 'torus',
  normalize(definition, context) {
    const defaults = qualityDefaults(definition)
    const radius = positiveNumber(definition, 'radius', 0.75)
    const tubeRadius = positiveNumber(definition, 'tubeRadius', 0.25)
    const segments = positiveInteger(definition, 'segments', defaults.torusSegments, context.limits, 3)
    const tubeSegments = positiveInteger(definition, 'tubeSegments', defaults.torusTubeSegments, context.limits, 3)
    return { ...withoutQuality(definition), kind: 'torus', radius, tubeRadius, segments, tubeSegments } as GeometryDefinition
  },
  compile(definition) {
    const radius = Number(definition.radius), tubeRadius = Number(definition.tubeRadius), segments = Number(definition.segments), tubeSegments = Number(definition.tubeSegments)
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = []
    for (let ring = 0; ring <= segments; ring += 1) {
      const u = ring / segments, theta = u * Math.PI * 2, ct = Math.cos(theta), st = Math.sin(theta)
      for (let tube = 0; tube <= tubeSegments; tube += 1) {
        const v = tube / tubeSegments, phi = v * Math.PI * 2, cp = Math.cos(phi), sp = Math.sin(phi)
        const rr = radius + tubeRadius * cp
        positions.push(rr * ct, tubeRadius * sp, rr * st)
        normals.push(cp * ct, sp, cp * st)
        uvs.push(u, v)
      }
    }
    const columns = tubeSegments + 1
    for (let ring = 0; ring < segments; ring += 1) for (let tube = 0; tube < tubeSegments; tube += 1) {
      const a = ring * columns + tube, b = (ring + 1) * columns + tube, c = b + 1, d = a + 1
      indices.push(a, d, b, d, c, b)
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: indexArray(indices, positions.length / 3), groups: [{ start: 0, count: indices.length, materialIndex: 0, name: 'surface' }] }
  },
}
