import type { GeometryIssue, GeometrySafetyLimits, PathArrayDefinition, PathArrayLayout, PathArrayPlacement } from '../types/index.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import { GeometryValidationError } from '../validation/errors.js'
import { normalizeCurve } from '../curves/normalizeCurve.js'
import { sampleCurve, sampleCurveAtDistance } from '../curves/sampleCurve.js'
import { computeCurveFrames, interpolateCurveFrame } from '../curves/frames.js'

export interface PathArrayOptions { limits?: Partial<GeometrySafetyLimits> }

export function layoutPathArray(definition: PathArrayDefinition, options: PathArrayOptions = {}): PathArrayLayout {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) error('GEOMETRY_PARAMETER_INVALID', '/', 'Path array definition must be an object.')
  const limits = resolveGeometrySafetyLimits(options.limits)
  const path = normalizeCurve(definition.path, { limits, path: '/path' })
  const spacing = definition.spacing
  if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0) error('GEOMETRY_PARAMETER_INVALID', '/spacing', 'spacing must be a finite number greater than zero.')
  const offset = definition.offset ?? 0
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) error('GEOMETRY_PARAMETER_INVALID', '/offset', 'offset must be a finite non-negative distance.')
  const includeEnd = definition.includeEnd ?? false
  if (typeof includeEnd !== 'boolean') error('GEOMETRY_PARAMETER_INVALID', '/includeEnd', 'includeEnd must be boolean.')
  const alignToPath = definition.alignToPath ?? true
  if (typeof alignToPath !== 'boolean') error('GEOMETRY_PARAMETER_INVALID', '/alignToPath', 'alignToPath must be boolean.')

  const sampled = sampleCurve(path, { limits, path: '/path' })
  const frames = alignToPath ? computeCurveFrames(sampled, definition.up) : undefined
  if (offset > sampled.totalLength + 1e-9 && !sampled.closed) return { totalLength: sampled.totalLength, closed: sampled.closed, placements: Object.freeze([]) }

  const distances: number[] = []
  if (sampled.closed) {
    const start = offset % sampled.totalLength
    for (let travelled = 0; travelled < sampled.totalLength - 1e-9; travelled += spacing) distances.push((start + travelled) % sampled.totalLength)
  } else {
    for (let distance = offset; distance <= sampled.totalLength + 1e-9; distance += spacing) distances.push(Math.min(distance, sampled.totalLength))
    if (includeEnd && (distances.length === 0 || Math.abs(distances[distances.length - 1]! - sampled.totalLength) > 1e-8)) distances.push(sampled.totalLength)
  }
  if (distances.length > limits.maxGeneratedInstances) error('PATH_ARRAY_LIMIT', '/spacing', `Path array would generate ${distances.length} placements, above maxGeneratedInstances ${limits.maxGeneratedInstances}.`, 'Increase spacing or reduce path length.')

  const placements: PathArrayPlacement[] = distances.map(distance => {
    const sample = sampleCurveAtDistance(sampled, distance)
    if (!frames) return Object.freeze({ distance, position: Object.freeze([...sample.position]) as unknown as readonly [number, number, number] })
    const frame = interpolateCurveFrame(frames, sample.segment, sample.alpha, distance)
    return Object.freeze({
      distance,
      position: Object.freeze([...sample.position]) as unknown as readonly [number, number, number],
      tangent: Object.freeze([...frame.tangent]) as unknown as readonly [number, number, number],
      normal: Object.freeze([...frame.normal]) as unknown as readonly [number, number, number],
      binormal: Object.freeze([...frame.binormal]) as unknown as readonly [number, number, number],
    })
  })
  return Object.freeze({ totalLength: sampled.totalLength, closed: sampled.closed, placements: Object.freeze(placements) })
}

function error(code: Extract<GeometryIssue['code'], 'GEOMETRY_PARAMETER_INVALID' | 'PATH_ARRAY_LIMIT'>, path: string, message: string, suggestion?: string): never {
  throw new GeometryValidationError([{ code, path, message, ...(suggestion ? { suggestion } : {}) }])
}
