import type {
  GeometryDefinition,
  GeometryJsonValue,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryOperator,
  GeometryTaperOperator,
} from '../types/index.js'
import type { GeometryKindCompiler, GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import {
  axisExtent, axisIndex, cloneMeshWithoutBounds, deformGeometryMesh, nonNegativeNumber,
  normalizeAxis, parameterError, perpendicularAxes, requireGeometrySource,
} from './deformCommon.js'

const EPSILON = 1e-12

export const taperGeometryKind: GeometryKindCompiler = {
  kind: 'taper',
  normalize(definition, context) {
    const source = context.normalizeChild(requireGeometrySource(definition.source), 'taper')
    const operator = normalizeTaperOperator(definition)
    return {
      ...definition,
      source: source as unknown as GeometryJsonValue,
      axis: operator.axis,
      startScale: operator.startScale,
      endScale: operator.endScale,
    }
  },
  compile(definition, context) {
    const source = context.compileChild(requireGeometrySource(definition.source), 'taper')
    return applyTaperOperator(source, definition)
  },
}

export const taperGeometryOperator: GeometryOperatorCompiler = {
  kind: 'taper',
  normalize(operator) {
    return normalizeTaperOperator(operator)
  },
  apply(mesh, operator) {
    return applyTaperOperator(mesh, operator)
  },
}

export function normalizeTaperOperator(input: GeometryOperator | GeometryDefinition): GeometryTaperOperator {
  const axis = normalizeAxis(input.axis)
  const startScale = nonNegativeNumber(input.startScale ?? 1, '/startScale', 'startScale')
  const endScale = nonNegativeNumber(input.endScale ?? 1, '/endScale', 'endScale')
  if (startScale === 0 && endScale === 0) parameterError('/startScale', 'startScale and endScale cannot both be zero.')
  return { kind: 'taper', axis, startScale, endScale }
}

export function applyTaperOperator(source: GeometryMesh, input: GeometryOperator | GeometryDefinition): GeometryMeshDraft {
  const operator = normalizeTaperOperator(input)
  const axis = operator.axis!
  const startScale = operator.startScale!
  const endScale = operator.endScale!
  if (Math.abs(startScale - 1) <= EPSILON && Math.abs(endScale - 1) <= EPSILON) return cloneMeshWithoutBounds(source)
  const { min, extent } = axisExtent(source, axis)
  const ai = axisIndex(axis)
  const [p0, p1] = perpendicularAxes(axis)
  const center0 = (source.bounds.min[p0] + source.bounds.max[p0]) * 0.5
  const center1 = (source.bounds.min[p1] + source.bounds.max[p1]) * 0.5
  if (extent <= EPSILON && Math.abs(startScale - endScale) > EPSILON) parameterError('/axis', `taper axis ${axis} has zero source extent.`)
  return deformGeometryMesh(source, (position) => {
    const t = extent <= EPSILON ? 0.5 : (position[ai] - min) / extent
    const scale = startScale + (endScale - startScale) * t
    const output: [number, number, number] = [position[0], position[1], position[2]]
    output[p0] = center0 + (position[p0] - center0) * scale
    output[p1] = center1 + (position[p1] - center1) * scale
    return output
  })
}
