import type { AssetDefinition, JsonValue, MaterialDefinition, NormalizedMaterialDefinition } from '../core/types.js'
import { normalizeMaterialDefinition } from '../core/visualContract.js'
import { canonicalResourceValue } from './hash.js'
import { resourceError } from './errors.js'
import type { ResourceFrame, ResourceId, ResourceTransform } from './types.js'

function finiteTuple(input: unknown, fallback: readonly [number, number, number], path: string): readonly [number, number, number] {
  const value = input ?? fallback
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    resourceError({ code: 'RESOURCE_INVALID', path, message: 'Expected a finite 3-number tuple.' })
  }
  return Object.freeze(value.map((item) => Object.is(item, -0) ? 0 : item) as [number, number, number])
}

export function normalizeResourceTransform(input: Partial<ResourceTransform> = {}): ResourceTransform {
  return Object.freeze({
    position: finiteTuple(input.position, [0, 0, 0], '/transform/position'),
    rotation: finiteTuple(input.rotation, [0, 0, 0], '/transform/rotation'),
    scale: finiteTuple(input.scale, [1, 1, 1], '/transform/scale'),
  })
}

export function normalizeMaterialResourceDefinition(definition: MaterialDefinition = {}): NormalizedMaterialDefinition {
  const normalized = normalizeMaterialDefinition(definition)
  return canonicalResourceValue(normalized) as unknown as NormalizedMaterialDefinition
}

export function normalizeAssetResourceDefinition(definition: AssetDefinition): AssetDefinition {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    resourceError({ code: 'RESOURCE_INVALID', path: '/asset', message: 'Asset definition must be a JSON object.' })
  }
  if (!('src' in definition)) {
    resourceError({ code: 'RESOURCE_INVALID', path: '/asset/src', message: 'Asset definition requires src.' })
  }
  try {
    return canonicalResourceValue(definition) as unknown as AssetDefinition
  } catch (error) {
    resourceError({
      code: 'RESOURCE_INVALID',
      path: '/asset',
      message: error instanceof Error ? error.message : 'Asset definition is not canonical JSON.',
      suggestion: 'Keep asset metadata JSON-safe and move runtime objects outside the resource definition.',
    })
  }
}

export function normalizeResourceMetadata(metadata: Readonly<Record<string, JsonValue>> | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (metadata === undefined) return undefined
  try {
    return Object.freeze(canonicalResourceValue(metadata) as Record<string, JsonValue>)
  } catch (error) {
    resourceError({ code: 'RESOURCE_INVALID', path: '/metadata', message: error instanceof Error ? error.message : 'Invalid resource metadata.' })
  }
}


export function normalizeResourceMaterialBindings(input: Readonly<Record<string, ResourceId>> | undefined): Readonly<Record<string, ResourceId>> | undefined {
  if (input === undefined) return undefined
  const output: Record<string, ResourceId> = {}
  for (const [name, id] of Object.entries(input)) {
    if (!name || typeof id !== 'string' || !id) resourceError({ code: 'RESOURCE_INVALID', path: `/materialBindings/${name}`, message: 'Material bindings require a non-empty semantic group name and material resource id.' })
    output[name] = id
  }
  const normalized = canonicalResourceValue(output) as Record<string, ResourceId>
  return Object.freeze(normalized)
}

export function normalizeResourceFrame(input: ResourceFrame | undefined): ResourceFrame | undefined {
  if (!input) return undefined
  return Object.freeze({
    tangent: finiteTuple(input.tangent, [0, 0, 1], '/frame/tangent'),
    normal: finiteTuple(input.normal, [1, 0, 0], '/frame/normal'),
    binormal: finiteTuple(input.binormal, [0, 1, 0], '/frame/binormal'),
  })
}
