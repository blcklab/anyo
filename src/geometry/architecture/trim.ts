import type { ArchitecturePart, TrimArchitectureDefinition } from './types.js'
import type { ProfileDefinition } from '../types/index.js'
import { finitePositive, freezeArray, transform } from './utils.js'

export function lowerTrim(input: TrimArchitectureDefinition) {
  let profile: ProfileDefinition
  if (input.profile) profile = input.profile
  else {
    const width = finitePositive(input.width ?? .08, '/width', 'width')
    const depth = finitePositive(input.depth ?? .02, '/depth', 'depth')
    profile = { points: [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]] }
  }
  const part: ArchitecturePart = Object.freeze({
    id: `${input.id ?? 'trim'}:sweep`, role: 'trim',
    geometry: { kind: 'sweep', profile, path: input.path, cap: true, ...(input.up ? { up: input.up } : {}) },
    transform: transform(),
  })
  return { parts: freezeArray([part]), instanceGroups: Object.freeze([]), anchors: Object.freeze([]) }
}
