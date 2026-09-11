import type { Euler, Quaternion, Vec3 } from '../core/types.js'

export const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1]

export function quaternionFromEulerXYZ(rotation: Euler): Quaternion {
  const [x, y, z] = rotation
  const hx = x / 2
  const hy = y / 2
  const hz = z / 2
  const sx = Math.sin(hx)
  const cx = Math.cos(hx)
  const sy = Math.sin(hy)
  const cy = Math.cos(hy)
  const sz = Math.sin(hz)
  const cz = Math.cos(hz)

  return normalizeQuaternion([
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ])
}

export function multiplyQuaternions(parent: Quaternion, local: Quaternion): Quaternion {
  const [ax, ay, az, aw] = parent
  const [bx, by, bz, bw] = local
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ])
}

export function normalizeQuaternion(value: Quaternion): Quaternion {
  const length = Math.hypot(value[0], value[1], value[2], value[3])
  if (length === 0) return IDENTITY_QUATERNION
  return [value[0] / length, value[1] / length, value[2] / length, value[3] / length]
}

export function rotateVectorByQuaternion(value: Vec3, rotation: Quaternion): Vec3 {
  const [x, y, z, w] = rotation
  const [vx, vy, vz] = value

  const ix = w * vx + y * vz - z * vy
  const iy = w * vy + z * vx - x * vz
  const iz = w * vz + x * vy - y * vx
  const iw = -x * vx - y * vy - z * vz

  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ]
}

export function eulerXYZFromQuaternion(value: Quaternion): Euler {
  const [x, y, z, w] = normalizeQuaternion(value)

  const m11 = 1 - 2 * (y * y + z * z)
  const m12 = 2 * (x * y - z * w)
  const m13 = 2 * (x * z + y * w)
  const m23 = 2 * (y * z - x * w)
  const m33 = 1 - 2 * (x * x + y * y)
  const m32 = 2 * (y * z + x * w)
  const m22 = 1 - 2 * (x * x + z * z)

  const clamp = (number: number): number => Math.max(-1, Math.min(1, number))
  const yAngle = Math.asin(clamp(m13))
  let xAngle: number
  let zAngle: number

  if (Math.abs(m13) < 0.9999999) {
    xAngle = Math.atan2(-m23, m33)
    zAngle = Math.atan2(-m12, m11)
  } else {
    xAngle = Math.atan2(m32, m22)
    zAngle = 0
  }

  return [xAngle, yAngle, zAngle]
}
