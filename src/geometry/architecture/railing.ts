import type { ArchitectureInstanceGroup, ArchitectureInstancePlacement, ArchitecturePart, RailingArchitectureDefinition } from './types.js'
import type { CurveDefinition, GeometrySafetyLimits, ProfileDefinition } from '../types/index.js'
import { normalizeCurve, sampleCurve } from '../curves/index.js'
import { layoutPathArray } from '../path-array/index.js'
import { architectureError, finitePositive, freezeArray, transform } from './utils.js'

export function lowerRailing(input: RailingArchitectureDefinition, limits: GeometrySafetyLimits) {
  const height = finitePositive(input.height, '/height', 'height')
  const railRadius = finitePositive(input.railRadius ?? .03, '/railRadius', 'railRadius')
  const railSegments = input.railSegments ?? 16
  if (!Number.isSafeInteger(railSegments) || railSegments < 3 || railSegments > limits.maxCurveSegments) architectureError('ARCHITECTURE_INVALID', '/railSegments', `railSegments must be an integer from 3 to ${limits.maxCurveSegments}.`)
  const path = normalizeCurve(input.path, { limits, path: '/path' })
  const sampled = sampleCurve(path, { limits, path: '/path' })
  const profile = circleProfile(railRadius, railSegments)
  const topPath = shiftedPath(path as CurveDefinition, height)
  const parts: ArchitecturePart[] = [Object.freeze({
    id: `${input.id ?? 'railing'}:topRail`, role: 'railing:rail',
    geometry: { kind: 'sweep', profile, path: topPath, cap: !sampled.closed }, transform: transform(),
  })]
  if (input.midRailHeight !== undefined) {
    if (typeof input.midRailHeight !== 'number' || !Number.isFinite(input.midRailHeight) || input.midRailHeight <= 0 || input.midRailHeight >= height) architectureError('ARCHITECTURE_INVALID', '/midRailHeight', 'midRailHeight must be a finite value between 0 and railing height.')
    parts.push(Object.freeze({
      id: `${input.id ?? 'railing'}:midRail`, role: 'railing:rail',
      geometry: { kind: 'sweep', profile, path: shiftedPath(path as CurveDefinition, input.midRailHeight), cap: !sampled.closed }, transform: transform(),
    }))
  }
  const groups: ArchitectureInstanceGroup[] = []
  if (input.includePosts ?? true) {
    const postSpacing = finitePositive(input.postSpacing ?? .8, '/postSpacing', 'postSpacing')
    const postWidth = finitePositive(input.postWidth ?? .04, '/postWidth', 'postWidth')
    const layout = layoutPathArray({ path: path as CurveDefinition, spacing: postSpacing, includeEnd: true, alignToPath: false }, { limits })
    const placements: ArchitectureInstancePlacement[] = layout.placements.map((item, index) => Object.freeze({
      index,
      position: Object.freeze([item.position[0], item.position[1] + height / 2, item.position[2]]) as readonly [number, number, number],
      rotation: Object.freeze([0, 0, 0]) as readonly [number, number, number],
      scale: Object.freeze([1, 1, 1]) as readonly [number, number, number],
    }))
    groups.push(Object.freeze({
      id: `${input.id ?? 'railing'}:posts`, role: 'railing:post',
      geometry: { kind: 'roundedBox', size: [postWidth, height, postWidth], radius: Math.min(postWidth * .15, .01), segments: 2 },
      placements: freezeArray(placements),
    }))
  }
  const first = sampled.points[0]!, last = sampled.points[sampled.points.length - 1]!
  return {
    parts: freezeArray(parts), instanceGroups: freezeArray(groups),
    anchors: freezeArray([
      { name: 'start', position: Object.freeze([...first]) },
      { name: 'end', position: Object.freeze([...last]) },
      { name: 'topStart', position: Object.freeze([first[0], first[1] + height, first[2]]) },
      { name: 'topEnd', position: Object.freeze([last[0], last[1] + height, last[2]]) },
    ]),
  }
}

function circleProfile(radius: number, segments: number): ProfileDefinition {
  const points: [number, number][] = []
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * Math.PI * 2
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  return { points }
}
function shiftedPath(path: CurveDefinition, y: number): CurveDefinition {
  return { ...path, points: path.points.map(point => [point[0], point[1] + y, point[2]] as [number, number, number]) }
}
