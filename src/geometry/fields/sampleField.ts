import type { ScalarFieldDefinition, ScalarFieldInput, ScalarFieldResourceMap } from '../types/index.js'
import type { NormalizedScalarFieldDefinition } from './types.js'
import { normalizeScalarField } from './normalizeField.js'
import { sampleGeometryNoise3 } from '../modifiers/noise.js'

/** Normalize once, then sample repeatedly in geometry hot paths. */
export function sampleNormalizedScalarField(field: NormalizedScalarFieldDefinition, position: readonly [number, number, number]): number {
  const x = position[0], y = position[1], z = position[2]
  switch (field.kind) {
    case 'constant': return field.value as number
    case 'gradient': {
      const origin = field.origin as [number, number, number]
      const direction = field.direction as [number, number, number]
      return ((x - origin[0]) * direction[0] + (y - origin[1]) * direction[1] + (z - origin[2]) * direction[2]) * (field.scale as number) + (field.offset as number)
    }
    case 'distance': {
      const point = field.point as [number, number, number]
      return Math.hypot(x - point[0], y - point[1], z - point[2]) * (field.scale as number) + (field.offset as number)
    }
    case 'radial': {
      const center = field.center as [number, number, number]
      const distance = Math.hypot(x - center[0], y - center[1], z - center[2])
      return 1 - Math.min(1, distance / (field.radius as number))
    }
    case 'noise': {
      const offset = field.offset as [number, number, number]
      const frequency = field.frequency as number
      return sampleGeometryNoise3(x * frequency + offset[0], y * frequency + offset[1], z * frequency + offset[2], {
        seed: field.seed as number,
        octaves: field.octaves as number,
        lacunarity: field.lacunarity as number,
        persistence: field.persistence as number,
      })
    }
    case 'add': return (field.fields as NormalizedScalarFieldDefinition[]).reduce((sum, child) => sum + sampleNormalizedScalarField(child, position), 0)
    case 'multiply': return (field.fields as NormalizedScalarFieldDefinition[]).reduce((product, child) => product * sampleNormalizedScalarField(child, position), 1)
    case 'min': return Math.min(...(field.fields as NormalizedScalarFieldDefinition[]).map((child) => sampleNormalizedScalarField(child, position)))
    case 'max': return Math.max(...(field.fields as NormalizedScalarFieldDefinition[]).map((child) => sampleNormalizedScalarField(child, position)))
    case 'invert': return 1 - sampleNormalizedScalarField(field.field as NormalizedScalarFieldDefinition, position)
    case 'clamp': return Math.min(field.max as number, Math.max(field.min as number, sampleNormalizedScalarField(field.field as NormalizedScalarFieldDefinition, position)))
    default: return 0
  }
}

/** Public convenience API for one-off sampling of inline or named fields. */
export function sampleScalarField(
  input: ScalarFieldInput | ScalarFieldDefinition,
  position: readonly [number, number, number],
  options: { fields?: ScalarFieldResourceMap; path?: string } = {},
): number {
  if (position.length !== 3 || position.some((value) => !Number.isFinite(value))) throw new Error('Scalar-field sample position must contain three finite numbers.')
  return sampleNormalizedScalarField(normalizeScalarField(input, options), position)
}
