import { GeometryValidationError } from '../validation/errors.js'
import type { CurveFrame, CurvePoint3, SampledCurve } from './types.js'
import { CURVE_EPSILON, cross3, dot3, leastParallelAxis, normalize3, projectPerpendicular, rotateAroundAxis, signedAngleAround } from './vector.js'

export function computeCurveFrames(sampled: SampledCurve, authoredUp?: readonly [number, number, number]): readonly CurveFrame[] {
  const up = authoredUp ? validateUp(authoredUp) : [0, 1, 0] as CurvePoint3
  const firstTangent = sampled.tangents[0]!
  // The authored `up` direction is the profile +Y/binormal axis. Profile +X is
  // derived so cross(profileX, profileY) follows the path tangent.
  let binormal = normalizeProjected(up, firstTangent)
  let normal = normalize3(cross3(binormal, firstTangent), leastParallelAxis(firstTangent))
  binormal = normalize3(cross3(firstTangent, normal), binormal)
  const frames: CurveFrame[] = [{ position: sampled.points[0]!, tangent: firstTangent, normal, binormal, distance: sampled.distances[0]! }]

  for (let index = 1; index < sampled.points.length; index += 1) {
    const previous = frames[index - 1]!, tangent = sampled.tangents[index]!
    const axis = cross3(previous.tangent, tangent), axisLength = Math.hypot(axis[0], axis[1], axis[2])
    let nextNormal: CurvePoint3
    if (axisLength <= CURVE_EPSILON) {
      if (dot3(previous.tangent, tangent) < -0.999999) nextNormal = rotateAroundAxis(previous.normal, previous.binormal, Math.PI)
      else nextNormal = normalizeProjected(previous.normal, tangent)
    } else {
      const angle = Math.atan2(axisLength, Math.max(-1, Math.min(1, dot3(previous.tangent, tangent))))
      nextNormal = normalizeProjected(rotateAroundAxis(previous.normal, axis, angle), tangent)
    }
    const nextBinormal = normalize3(cross3(tangent, nextNormal), previous.binormal)
    nextNormal = normalize3(cross3(nextBinormal, tangent), nextNormal)
    frames.push({ position: sampled.points[index]!, tangent, normal: nextNormal, binormal: nextBinormal, distance: sampled.distances[index]! })
  }

  if (sampled.closed && frames.length > 2) correctClosedSeam(frames, sampled.totalLength)
  return Object.freeze(frames.map(frame => Object.freeze(frame)))
}

export function interpolateCurveFrame(frames: readonly CurveFrame[], segment: number, alpha: number, distance: number): CurveFrame {
  const a = frames[segment]!, b = frames[Math.min(frames.length - 1, segment + 1)]!
  const tangent = normalize3([a.tangent[0] + (b.tangent[0]-a.tangent[0])*alpha, a.tangent[1] + (b.tangent[1]-a.tangent[1])*alpha, a.tangent[2] + (b.tangent[2]-a.tangent[2])*alpha], a.tangent)
  let normal = normalizeProjected([a.normal[0] + (b.normal[0]-a.normal[0])*alpha, a.normal[1] + (b.normal[1]-a.normal[1])*alpha, a.normal[2] + (b.normal[2]-a.normal[2])*alpha], tangent)
  const binormal = normalize3(cross3(tangent, normal), a.binormal)
  normal = normalize3(cross3(binormal, tangent), normal)
  return { position: [a.position[0] + (b.position[0]-a.position[0])*alpha, a.position[1] + (b.position[1]-a.position[1])*alpha, a.position[2] + (b.position[2]-a.position[2])*alpha], tangent, normal, binormal, distance }
}

function correctClosedSeam(frames: CurveFrame[], totalLength: number): void {
  const first = frames[0]!, last = frames[frames.length - 1]!
  const correction = signedAngleAround(last.normal, first.normal, first.tangent)
  if (Math.abs(correction) <= 1e-12) return
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index]!, fraction = totalLength <= CURVE_EPSILON ? 0 : frame.distance / totalLength
    const normal = normalizeProjected(rotateAroundAxis(frame.normal, frame.tangent, correction * fraction), frame.tangent)
    const binormal = normalize3(cross3(frame.tangent, normal), frame.binormal)
    frames[index] = { ...frame, normal, binormal }
  }
}
function normalizeProjected(vector: CurvePoint3, tangent: CurvePoint3): CurvePoint3 {
  const projected = projectPerpendicular(vector, tangent)
  if (Math.hypot(projected[0], projected[1], projected[2]) > CURVE_EPSILON) return normalize3(projected)
  return normalize3(projectPerpendicular(leastParallelAxis(tangent), tangent), [1, 0, 0])
}
function validateUp(up: readonly [number, number, number]): CurvePoint3 {
  if (up.some(value => typeof value !== 'number' || !Number.isFinite(value)) || Math.hypot(up[0], up[1], up[2]) <= CURVE_EPSILON) throw new GeometryValidationError([{ code: 'SWEEP_FRAME_INVALID', path: '/up', message: 'up must be a finite non-zero [x, y, z] vector.' }])
  return normalize3(up)
}
