import type { GeometryDefinition } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { booleanValue, positiveInteger, positiveNumber, withoutQuality } from './common.js'
import { qualityDefaults } from './quality.js'
import { createCylinderLike } from './radial.js'

export const cylinderGeometryKind: GeometryKindCompiler = {
  kind: 'cylinder',
  normalize(definition, context) {
    const radius = positiveNumber(definition, 'radius', 0.5)
    const height = positiveNumber(definition, 'height', 1)
    const segments = positiveInteger(definition, 'segments', qualityDefaults(definition).radialSegments, context.limits, 3)
    const cap = booleanValue(definition, 'cap', true)
    return { ...withoutQuality(definition), kind: 'cylinder', radius, height, segments, cap } as GeometryDefinition
  },
  compile(definition) { return createCylinderLike(Number(definition.radius), Number(definition.radius), Number(definition.height), Number(definition.segments), Boolean(definition.cap)) },
}
