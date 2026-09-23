import type { ArchitectureAnchor, ArchitecturePart, WallArchitectureDefinition } from './types.js'
import type { GeometrySafetyLimits } from '../types/index.js'
import { normalizeWallOpenings } from './openings.js'
import { add3, anchor, architectureError, finiteNonNegative, finitePositive, freezeArray, geometryBox, horizontalYaw, rotateY, transform, vec3 } from './utils.js'

export function lowerWall(input: WallArchitectureDefinition, limits: GeometrySafetyLimits) {
  const from = vec3(input.from, '/from')
  const to = vec3(input.to, '/to')
  const span = horizontalYaw(from, to)
  const height = finitePositive(input.height, '/height', 'height')
  const thickness = finitePositive(input.thickness, '/thickness', 'thickness')
  const bevel = finiteNonNegative(input.bevel ?? 0, '/bevel', 'bevel')
  const bevelSegments = input.bevelSegments
  if (bevelSegments !== undefined && (!Number.isSafeInteger(bevelSegments) || bevelSegments < 1 || bevelSegments > limits.maxCurveSegments)) architectureError('ARCHITECTURE_INVALID', '/bevelSegments', `bevelSegments must be a safe integer from 1 to ${limits.maxCurveSegments}.`)
  const openings = normalizeWallOpenings(input.openings, span.length, height)
  const cuts = uniqueSorted([0, span.length, ...openings.flatMap(opening => [opening.x0, opening.x1])])
  const parts: ArchitecturePart[] = []
  let partIndex = 0
  for (let cut = 0; cut < cuts.length - 1; cut += 1) {
    const x0 = cuts[cut]!, x1 = cuts[cut + 1]!
    if (x1 - x0 <= 1e-8) continue
    const midpoint = (x0 + x1) / 2
    const voids = openings.filter(opening => midpoint > opening.x0 + 1e-8 && midpoint < opening.x1 - 1e-8).map(opening => [opening.y0, opening.y1] as [number, number]).sort((a, b) => a[0] - b[0])
    let cursor = 0
    for (const [y0, y1] of [...voids, [height, height] as [number, number]]) {
      if (y0 - cursor > 1e-8) parts.push(wallSolid(input.id, partIndex++, from, span.yaw, x0, x1, cursor, y0, thickness, bevel, bevelSegments))
      cursor = Math.max(cursor, y1)
    }
  }
  if (parts.length > limits.maxGeneratedInstances) architectureError('ARCHITECTURE_LIMIT', '/openings', `Wall lowering generated ${parts.length} solid parts, above maxGeneratedInstances ${limits.maxGeneratedInstances}.`, 'Reduce opening fragmentation or increase the explicit generation safety limit.')

  const anchors: ArchitectureAnchor[] = [
    anchor('left', from, [0, span.yaw, 0]),
    anchor('right', to, [0, span.yaw, 0]),
    anchor('center', [(from[0] + to[0]) / 2, from[1] + height / 2, (from[2] + to[2]) / 2], [0, span.yaw, 0]),
    anchor('top', [(from[0] + to[0]) / 2, from[1] + height, (from[2] + to[2]) / 2], [0, span.yaw, 0]),
    anchor('bottom', [(from[0] + to[0]) / 2, from[1], (from[2] + to[2]) / 2], [0, span.yaw, 0]),
  ]
  openings.forEach((opening, index) => {
    const local: [number, number, number] = [(opening.x0 + opening.x1) / 2, (opening.y0 + opening.y1) / 2, 0]
    const world = add3(from, rotateY(local, span.yaw))
    anchors.push(anchor(`opening:${opening.id ?? index}:center`, world, [0, span.yaw, 0]))
  })
  return { parts: freezeArray(parts), instanceGroups: Object.freeze([]), anchors: freezeArray(anchors) }
}

function wallSolid(
  wallId: string | undefined,
  index: number,
  from: [number, number, number],
  yaw: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  thickness: number,
  bevel: number,
  bevelSegments: number | undefined,
): ArchitecturePart {
  const width = x1 - x0, height = y1 - y0
  const maxRadius = Math.min(width, height, thickness) / 2 - 1e-8
  const radius = Math.min(bevel, Math.max(0, maxRadius))
  const localCenter: [number, number, number] = [(x0 + x1) / 2, (y0 + y1) / 2, 0]
  return Object.freeze({
    id: `${wallId ?? 'wall'}:solid:${index}`,
    role: 'wall:solid',
    geometry: geometryBox([width, height, thickness], radius, bevelSegments),
    transform: transform(add3(from, rotateY(localCenter, yaw)), [0, yaw, 0]),
  })
}

function uniqueSorted(values: number[]): number[] {
  const sorted = values.slice().sort((a, b) => a - b)
  const result: number[] = []
  for (const value of sorted) if (!result.length || Math.abs(value - result[result.length - 1]!) > 1e-8) result.push(value)
  return result
}
