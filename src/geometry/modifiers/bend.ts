import type { GeometryJsonValue } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
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
    const axis = normalizeAxis(definition.axis)
    const direction = normalizeAxis(definition.direction, '/direction', defaultDirection(axis))
    if (direction === axis) parameterError('/direction', 'bend direction must be perpendicular to bend axis.')
    const angle = finiteNumber(definition.angle ?? 0, '/angle', 'angle')
    return { ...definition, source: source as unknown as GeometryJsonValue, axis, direction, angle }
  },
  compile(definition, context) {
    const source = context.compileChild(requireGeometrySource(definition.source), 'bend')
    const axis = normalizeAxis(definition.axis)
    const direction = normalizeAxis(definition.direction, '/direction', defaultDirection(axis))
    if (direction === axis) parameterError('/direction', 'bend direction must be perpendicular to bend axis.')
    const angle = definition.angle as number
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
  },
}

function defaultDirection(axis: GeometryAxis): GeometryAxis {
  return axis === 'y' ? 'x' : 'y'
}
