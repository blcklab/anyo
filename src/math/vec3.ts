import type { Vec3 } from '../core/types.js'

export const vec3 = {
  add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  },

  subtract(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  },

  scale(value: Vec3, scalar: number): Vec3 {
    return [value[0] * scalar, value[1] * scalar, value[2] * scalar]
  },

  length(value: Vec3): number {
    return Math.hypot(value[0], value[1], value[2])
  },

  lengthXZ(value: Vec3): number {
    return Math.hypot(value[0], value[2])
  },

  normalize(value: Vec3): Vec3 {
    const length = vec3.length(value)
    return length > 0 ? vec3.scale(value, 1 / length) : [0, 0, 0]
  },

  distance(a: Vec3, b: Vec3): number {
    return vec3.length(vec3.subtract(a, b))
  },

  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  },
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
