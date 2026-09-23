import type {
  GeometryArrayDefinition,
  GeometryArrayLayout,
  GeometryArrayPlacement,
  GeometryDefinition,
  GeometryIssue,
  GeometrySafetyLimits,
} from '../types/index.js'
import { normalizeGeometryDefinition } from '../core/normalizeGeometry.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'

export interface GeometryArrayOptions {
  limits?: Partial<GeometrySafetyLimits>
}

export function layoutGeometryArray(input: GeometryArrayDefinition, options: GeometryArrayOptions = {}): GeometryArrayLayout {
  const limits = resolveGeometrySafetyLimits(options.limits)
  if (!input || typeof input !== 'object' || Array.isArray(input)) parameterError('', 'Array modifier must be a plain object.')
  const source = normalizeGeometryDefinition(input.source, { limits })
  const count = input.count
  if (!Number.isSafeInteger(count) || count <= 0) parameterError('/count', 'count must be a positive safe integer.')
  if (count > limits.maxGeneratedInstances) {
    throw new GeometryValidationError([{ code: 'GEOMETRY_INSTANCE_LIMIT', path: '/count', message: `Array requests ${count} instances, above maxGeneratedInstances ${limits.maxGeneratedInstances}.`, suggestion: 'Reduce count or split the array into bounded groups.' }])
  }
  const offset = vec3(input.offset, '/offset', true)
  const position = vec3(input.position ?? [0, 0, 0], '/position', true)
  const rotation = vec3(input.rotation ?? [0, 0, 0], '/rotation', true)
  const rotationOffset = vec3(input.rotationOffset ?? [0, 0, 0], '/rotationOffset', true)
  const scale = vec3(input.scale ?? [1, 1, 1], '/scale', false)
  const placements: GeometryArrayPlacement[] = []
  for (let index = 0; index < count; index += 1) {
    placements.push(Object.freeze({
      index,
      position: Object.freeze([
        position[0] + offset[0] * index,
        position[1] + offset[1] * index,
        position[2] + offset[2] * index,
      ]) as readonly [number, number, number],
      rotation: Object.freeze([
        rotation[0] + rotationOffset[0] * index,
        rotation[1] + rotationOffset[1] * index,
        rotation[2] + rotationOffset[2] * index,
      ]) as readonly [number, number, number],
      scale: Object.freeze([...scale]) as readonly [number, number, number],
    }))
  }
  return Object.freeze({ source, placements: Object.freeze(placements) })
}

function vec3(input: unknown, path: string, allowZero: boolean): [number, number, number] {
  if (!Array.isArray(input) || input.length !== 3 || input.some(value => typeof value !== 'number' || !Number.isFinite(value) || (!allowZero && value === 0))) {
    parameterError(path, `${path.slice(1)} must be three finite${allowZero ? '' : ' non-zero'} numbers.`)
  }
  return [input[0] as number, input[1] as number, input[2] as number]
}
function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}
