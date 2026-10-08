import type {
  GeometryIssue,
  GeometrySafetyLimits,
  ScalarFieldDefinition,
  ScalarFieldInput,
  ScalarFieldResourceMap,
} from '../types/index.js'
import type { NormalizedScalarFieldDefinition } from './types.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'

export interface NormalizeScalarFieldOptions {
  limits?: Partial<GeometrySafetyLimits>
  fields?: ScalarFieldResourceMap
  path?: string
}

interface State {
  readonly limits: GeometrySafetyLimits
  readonly fields: ScalarFieldResourceMap
  readonly issues: GeometryIssue[]
  nodes: number
  readonly stack: string[]
}

const BINARY_KINDS = new Set(['add', 'multiply', 'min', 'max'])
const FIELD_KINDS = new Set(['constant', 'gradient', 'distance', 'radial', 'noise', 'add', 'multiply', 'min', 'max', 'invert', 'clamp'])

export function normalizeScalarField(input: ScalarFieldInput | unknown, options: NormalizeScalarFieldOptions = {}): NormalizedScalarFieldDefinition {
  const state: State = {
    limits: resolveGeometrySafetyLimits(options.limits),
    fields: options.fields ?? Object.freeze({}),
    issues: [],
    nodes: 0,
    stack: [],
  }
  const normalized = normalizeField(input, options.path ?? '/field', 0, state)
  if (state.issues.length > 0 || !normalized) throw new GeometryValidationError(state.issues)
  return normalized
}

function normalizeField(input: unknown, path: string, depth: number, state: State): NormalizedScalarFieldDefinition | undefined {
  state.nodes += 1
  if (state.nodes > state.limits.maxDefinitionNodes) {
    state.issues.push({ code: 'GEOMETRY_DEFINITION_LIMIT', path, message: `Scalar-field definition exceeds ${state.limits.maxDefinitionNodes} nodes.` })
    return undefined
  }
  if (depth > state.limits.maxDefinitionDepth) {
    state.issues.push({ code: 'GEOMETRY_DEFINITION_LIMIT', path, message: `Scalar-field definition exceeds maximum depth ${state.limits.maxDefinitionDepth}.` })
    return undefined
  }

  if (typeof input === 'string') {
    const id = input.trim()
    if (!id) {
      invalid(state, path, 'Scalar-field resource ids must be non-empty strings.')
      return undefined
    }
    const resource = state.fields[id]
    if (!resource) {
      invalid(state, path, `Unknown scalar-field resource "${id}".`)
      return undefined
    }
    if (state.stack.includes(id)) {
      invalid(state, path, `Scalar-field resource cycle detected: ${[...state.stack, id].join(' -> ')}.`)
      return undefined
    }
    state.stack.push(id)
    const normalized = normalizeField(resource, path, depth + 1, state)
    state.stack.pop()
    return normalized
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid(state, path, 'Scalar field must be a field definition object or named field resource id.')
    return undefined
  }
  const record = input as Record<string, unknown>
  const kind = record.kind
  if (typeof kind !== 'string' || !FIELD_KINDS.has(kind)) {
    invalid(state, `${path}/kind`, 'Scalar field kind must be constant, gradient, distance, radial, noise, add, multiply, min, max, invert, or clamp.')
    return undefined
  }

  if (kind === 'constant') {
    return { kind, value: finite(record.value, `${path}/value`, state) }
  }
  if (kind === 'gradient') {
    const origin = vec3(record.origin ?? [0, 0, 0], `${path}/origin`, state)
    const direction = normalizedDirection(record.direction ?? [0, 1, 0], `${path}/direction`, state)
    return { kind, origin, direction, scale: finite(record.scale ?? 1, `${path}/scale`, state), offset: finite(record.offset ?? 0, `${path}/offset`, state) }
  }
  if (kind === 'distance') {
    return { kind, point: vec3(record.point ?? [0, 0, 0], `${path}/point`, state), scale: finite(record.scale ?? 1, `${path}/scale`, state), offset: finite(record.offset ?? 0, `${path}/offset`, state) }
  }
  if (kind === 'radial') {
    return { kind, center: vec3(record.center ?? [0, 0, 0], `${path}/center`, state), radius: positive(record.radius ?? 1, `${path}/radius`, state) }
  }
  if (kind === 'noise') {
    return {
      kind,
      seed: integer(record.seed ?? 0, `${path}/seed`, -0x8000_0000, 0x7fff_ffff, state),
      frequency: positive(record.frequency ?? 1, `${path}/frequency`, state),
      octaves: integer(record.octaves ?? 1, `${path}/octaves`, 1, 16, state),
      lacunarity: positive(record.lacunarity ?? 2, `${path}/lacunarity`, state),
      persistence: bounded(record.persistence ?? 0.5, `${path}/persistence`, 0, 1, state),
      offset: vec3(record.offset ?? [0, 0, 0], `${path}/offset`, state),
    }
  }
  if (BINARY_KINDS.has(kind)) {
    const fields = record.fields
    if (!Array.isArray(fields) || fields.length < 2) {
      invalid(state, `${path}/fields`, `${kind}.fields must contain at least two scalar fields.`)
      return { kind, fields: [] } as NormalizedScalarFieldDefinition
    }
    const normalized = fields.map((field, index) => normalizeField(field, `${path}/fields/${index}`, depth + 1, state)).filter(Boolean) as NormalizedScalarFieldDefinition[]
    return { kind, fields: normalized } as NormalizedScalarFieldDefinition
  }
  if (kind === 'invert') {
    const field = normalizeField(record.field, `${path}/field`, depth + 1, state)
    return { kind, field: field ?? { kind: 'constant', value: 0 } } as NormalizedScalarFieldDefinition
  }

  const field = normalizeField(record.field, `${path}/field`, depth + 1, state)
  const min = finite(record.min ?? 0, `${path}/min`, state)
  const max = finite(record.max ?? 1, `${path}/max`, state)
  if (min > max) invalid(state, path, 'clamp.min must be less than or equal to clamp.max.')
  return { kind: 'clamp', field: field ?? { kind: 'constant', value: 0 }, min, max } as NormalizedScalarFieldDefinition
}

