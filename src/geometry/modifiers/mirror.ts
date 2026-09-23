import type { GeometryDefinition, GeometryIssue, GeometryJsonValue } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { GeometryValidationError } from '../validation/errors.js'
import { mergeGeometryMeshes, transformGeometryMesh } from './meshTransform.js'

export const mirrorGeometryKind: GeometryKindCompiler = {
  kind: 'mirror',
  normalize(definition, context) {
    const source = context.normalizeChild(requireRecord(definition.source, '/source'), 'mirror')
    const axis = definition.axis ?? 'x'
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') parameterError('/axis', 'axis must be x, y, or z.')
    const offset = definition.offset ?? 0
    if (typeof offset !== 'number' || !Number.isFinite(offset)) parameterError('/offset', 'offset must be a finite number in meters.')
    const includeOriginal = definition.includeOriginal ?? true
    if (typeof includeOriginal !== 'boolean') parameterError('/includeOriginal', 'includeOriginal must be boolean.')
    return {
      ...definition,
      source: source as unknown as GeometryJsonValue,
      axis,
      offset,
      includeOriginal,
    }
  },
  compile(definition, context) {
    const source = context.compileChild(requireRecord(definition.source, '/source'), 'mirror')
    const axis = definition.axis as 'x' | 'y' | 'z'
    const offset = definition.offset as number
    const includeOriginal = definition.includeOriginal as boolean
    const position: [number, number, number] = [0, 0, 0]
    const scale: [number, number, number] = [1, 1, 1]
    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    scale[axisIndex] = -1
    position[axisIndex] = offset * 2
    const mirrored = context.finalizeDraft(transformGeometryMesh(source, { position, rotation: [0, 0, 0], scale }))
    return includeOriginal ? mergeGeometryMeshes(source, mirrored) : mirrored
  },
}

function requireRecord(value: unknown, path: string): GeometryDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) parameterError(path, `${path.slice(1)} must be a geometry definition object.`)
  return value as GeometryDefinition
}
function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}
