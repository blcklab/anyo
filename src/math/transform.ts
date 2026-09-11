import type { Euler, Quaternion, TransformDefinition, Vec3 } from '../core/types.js'
import { composeMatrix4 } from './matrix4.js'
import { eulerXYZFromQuaternion, multiplyQuaternions, quaternionFromEulerXYZ, rotateVectorByQuaternion } from './quaternion.js'

export interface ComposableTransform {
  position: Vec3
  rotation: Euler
  quaternion: Quaternion
  scale: Vec3
}

export const IDENTITY_TRANSFORM: ComposableTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}

export function normalizeScale(scale: number | Vec3 | undefined): Vec3 {
  if (typeof scale === 'number') return [scale, scale, scale]
  return scale ?? [1, 1, 1]
}

export function createTransform(position: Vec3 = [0, 0, 0], rotation: Euler = [0, 0, 0], scale: Vec3 = [1, 1, 1]): ComposableTransform {
  return { position, rotation, quaternion: quaternionFromEulerXYZ(rotation), scale }
}

export function composeTransforms(parent: ComposableTransform, local: ComposableTransform): ComposableTransform {
  const scaledLocal: Vec3 = [
    local.position[0] * parent.scale[0],
    local.position[1] * parent.scale[1],
    local.position[2] * parent.scale[2],
  ]
  const rotatedLocal = rotateVectorByQuaternion(scaledLocal, parent.quaternion)
  const quaternion = multiplyQuaternions(parent.quaternion, local.quaternion)
  return {
    position: [
      parent.position[0] + rotatedLocal[0],
      parent.position[1] + rotatedLocal[1],
      parent.position[2] + rotatedLocal[2],
    ],
    rotation: eulerXYZFromQuaternion(quaternion),
    quaternion,
    scale: [
      parent.scale[0] * local.scale[0],
      parent.scale[1] * local.scale[1],
      parent.scale[2] * local.scale[2],
    ],
  }
}

export function finalizeTransform(transform: ComposableTransform): TransformDefinition {
  return {
    position: transform.position,
    rotation: transform.rotation,
    quaternion: transform.quaternion,
    scale: transform.scale,
    matrix: composeMatrix4(transform.position, transform.quaternion, transform.scale),
  }
}
