import type { ArchitecturePart, BeamArchitectureDefinition, ColumnArchitectureDefinition } from './types.js'
import { add3, anchor, finiteNonNegative, finitePositive, freezeArray, geometryBox, horizontalYaw, rotateY, transform, vec2Positive, vec3 } from './utils.js'

export function lowerColumn(input: ColumnArchitectureDefinition) {
  const position = vec3(input.position, '/position')
  const height = finitePositive(input.height, '/height', 'height')
  const shape = input.shape ?? 'rect'
  const center: [number, number, number] = [position[0], position[1] + height / 2, position[2]]
  let geometry
  if (shape === 'round') {
    const radius = finitePositive(input.radius ?? .15, '/radius', 'radius')
    geometry = { kind: 'cylinder', radius, height, segments: input.segments ?? 24 } as const
  } else {
    const size = vec2Positive(input.size ?? [.3, .3], '/size')
    const bevel = finiteNonNegative(input.bevel ?? 0, '/bevel', 'bevel')
    const radius = Math.min(bevel, Math.max(0, Math.min(size[0], size[1], height) / 2 - 1e-8))
    geometry = geometryBox([size[0], height, size[1]], radius, input.bevelSegments)
  }
  const part: ArchitecturePart = Object.freeze({ id: `${input.id ?? 'column'}:body`, role: 'column', geometry, transform: transform(center) })
  return {
    parts: freezeArray([part]), instanceGroups: Object.freeze([]),
    anchors: freezeArray([anchor('base', position), anchor('center', center), anchor('top', [position[0], position[1] + height, position[2]])]),
  }
}

export function lowerBeam(input: BeamArchitectureDefinition) {
  const from = vec3(input.from, '/from'), to = vec3(input.to, '/to')
  const span = horizontalYaw(from, to)
  const height = finitePositive(input.height, '/height', 'height'), depth = finitePositive(input.depth, '/depth', 'depth')
  const bevel = finiteNonNegative(input.bevel ?? 0, '/bevel', 'bevel')
  const radius = Math.min(bevel, Math.max(0, Math.min(span.length, height, depth) / 2 - 1e-8))
  const midpoint: [number, number, number] = [(from[0] + to[0]) / 2, from[1], (from[2] + to[2]) / 2]
  const part: ArchitecturePart = Object.freeze({
    id: `${input.id ?? 'beam'}:body`, role: 'beam',
    geometry: geometryBox([span.length, height, depth], radius, input.bevelSegments),
    transform: transform(midpoint, [0, span.yaw, 0]),
  })
  return { parts: freezeArray([part]), instanceGroups: Object.freeze([]), anchors: freezeArray([anchor('start', from, [0, span.yaw, 0]), anchor('center', midpoint, [0, span.yaw, 0]), anchor('end', to, [0, span.yaw, 0])]) }
}