function invalid(state: State, path: string, message: string): void {
  state.issues.push({ code: 'GEOMETRY_PARAMETER_INVALID', path, message })
}
function finite(value: unknown, path: string, state: State): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) { invalid(state, path, `${path.split('/').at(-1)} must be a finite number.`); return 0 }
  return Object.is(value, -0) ? 0 : value
}
function positive(value: unknown, path: string, state: State): number {
  const result = finite(value, path, state)
  if (result <= 0) invalid(state, path, `${path.split('/').at(-1)} must be greater than zero.`)
  return result
}
function bounded(value: unknown, path: string, min: number, max: number, state: State): number {
  const result = finite(value, path, state)
  if (result < min || result > max) invalid(state, path, `${path.split('/').at(-1)} must be from ${min} to ${max}.`)
  return result
}
function integer(value: unknown, path: string, min: number, max: number, state: State): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    invalid(state, path, `${path.split('/').at(-1)} must be a safe integer from ${min} to ${max}.`)
    return min
  }
  return value
}
function vec3(value: unknown, path: string, state: State): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    invalid(state, path, `${path.split('/').at(-1)} must be three finite numbers.`)
    return [0, 0, 0]
  }
  return value.map((item) => Object.is(item, -0) ? 0 : item) as [number, number, number]
}
function normalizedDirection(value: unknown, path: string, state: State): [number, number, number] {
  const input = vec3(value, path, state)
  const length = Math.hypot(input[0], input[1], input[2])
  if (!(length > 0)) { invalid(state, path, 'gradient.direction must have non-zero length.'); return [0, 1, 0] }
  return [input[0] / length, input[1] / length, input[2] / length]
}
