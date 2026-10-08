import type {
  GeometryBendOperator,
  GeometryDefinition,
  GeometryJsonValue,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryOperator,
} from '../types/index.js'
import type { GeometryKindCompiler, GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import {
  axisExtent, axisIndex, cloneMeshWithoutBounds, deformGeometryMesh, finiteNumber,
  normalizeAxis, parameterError, requireGeometrySource,
} from './deformCommon.js'
import type { GeometryAxis } from './deformCommon.js'

const EPSILON = 1e-10

export const bendGeometryKind: GeometryKindCompiler = {
  kind: 'bend',
  normalize(definition, context) {
    const source = context.normalizeChild(requireGeometrySource(definition.source), 'bend')
    const operator = normalizeBendOperator(definition)
    return {
      ...definition,
      source: source as unknown as GeometryJsonValue,
      axis: operator.axis,
      direction: operator.direction,
      angle: operator.angle,
    }
  },
  compile(definition, context) {
    const source = context.compileChild(requireGeometrySource(definition.source), 'bend')
    return applyBendOperator(source, definition)
  },
}

export const bendGeometryOperator: GeometryOperatorCompiler = {
  kind: 'bend',
  normalize(operator) {
    return normalizeBendOperator(operator)
  },
  apply(mesh, operator) {
    return applyBendOperator(mesh, operator)
  },
}

export function normalizeBendOperator(input: GeometryOperator | GeometryDefinition): GeometryBendOperator {
  const axis = normalizeAxis(input.axis)
  const direction = normalizeAxis(input.direction, '/direction', defaultDirection(axis))
  if (direction === axis) parameterError('/direction', 'bend direction must be perpendicular to bend axis.')
  return {
    kind: 'bend',
    axis,
    direction,
    angle: finiteNumber(input.angle ?? 0, '/angle', 'angle'),
  }
}

export function applyBendOperator(source: GeometryMesh, input: GeometryOperator | GeometryDefinition): GeometryMeshDraft {
  const operator = normalizeBendOperator(input)
  const axis = operator.axis!
  const direction = operator.direction!
  const angle = operator.angle!
  if (Math.abs(angle) <= EPSILON) return cloneMeshWithoutBounds(source)
  const { min, extent } = axisExtent(source, axis)
  if (extent <= EPSILON) parameterError('/axis', `bend axis ${axis} has zero source extent.`)
  const ai = axisIndex(axis)
  const di = axisIndex(direction)
  const centerDirection = (source.bounds.min[di] + source.bounds.max[di]) * 0.5
  const radius = extent / angle
  if (!Number.isFinite(radius)) parameterError('/angle', 'bend angle produces a non-finite bend radius.')
  return deformGeometryMesh(source, (position) => {
    const distance = position[ai] - min
    const theta = (distance / extent) * angle
    const cosine = Math.cos(theta)
    const sine = Math.sin(theta)
    const offset = position[di] - centerDirection
    const centerDirectionPosition = centerDirection + radius * (1 - cosine)
    const centerAxisPosition = min + radius * sine
    const output: [number, number, number] = [position[0], position[1], position[2]]
    output[di] = centerDirectionPosition + offset * cosine
    output[ai] = centerAxisPosition - offset * sine
    return output
  })
}

function defaultDirection(axis: GeometryAxis): GeometryAxis {
  return axis === 'y' ? 'x' : 'y'
}
