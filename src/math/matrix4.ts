import type { Matrix4Tuple, Quaternion, TransformDefinition, Vec3 } from '../core/types.js'
import { eulerXYZFromQuaternion, normalizeQuaternion, quaternionFromEulerXYZ } from './quaternion.js'

export function composeMatrix4(position: Vec3, rotation: Quaternion, scale: Vec3): Matrix4Tuple {
  const [x, y, z, w] = rotation
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  const [sx, sy, sz] = scale

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    position[0],
    position[1],
    position[2],
    1,
  ]
}

export function matrixFromTransform(transform: Pick<TransformDefinition, 'position' | 'rotation' | 'quaternion' | 'scale'>): Matrix4Tuple {
  return composeMatrix4(transform.position, transform.quaternion ?? quaternionFromEulerXYZ(transform.rotation), transform.scale)
}

export function transformPoint(matrix: Matrix4Tuple, point: Vec3): Vec3 {
  const [x, y, z] = point
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ]
}


export function multiplyMatrix4(a: Matrix4Tuple, b: Matrix4Tuple): Matrix4Tuple {
  const result = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        a[0 * 4 + row]! * b[column * 4 + 0]! +
        a[1 * 4 + row]! * b[column * 4 + 1]! +
        a[2 * 4 + row]! * b[column * 4 + 2]! +
        a[3 * 4 + row]! * b[column * 4 + 3]!
    }
  }
  return result as unknown as Matrix4Tuple
}

export function invertMatrix4(matrix: Matrix4Tuple): Matrix4Tuple {
  const m = matrix
  const out = new Array<number>(16)
  const b00 = m[0] * m[5] - m[1] * m[4]
  const b01 = m[0] * m[6] - m[2] * m[4]
  const b02 = m[0] * m[7] - m[3] * m[4]
  const b03 = m[1] * m[6] - m[2] * m[5]
  const b04 = m[1] * m[7] - m[3] * m[5]
  const b05 = m[2] * m[7] - m[3] * m[6]
  const b06 = m[8] * m[13] - m[9] * m[12]
  const b07 = m[8] * m[14] - m[10] * m[12]
  const b08 = m[8] * m[15] - m[11] * m[12]
  const b09 = m[9] * m[14] - m[10] * m[13]
  const b10 = m[9] * m[15] - m[11] * m[13]
  const b11 = m[10] * m[15] - m[11] * m[14]
  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (Math.abs(determinant) < 1e-12) throw new Error('Cannot invert a singular transform matrix.')
  determinant = 1 / determinant
  out[0] = (m[5] * b11 - m[6] * b10 + m[7] * b09) * determinant
  out[1] = (m[2] * b10 - m[1] * b11 - m[3] * b09) * determinant
  out[2] = (m[13] * b05 - m[14] * b04 + m[15] * b03) * determinant
  out[3] = (m[10] * b04 - m[9] * b05 - m[11] * b03) * determinant
  out[4] = (m[6] * b08 - m[4] * b11 - m[7] * b07) * determinant
  out[5] = (m[0] * b11 - m[2] * b08 + m[3] * b07) * determinant
  out[6] = (m[14] * b02 - m[12] * b05 - m[15] * b01) * determinant
  out[7] = (m[8] * b05 - m[10] * b02 + m[11] * b01) * determinant
  out[8] = (m[4] * b10 - m[5] * b08 + m[7] * b06) * determinant
  out[9] = (m[1] * b08 - m[0] * b10 - m[3] * b06) * determinant
  out[10] = (m[12] * b04 - m[13] * b02 + m[15] * b00) * determinant
  out[11] = (m[9] * b02 - m[8] * b04 - m[11] * b00) * determinant
  out[12] = (m[5] * b07 - m[4] * b09 - m[6] * b06) * determinant
  out[13] = (m[0] * b09 - m[1] * b07 + m[2] * b06) * determinant
  out[14] = (m[13] * b01 - m[12] * b03 - m[14] * b00) * determinant
  out[15] = (m[8] * b03 - m[9] * b01 + m[10] * b00) * determinant
  return out as unknown as Matrix4Tuple
}

function quaternionFromBasis(
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number,
): Quaternion {
  const trace = m00 + m11 + m22
  let x: number
  let y: number
  let z: number
  let w: number
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    w = 0.25 * s
    x = (m21 - m12) / s
    y = (m02 - m20) / s
    z = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    w = (m21 - m12) / s
    x = 0.25 * s
    y = (m01 + m10) / s
    z = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    w = (m02 - m20) / s
    x = (m01 + m10) / s
    y = 0.25 * s
    z = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    w = (m10 - m01) / s
    x = (m02 + m20) / s
    y = (m12 + m21) / s
    z = 0.25 * s
  }
  return normalizeQuaternion([x, y, z, w])
}

export function decomposeMatrix4(matrix: Matrix4Tuple, shearTolerance = 1e-5): TransformDefinition {
  const position: Vec3 = [matrix[12], matrix[13], matrix[14]]
  const xAxis: Vec3 = [matrix[0], matrix[1], matrix[2]]
  const yAxis: Vec3 = [matrix[4], matrix[5], matrix[6]]
  const zAxis: Vec3 = [matrix[8], matrix[9], matrix[10]]
  const sx = Math.hypot(...xAxis)
  const sy = Math.hypot(...yAxis)
  const sz = Math.hypot(...zAxis)
  if (sx < 1e-12 || sy < 1e-12 || sz < 1e-12) throw new Error('Cannot decompose a transform with zero scale.')
  const nx: Vec3 = [xAxis[0] / sx, xAxis[1] / sx, xAxis[2] / sx]
  const ny: Vec3 = [yAxis[0] / sy, yAxis[1] / sy, yAxis[2] / sy]
  const nz: Vec3 = [zAxis[0] / sz, zAxis[1] / sz, zAxis[2] / sz]
  const dotXY = nx[0] * ny[0] + nx[1] * ny[1] + nx[2] * ny[2]
  const dotXZ = nx[0] * nz[0] + nx[1] * nz[1] + nx[2] * nz[2]
  const dotYZ = ny[0] * nz[0] + ny[1] * nz[1] + ny[2] * nz[2]
  if (Math.max(Math.abs(dotXY), Math.abs(dotXZ), Math.abs(dotYZ)) > shearTolerance) {
    throw new Error('ANYO_EDITOR_TRANSFORM_SHEAR_UNREPRESENTABLE')
  }
  const determinant =
    nx[0] * (ny[1] * nz[2] - ny[2] * nz[1]) -
    ny[0] * (nx[1] * nz[2] - nx[2] * nz[1]) +
    nz[0] * (nx[1] * ny[2] - nx[2] * ny[1])
  const scale: Vec3 = determinant < 0 ? [-sx, sy, sz] : [sx, sy, sz]
  const rx = determinant < 0 ? [-nx[0], -nx[1], -nx[2]] as Vec3 : nx
  const quaternion = quaternionFromBasis(
    rx[0], ny[0], nz[0],
    rx[1], ny[1], nz[1],
    rx[2], ny[2], nz[2],
  )
  return {
    position,
    rotation: eulerXYZFromQuaternion(quaternion),
    quaternion,
    scale,
    matrix,
  }
}

export function relativeTransformMatrix(parentWorld: Matrix4Tuple, world: Matrix4Tuple): Matrix4Tuple {
  return multiplyMatrix4(invertMatrix4(parentWorld), world)
}
