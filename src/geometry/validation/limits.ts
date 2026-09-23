import type { GeometrySafetyLimits } from '../types/index.js'

export const DEFAULT_GEOMETRY_SAFETY_LIMITS: Readonly<GeometrySafetyLimits> = Object.freeze({
  maxGeometryVertices: 500_000,
  maxGeometryIndices: 1_500_000,
  maxCurveSegments: 4_096,
  maxProfilePoints: 16_384,
  maxModifierDepth: 32,
  maxBooleanDepth: 12,
  maxGeneratedInstances: 100_000,
  maxDefinitionDepth: 64,
  maxDefinitionNodes: 100_000,
})

export function resolveGeometrySafetyLimits(overrides: Partial<GeometrySafetyLimits> = {}): GeometrySafetyLimits {
  const merged: GeometrySafetyLimits = { ...DEFAULT_GEOMETRY_SAFETY_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`)
  }
  return merged
}
