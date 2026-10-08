import type {
  GeometryDefinition,
  GeometryJsonValue,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryOperator,
  GeometryTwistOperator,
} from '../types/index.js'
import type { GeometryKindCompiler, GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import {
  axisExtent, axisIndex, cloneMeshWithoutBounds, deformGeometryMesh, finiteNumber,
  normalizeAxis, parameterError, perpendicularAxes, requireGeometrySource,
} from './deformCommon.js'

const EPSILON = 1e-12

export const twistGeometryKind: GeometryKindCompiler = {
  kind: 'twist',
  normalize(definition, context) {
    const source = context.normalizeChild(requireGeometrySource(definition.source), 'twist')
    const operator = normalizeTwistOperator(definition)
    return {
      ...definition,
      source: source as unknown as GeometryJsonValue,
      axis: operator.axis,
      angle: operator.angle,
    }
  },
  compile(definition, context) {
    const source = context.compileChild(requireGeometrySource(definition.source), 'twist')
    return applyTwistOperator(source, definition)
  },
}

export const twistGeometryOperator: GeometryOperatorCompiler = {
  kind: 'twist',
  normalize(operator) {
    return normalizeTwistOperator(operator)
  },
  apply(mesh, operator) {
    return applyTwistOperator(mesh, operator)
  },
}

export function normalizeTwistOperator(input: GeometryOperator | GeometryDefinition): GeometryTwistOperator {
  return {
    kind: 'twist',
    axis: normalizeAxis(input.axis),
    angle: finiteNumber(input.angle ?? 0, '/angle', 'angle'),
  }
}

export function applyTwistOperator(source: GeometryMesh, input: GeometryOperator | GeometryDefinition): GeometryMeshDraft {
  const operator = normalizeTwistOperator(input)
  const axis = operator.axis!
  const angle = operator.angle!
  if (Math.abs(angle) <= EPSILON) return cloneMeshWithoutBounds(source)
  const { min, extent } = axisExtent(source, axis)
  if (extent <= EPSILON) parameterError('/axis', `twist axis ${axis} has zero source extent.`)
  const ai = axisIndex(axis)
  const [p0, p1] = perpendicularAxes(axis)
  const center0 = (source.bounds.min[p0] + source.bounds.max[p0]) * 0.5
  const center1 = (source.bounds.min[p1] + source.bounds.max[p1]) * 0.5
  return deformGeometryMesh(source, (position) => {
    const t = (position[ai] - min) / extent
    const theta = angle * t
    const cosine = Math.cos(theta)
    const sine = Math.sin(theta)
    const a = position[p0] - center0
    const b = position[p1] - center1
    const output: [number, number, number] = [position[0], position[1], position[2]]
    output[p0] = center0 + a * cosine - b * sine
    output[p1] = center1 + a * sine + b * cosine
    return output
  })
}
