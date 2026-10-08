import type { GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import { transformGeometryOperator } from '../modifiers/transform.js'
import { taperGeometryOperator } from '../modifiers/taper.js'
import { twistGeometryOperator } from '../modifiers/twist.js'

export { pipelineGeometryKind } from './pipeline.js'
export { transformGeometryOperator, taperGeometryOperator, twistGeometryOperator }

export const BUILTIN_GEOMETRY_OPERATORS: readonly GeometryOperatorCompiler[] = Object.freeze([
  transformGeometryOperator,
  taperGeometryOperator,
  twistGeometryOperator,
])

export const BUILTIN_GEOMETRY_OPERATOR_NAMES: readonly string[] = Object.freeze(BUILTIN_GEOMETRY_OPERATORS.map(operator => operator.kind))
