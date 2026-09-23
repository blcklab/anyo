import type { ArchitectureAssembly, ArchitectureDefinition } from './types.js'
import type { GeometrySafetyLimits } from '../types/index.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import { architectureError, freezeArray } from './utils.js'
import { lowerWall } from './wall.js'
import { lowerSlab, lowerPanel } from './slab.js'
import { lowerColumn, lowerBeam } from './structure.js'
import { lowerStairs } from './stairs.js'
import { lowerRailing } from './railing.js'
import { lowerTrim } from './trim.js'
import { lowerRoof } from './roof.js'
import { normalizeStandaloneDoorOpening, normalizeStandaloneWindowOpening, normalizeWallOpenings } from './openings.js'

export type * from './types.js'
export { normalizeWallOpenings, normalizeStandaloneDoorOpening, normalizeStandaloneWindowOpening }

export interface ArchitectureLowerOptions {
  limits?: Partial<GeometrySafetyLimits>
}

/**
 * Lower one semantic architectural definition into renderer-neutral geometry parts,
 * shared instance groups, and semantic anchors. This is a scoped construction IR;
 * it does not create GPU resources or mutate world state.
 */
export function lowerArchitecture(definition: ArchitectureDefinition, options: ArchitectureLowerOptions = {}): ArchitectureAssembly {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) architectureError('ARCHITECTURE_INVALID', '/', 'Architecture definition must be an object.')
  const limits = resolveGeometrySafetyLimits(options.limits)
  let result: { parts: readonly any[]; instanceGroups: readonly any[]; anchors: readonly any[] }
  switch (definition.type) {
    case 'wall': result = lowerWall(definition, limits); break
    case 'floor':
    case 'ceiling': result = lowerSlab(definition); break
    case 'panel': result = lowerPanel(definition); break
    case 'column': result = lowerColumn(definition); break
    case 'beam': result = lowerBeam(definition); break
    case 'stairs': result = lowerStairs(definition, limits); break
    case 'railing': result = lowerRailing(definition, limits); break
    case 'trim': result = lowerTrim(definition); break
    case 'roof': result = lowerRoof(definition); break
    case 'doorOpening': {
      const opening = normalizeStandaloneDoorOpening(definition)
      result = { parts: Object.freeze([]), instanceGroups: Object.freeze([]), anchors: freezeArray([{ name: 'opening:center', position: Object.freeze([0, opening.height / 2, 0]) }]) }
      break
    }
    case 'windowOpening': {
      const opening = normalizeStandaloneWindowOpening(definition)
      result = { parts: Object.freeze([]), instanceGroups: Object.freeze([]), anchors: freezeArray([{ name: 'opening:center', position: Object.freeze([0, opening.sillHeight + opening.height / 2, 0]) }]) }
      break
    }
    default: architectureError('ARCHITECTURE_INVALID', '/type', `Unsupported architecture type "${String((definition as { type?: unknown }).type)}".`)
  }
  return Object.freeze({
    type: definition.type,
    ...(definition.id ? { id: definition.id } : {}),
    parts: result.parts,
    instanceGroups: result.instanceGroups,
    anchors: result.anchors,
  }) as ArchitectureAssembly
}
