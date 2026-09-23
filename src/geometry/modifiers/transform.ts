import type { GeometryDefinition, GeometryIssue, GeometryJsonValue } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { GeometryValidationError } from '../validation/errors.js'
import { transformGeometryMesh } from './meshTransform.js'

export const transformGeometryKind: GeometryKindCompiler = {
  kind: 'transform',
  normalize(definition, context) {
    const source = context.normalizeChild(requireRecord(definition.source, '/source'), 'transform')
    const position = vec3(definition.position ?? [0, 0, 0], '/position', true)
    const rotation = vec3(definition.rotation ?? [0, 0, 0], '/rotation', true)
    const scale = vec3(definition.scale ?? [1, 1, 1], '/scale', false)
    return {
      ...definition,
      source: source as unknown as GeometryJsonValue,
      position,
      rotation,
      scale,
    }
  },
  compile(definition, context) {
    const source = context.compileChild(requireRecord(definition.source, '/source'), 'transform')
    return transformGeometryMesh(source, {
      position: definition.position as [number, number, number],
      rotation: definition.rotation as [number, number, number],
      scale: definition.scale as [number, number, number],
    })
  },
}

function vec3(input: unknown, path: string, allowZero: boolean): [number, number, number] {
  if (!Array.isArray(input) || input.length !== 3 || input.some(value => typeof value !== 'number' || !Number.isFinite(value) || (!allowZero && value === 0))) {
    parameterError(path, `${path.slice(1)} must be three finite${allowZero ? '' : ' non-zero'} numbers.`)
  }
  return [input[0] as number, input[1] as number, input[2] as number]
}
function requireRecord(value: unknown, path: string): GeometryDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) parameterError(path, `${path.slice(1)} must be a geometry definition object.`)
  return value as GeometryDefinition
}
function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}
