import type { GeometryDefinition, GeometryJsonValue, GeometryOperator } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { GeometryValidationError } from '../validation/errors.js'

export const pipelineGeometryKind: GeometryKindCompiler = {
  kind: 'pipeline',
  normalize(definition, context) {
    const source = context.normalizeSource(requireGeometrySource(definition.source))
    const input = definition.modifiers
    if (!Array.isArray(input) || input.length === 0) {
      throw new GeometryValidationError([{
        code: 'GEOMETRY_PARAMETER_INVALID',
        path: '/modifiers',
        message: 'pipeline.modifiers must contain at least one geometry operator.',
      }])
    }
    const modifiers = input.map((operator, index) => context.normalizeOperator(operator, index))
    return {
      ...definition,
      source: source as unknown as GeometryJsonValue,
      modifiers: modifiers as unknown as GeometryJsonValue,
    }
  },
  compile(definition, context) {
    let mesh = context.compileSource(requireGeometrySource(definition.source))
    const modifiers = definition.modifiers
    if (!Array.isArray(modifiers) || modifiers.length === 0) {
      throw new GeometryValidationError([{
        code: 'GEOMETRY_PARAMETER_INVALID',
        path: '/modifiers',
        message: 'pipeline.modifiers must contain at least one geometry operator.',
      }])
    }
    for (let index = 0; index < modifiers.length; index += 1) {
      mesh = context.applyOperator(mesh, modifiers[index] as GeometryOperator, index)
    }
    return mesh
  },
}

function requireGeometrySource(value: unknown): GeometryDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GeometryValidationError([{
      code: 'GEOMETRY_PARAMETER_INVALID',
      path: '/source',
      message: 'pipeline.source must be a geometry definition object.',
    }])
  }
  return value as GeometryDefinition
}
