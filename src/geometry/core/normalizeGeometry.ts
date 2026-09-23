import type { GeometryDefinition, GeometryInspectionResult, GeometryIssue, GeometryJsonValue, GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'

const KIND_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/
const QUALITY = new Set(['low', 'medium', 'high', 'ultra'])

function pointer(path: string, key: string | number): string {
  const escaped = String(key).replaceAll('~', '~0').replaceAll('/', '~1')
  return `${path}/${escaped}`
}

function normalizeValue(
  input: unknown,
  path: string,
  depth: number,
  state: { nodes: number; limits: GeometrySafetyLimits; issues: GeometryIssue[] },
): GeometryJsonValue | undefined {
  state.nodes += 1
  if (state.nodes > state.limits.maxDefinitionNodes) {
    state.issues.push({ code: 'GEOMETRY_DEFINITION_LIMIT', path, message: `Geometry definition exceeds ${state.limits.maxDefinitionNodes} nodes.` })
    return undefined
  }
  if (depth > state.limits.maxDefinitionDepth) {
    state.issues.push({ code: 'GEOMETRY_DEFINITION_LIMIT', path, message: `Geometry definition exceeds maximum depth ${state.limits.maxDefinitionDepth}.` })
    return undefined
  }
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      state.issues.push({ code: 'GEOMETRY_NON_FINITE_NUMBER', path, message: 'Geometry definitions may not contain NaN or Infinity.' })
      return undefined
    }
    return Object.is(input, -0) ? 0 : input
  }
  if (input === undefined) return undefined
  if (Array.isArray(input)) {
    const output: GeometryJsonValue[] = []
    for (let index = 0; index < input.length; index += 1) {
      const normalized = normalizeValue(input[index], pointer(path, index), depth + 1, state)
      if (normalized === undefined) {
        state.issues.push({ code: 'GEOMETRY_DEFINITION_INVALID', path: pointer(path, index), message: 'Geometry arrays may not contain undefined or unsupported values.' })
      } else {
        output.push(normalized)
      }
    }
    return output
  }
  if (typeof input === 'object') {
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      state.issues.push({ code: 'GEOMETRY_DEFINITION_INVALID', path, message: 'Geometry definition objects must be plain JSON objects.' })
      return undefined
    }
    const output: { [key: string]: GeometryJsonValue | undefined } = Object.create(null)
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      const value = normalizeValue((input as Record<string, unknown>)[key], pointer(path, key), depth + 1, state)
      if (value !== undefined) output[key] = value
    }
    return output
  }
  state.issues.push({ code: 'GEOMETRY_DEFINITION_INVALID', path, message: `Unsupported geometry value type: ${typeof input}.` })
  return undefined
}

export function inspectGeometryDefinition(
  input: unknown,
  options: { limits?: Partial<GeometrySafetyLimits> } = {},
): GeometryInspectionResult<GeometryDefinition> {
  const limits = resolveGeometrySafetyLimits(options.limits)
  const issues: GeometryIssue[] = []
  const state = { nodes: 0, limits, issues }
  const normalized = normalizeValue(input, '', 0, state)
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') {
    issues.push({ code: 'GEOMETRY_DEFINITION_INVALID', path: '', message: 'Geometry definition must be a JSON object.' })
    return { valid: false, issues }
  }
  const record = normalized as { [key: string]: GeometryJsonValue | undefined }
  const kind = record.kind
  if (typeof kind !== 'string' || !KIND_PATTERN.test(kind)) {
    issues.push({ code: 'GEOMETRY_KIND_INVALID', path: '/kind', message: 'Geometry kind must match /^[A-Za-z][A-Za-z0-9._-]*$/.' })
  }
  const quality = record.quality
  if (quality !== undefined && (typeof quality !== 'string' || !QUALITY.has(quality))) {
    issues.push({ code: 'GEOMETRY_DEFINITION_INVALID', path: '/quality', message: 'Geometry quality must be low, medium, high, or ultra.' })
  }
  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, value: record as GeometryDefinition, issues }
}

export function normalizeGeometryDefinition(
  input: unknown,
  options: { limits?: Partial<GeometrySafetyLimits> } = {},
): GeometryDefinition {
  const result = inspectGeometryDefinition(input, options)
  if (!result.valid || !result.value) throw new GeometryValidationError(result.issues)
  return result.value
}
