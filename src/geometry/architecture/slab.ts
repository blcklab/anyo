import type { ArchitecturePart, PanelArchitectureDefinition, SlabArchitectureDefinition } from './types.js'
import { finiteNonNegative, finitePositive, freezeArray, geometryBox, transform, vec2Positive, vec3 } from './utils.js'

export function lowerSlab(input: SlabArchitectureDefinition) {
  const size = vec2Positive(input.size, '/size')
  const thickness = finitePositive(input.thickness, '/thickness', 'thickness')
  const position = vec3(input.position, '/position')
  const rotation = vec3(input.rotation, '/rotation')
  const bevel = finiteNonNegative(input.bevel ?? 0, '/bevel', 'bevel')
  const radius = Math.min(bevel, Math.max(0, Math.min(size[0], thickness, size[1]) / 2 - 1e-8))
  const part: ArchitecturePart = Object.freeze({
    id: `${input.id ?? input.type}:surface`, role: input.type,
    geometry: geometryBox([size[0], thickness, size[1]], radius, input.bevelSegments),
    transform: transform(position, rotation),
  })
  const halfY = thickness / 2
  return {
    parts: freezeArray([part]), instanceGroups: Object.freeze([]),
    anchors: freezeArray([
      { name: 'center', position: Object.freeze([...position]) },
      { name: 'top', position: Object.freeze([position[0], position[1] + halfY, position[2]]) },
      { name: 'bottom', position: Object.freeze([position[0], position[1] - halfY, position[2]]) },
    ]),
  }
}

export function lowerPanel(input: PanelArchitectureDefinition) {
  const size = vec2Positive(input.size, '/size')
  const thickness = finitePositive(input.thickness, '/thickness', 'thickness')
  const position = vec3(input.position, '/position')
  const rotation = vec3(input.rotation, '/rotation')
  const bevel = finiteNonNegative(input.bevel ?? 0, '/bevel', 'bevel')
  const radius = Math.min(bevel, Math.max(0, Math.min(size[0], size[1], thickness) / 2 - 1e-8))
  const part: ArchitecturePart = Object.freeze({
    id: `${input.id ?? 'panel'}:surface`, role: 'panel',
    geometry: geometryBox([size[0], size[1], thickness], radius, input.bevelSegments),
    transform: transform(position, rotation),
  })
  return { parts: freezeArray([part]), instanceGroups: Object.freeze([]), anchors: freezeArray([{ name: 'center', position: Object.freeze([...position]) }]) }
}
