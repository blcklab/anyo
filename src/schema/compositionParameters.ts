import type {
  CompositionDefinition,
  CompositionParameterDefinition,
  CompositionParameterType,
  CompositionParameterValue,
} from '../core/types.js'

export const COMPOSITION_PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/
export const COMPOSITION_PARAMETER_TYPES = new Set<CompositionParameterType>([
  'string', 'number', 'boolean', 'vec2', 'vec3', 'material', 'asset',
])

function isFiniteTuple(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

export function isCompositionParameterValue(type: CompositionParameterType, value: unknown): value is CompositionParameterValue {
  switch (type) {
    case 'string':
    case 'material':
    case 'asset':
      return typeof value === 'string' && (type === 'string' || value.length > 0)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'vec2':
      return isFiniteTuple(value, 2)
    case 'vec3':
      return isFiniteTuple(value, 3)
  }
}

export function mergeCompositionParameters(
  base: Record<string, CompositionParameterDefinition> | undefined,
  own: Record<string, CompositionParameterDefinition> | undefined,
): Record<string, CompositionParameterDefinition> | undefined {
  if (!base && !own) return undefined
  return { ...(base ? structuredClone(base) : {}), ...(own ? structuredClone(own) : {}) }
}


export function resolveCompositionParameterDefinitions(
  id: string,
  compositions: Record<string, CompositionDefinition> | undefined,
  stack: string[] = [],
): Record<string, CompositionParameterDefinition> | undefined {
  if (!compositions || stack.includes(id)) return undefined
  const composition = compositions[id]
  if (!composition) return undefined
  const base = composition.extends
    ? resolveCompositionParameterDefinitions(composition.extends, compositions, [...stack, id])
    : undefined
  return mergeCompositionParameters(base, composition.parameters)
}
