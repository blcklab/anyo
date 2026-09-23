import type { ArchitectureInstanceGroup, ArchitectureInstancePlacement, ArchitecturePart, StairArchitectureDefinition } from './types.js'
import type { GeometrySafetyLimits } from '../types/index.js'
import { add3, anchor, architectureError, finiteNonNegative, finitePositive, freezeArray, geometryBox, rotateY, transform, vec3 } from './utils.js'

export function lowerStairs(input: StairArchitectureDefinition, limits: GeometrySafetyLimits) {
  const width = finitePositive(input.width, '/width', 'width')
  const height = finitePositive(input.height, '/height', 'height')
  const depth = finitePositive(input.depth, '/depth', 'depth')
  const steps = input.steps
  if (!Number.isSafeInteger(steps) || steps < 1) architectureError('ARCHITECTURE_INVALID', '/steps', 'steps must be a positive safe integer.')
  const totalPlacements = steps * ((input.closedRisers ?? true) ? 2 : 1) + (input.landingDepth ? 1 : 0)
  if (totalPlacements > limits.maxGeneratedInstances) architectureError('ARCHITECTURE_LIMIT', '/steps', `Stairs would generate ${totalPlacements} placements, above maxGeneratedInstances ${limits.maxGeneratedInstances}.`)
  const origin = vec3(input.position, '/position')
  const yaw = input.rotationY ?? 0
  if (!Number.isFinite(yaw)) architectureError('ARCHITECTURE_INVALID', '/rotationY', 'rotationY must be finite radians.')
  const rise = height / steps, run = depth / steps
  const treadThickness = finitePositive(input.treadThickness ?? Math.min(.05, rise * .35), '/treadThickness', 'treadThickness')
  const riserThickness = finitePositive(input.riserThickness ?? Math.min(.03, run * .2), '/riserThickness', 'riserThickness')
  const bevel = finiteNonNegative(input.bevel ?? 0, '/bevel', 'bevel')
  const treadRadius = Math.min(bevel, Math.max(0, Math.min(width, treadThickness, run) / 2 - 1e-8))
  const riserRadius = Math.min(bevel, Math.max(0, Math.min(width, rise, riserThickness) / 2 - 1e-8))
  const treads: ArchitectureInstancePlacement[] = [], risers: ArchitectureInstancePlacement[] = []
  for (let index = 0; index < steps; index += 1) {
    treads.push(placement(index, origin, yaw, [0, (index + 1) * rise - treadThickness / 2, (index + .5) * run]))
    if (input.closedRisers ?? true) risers.push(placement(index, origin, yaw, [0, index * rise + rise / 2, index * run + riserThickness / 2]))
  }
  const groups: ArchitectureInstanceGroup[] = [Object.freeze({
    id: `${input.id ?? 'stairs'}:treads`, role: 'stairs:tread',
    geometry: geometryBox([width, treadThickness, run], treadRadius, input.bevelSegments), placements: freezeArray(treads),
  })]
  if (risers.length) groups.push(Object.freeze({
    id: `${input.id ?? 'stairs'}:risers`, role: 'stairs:riser',
    geometry: geometryBox([width, rise, riserThickness], riserRadius, input.bevelSegments), placements: freezeArray(risers),
  }))
  const parts: ArchitecturePart[] = []
  const landingDepth = input.landingDepth ?? 0
  if (landingDepth) {
    finitePositive(landingDepth, '/landingDepth', 'landingDepth')
    const local: [number, number, number] = [0, height - treadThickness / 2, depth + landingDepth / 2]
    parts.push(Object.freeze({
      id: `${input.id ?? 'stairs'}:landing`, role: 'stairs:landing', geometry: geometryBox([width, treadThickness, landingDepth], treadRadius, input.bevelSegments),
      transform: transform(add3(origin, rotateY(local, yaw)), [0, yaw, 0]),
    }))
  }
  return {
    parts: freezeArray(parts), instanceGroups: freezeArray(groups),
    anchors: freezeArray([
      anchor('bottom', origin, [0, yaw, 0]),
      anchor('top', add3(origin, rotateY([0, height, depth], yaw)), [0, yaw, 0]),
      anchor('center', add3(origin, rotateY([0, height / 2, depth / 2], yaw)), [0, yaw, 0]),
    ]),
  }
}

function placement(index: number, origin: [number, number, number], yaw: number, local: [number, number, number]): ArchitectureInstancePlacement {
  return Object.freeze({ index, position: Object.freeze(add3(origin, rotateY(local, yaw))), rotation: Object.freeze([0, yaw, 0]) as readonly [number, number, number], scale: Object.freeze([1, 1, 1]) as readonly [number, number, number] })
}
