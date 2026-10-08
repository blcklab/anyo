import type { GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import { transformGeometryOperator } from '../modifiers/transform.js'
import { taperGeometryOperator } from '../modifiers/taper.js'
import { twistGeometryOperator } from '../modifiers/twist.js'
import { bendGeometryOperator } from '../modifiers/bend.js'
import { mirrorGeometryOperator } from '../modifiers/mirror.js'
import { noiseGeometryOperator } from '../modifiers/noise.js'
import { arrayGeometryOperator } from '../modifiers/array.js'
import { weldGeometryOperator } from '../modifiers/weld.js'

export { pipelineGeometryKind } from './pipeline.js'
export {
  transformGeometryOperator, taperGeometryOperator, twistGeometryOperator, bendGeometryOperator,
  mirrorGeometryOperator, noiseGeometryOperator, arrayGeometryOperator, weldGeometryOperator,
}

export const BUILTIN_GEOMETRY_OPERATORS: readonly GeometryOperatorCompiler[] = Object.freeze([
  transformGeometryOperator,
  taperGeometryOperator,
  twistGeometryOperator,
  bendGeometryOperator,
  mirrorGeometryOperator,
  noiseGeometryOperator,
  arrayGeometryOperator,
  weldGeometryOperator,
])

export const BUILTIN_GEOMETRY_OPERATOR_NAMES: readonly string[] = Object.freeze(BUILTIN_GEOMETRY_OPERATORS.map(operator => operator.kind))
