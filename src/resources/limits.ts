import type { ResourceGraphLimits } from './types.js'

export const DEFAULT_RESOURCE_GRAPH_LIMITS: Readonly<ResourceGraphLimits> = Object.freeze({
  maxResources: 200_000,
  maxEdges: 500_000,
  maxInstances: 100_000,
})

export function resolveResourceGraphLimits(overrides: Partial<ResourceGraphLimits> = {}): ResourceGraphLimits {
  const merged = { ...DEFAULT_RESOURCE_GRAPH_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`)
  }
  return merged
}
