import type {
  GeometryDefinition,
  GeometryIssue,
  GeometryJsonValue,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryOperator,
  GeometryTransformOperator,
} from '../types/index.js'
import type { GeometryKindCompiler, GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import { GeometryValidationError } from '../validation/errors.js'
import { transformGeometryMesh } from './meshTransform.js'

export const transformGeometryKind: GeometryKindCompiler = {
  kind: 'transform',
  normalize(definition, context) {
    const source = context.normalizeChild(requireRecord(definition.source, '/source'), 'transform')
    const operator = normalizeTransformOperator(definition)
    return {
      ...definition,
      source: source as unknown as GeometryJsonValue,
      position: operator.position,
      rotation: operator.rotation,
      scale: operator.scale,
    }
  },
  compile(definition, context) {
    const source = context.compileChild(requireRecord(definition.source, '/source'), 'transform')
    return applyTransformOperator(source, definition)
  },
}

export const transformGeometryOperator: GeometryOperatorCompiler = {
  kind: 'transform',
  normalize(operator) {
    return normalizeTransformOperator(operator)
  },
  apply(mesh, operator) {
    return applyTransformOperator(mesh, operator)
  },
}

export function normalizeTransformOperator(input: GeometryOperator | GeometryDefinition): GeometryTransformOperator {
  return {
    kind: 'transform',
    position: vec3(input.position ?? [0, 0, 0], '/position', true),
    rotation: vec3(input.rotation ?? [0, 0, 0], '/rotation', true),
    scale: vec3(input.scale ?? [1, 1, 1], '/scale', false),
  }
}

export function applyTransformOperator(mesh: GeometryMesh, input: GeometryOperator | GeometryDefinition): GeometryMeshDraft {
  const operator = normalizeTransformOperator(input)
  return transformGeometryMesh(mesh, {
    position: operator.position!,
    rotation: operator.rotation!,
    scale: operator.scale!,
  })
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
