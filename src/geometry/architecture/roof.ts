import type { ArchitecturePart, RoofArchitectureDefinition } from './types.js'
import { add3, architectureError, finiteNonNegative, finitePositive, freezeArray, geometryBox, rotateY, transform, vec2Positive, vec3 } from './utils.js'

export function lowerRoof(input: RoofArchitectureDefinition) {
  const [width, depth] = vec2Positive(input.size, '/size')
  const thickness = finitePositive(input.thickness, '/thickness', 'thickness')
  const pitch = input.pitch
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 0 || pitch >= Math.PI / 2 - 1e-4) architectureError('ARCHITECTURE_INVALID', '/pitch', 'pitch must be finite radians between 0 and pi/2.')
  const origin = vec3(input.position, '/position')
  const yaw = input.rotationY ?? 0
  if (!Number.isFinite(yaw)) architectureError('ARCHITECTURE_INVALID', '/rotationY', 'rotationY must be finite radians.')
  const bevel = finiteNonNegative(input.bevel ?? 0, '/bevel', 'bevel')
  const kind = input.kind ?? 'gable'
  const parts: ArchitecturePart[] = []
  if (kind === 'shed') {
    const slopeLength = width / Math.cos(pitch), rise = Math.tan(pitch) * width
    const local: [number, number, number] = [0, rise / 2, 0]
    parts.push(Object.freeze({
      id: `${input.id ?? 'roof'}:panel:0`, role: 'roof:panel',
      geometry: geometryBox([slopeLength, thickness, depth], Math.min(bevel, thickness / 2 - 1e-8), input.bevelSegments),
      transform: transform(add3(origin, rotateY(local, yaw)), [0, yaw, pitch]),
    }))
  } else if (kind === 'gable') {
    const half = width / 2, slopeLength = half / Math.cos(pitch), rise = Math.tan(pitch) * half
    for (const side of [-1, 1] as const) {
      const local: [number, number, number] = [side * width / 4, rise / 2, 0]
      parts.push(Object.freeze({
        id: `${input.id ?? 'roof'}:panel:${side < 0 ? 0 : 1}`, role: 'roof:panel',
        geometry: geometryBox([slopeLength, thickness, depth], Math.min(bevel, thickness / 2 - 1e-8), input.bevelSegments),
        transform: transform(add3(origin, rotateY(local, yaw)), [0, yaw, side < 0 ? pitch : -pitch]),
      }))
    }
  } else architectureError('ARCHITECTURE_INVALID', '/kind', 'roof.kind must be "gable" or "shed".')
  return {
    parts: freezeArray(parts), instanceGroups: Object.freeze([]),
    anchors: freezeArray([{ name: 'center', position: Object.freeze([...origin]) }]),
  }
}
