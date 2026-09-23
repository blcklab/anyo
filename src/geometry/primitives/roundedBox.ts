import type { GeometryDefinition, GeometryGroup } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { indexArray, nonNegativeNumber, positiveInteger, size3, withoutQuality } from './common.js'
import { qualityDefaults } from './quality.js'

export const roundedBoxGeometryKind: GeometryKindCompiler = {
  kind: 'roundedBox',
  normalize(definition, context) {
    const size = size3(definition)
    const requestedRadius = nonNegativeNumber(definition, 'radius', Math.min(...size) * 0.04)
    const radius = Math.min(requestedRadius, Math.min(...size) * 0.5)
    const segments = positiveInteger(definition, 'segments', qualityDefaults(definition).roundedBoxSegments, context.limits, 1)
    return { ...withoutQuality(definition), kind: 'roundedBox', size: [...size], radius, segments } as GeometryDefinition
  },
  compile(definition) {
    const [width, height, depth] = size3(definition)
    const radius = Number(definition.radius)
    const segments = Number(definition.segments)
    return createRoundedBox(width, height, depth, radius, segments)
  },
}

function createRoundedBox(width: number, height: number, depth: number, radius: number, segments: number) {
  const half = [width * 0.5, height * 0.5, depth * 0.5] as const
  const coordinates = half.map(value => axisCoordinates(value, radius, segments))
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [], groups: GeometryGroup[] = []
  const faces = [
    { name: 'right', axis: 0, sign: 1, u: 2, v: 1, flip: false }, { name: 'left', axis: 0, sign: -1, u: 2, v: 1, flip: true },
    { name: 'top', axis: 1, sign: 1, u: 0, v: 2, flip: false }, { name: 'bottom', axis: 1, sign: -1, u: 0, v: 2, flip: true },
    { name: 'front', axis: 2, sign: 1, u: 0, v: 1, flip: true }, { name: 'back', axis: 2, sign: -1, u: 0, v: 1, flip: false },
  ] as const
  for (const face of faces) {
    const groupStart = indices.length
    const uc = coordinates[face.u]!, vc = coordinates[face.v]!, base = positions.length / 3
    for (let row = 0; row < vc.length; row += 1) {
      for (let column = 0; column < uc.length; column += 1) {
        const point = [0, 0, 0]
        point[face.axis] = half[face.axis] * face.sign
        point[face.u] = uc[column]!
        point[face.v] = vc[row]!
        const rounded = roundedPoint(point, half, radius, face.axis, face.sign)
        positions.push(...rounded.position)
        normals.push(...rounded.normal)
        uvs.push(column / Math.max(1, uc.length - 1), row / Math.max(1, vc.length - 1))
      }
    }
    const columns = uc.length, rows = vc.length
    for (let row = 0; row < rows - 1; row += 1) for (let column = 0; column < columns - 1; column += 1) {
      const a = base + row * columns + column, b = a + 1, c = a + columns + 1, d = a + columns
      if (face.flip) indices.push(a, c, b, a, d, c)
      else indices.push(a, b, c, a, c, d)
    }
    groups.push({ start: groupStart, count: indices.length - groupStart, materialIndex: 0, name: face.name })
  }
  // The face-grid traversal above follows the historical Sekai grid orientation;
  // reverse every triangle so the renderer-neutral Anyo contract remains CCW/outward.
  for (let index = 0; index < indices.length; index += 3) {
    const second = indices[index + 1]!
    indices[index + 1] = indices[index + 2]!
    indices[index + 2] = second
  }
  const vertexCount = positions.length / 3
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: indexArray(indices, vertexCount), groups,
  }
}

function axisCoordinates(half: number, radius: number, segments: number): number[] {
  if (radius <= 1e-12) return [-half, half]
  const values: number[] = []
  for (let index = 0; index <= segments; index += 1) values.push(-half + radius * (index / segments))
  const positiveStart = half - radius
  if (positiveStart > -half + radius + 1e-10) values.push(positiveStart)
  for (let index = 1; index <= segments; index += 1) values.push(positiveStart + radius * (index / segments))
  return deduplicate(values)
}

function roundedPoint(point: number[], half: readonly number[], radius: number, faceAxis: number, faceSign: number) {
  if (radius <= 1e-12) {
    const normal = [0, 0, 0]
    normal[faceAxis] = faceSign
    return { position: point as [number, number, number], normal: normal as [number, number, number] }
  }
  const inner = half.map(value => Math.max(0, value - radius))
  const center = point.map((value, axis) => Math.max(-inner[axis]!, Math.min(inner[axis]!, value)))
  const offset = point.map((value, axis) => value - center[axis]!)
  const length = Math.hypot(offset[0]!, offset[1]!, offset[2]!)
  if (length <= 1e-12) {
    const normal = [0, 0, 0]
    normal[faceAxis] = faceSign
    return { position: point as [number, number, number], normal: normal as [number, number, number] }
  }
  const normal = offset.map(value => value / length)
  const position = center.map((value, axis) => value + normal[axis]! * radius)
  return { position: position as [number, number, number], normal: normal as [number, number, number] }
}

function deduplicate(values: readonly number[]): number[] {
  const output: number[] = []
  for (const value of values) if (output.length === 0 || Math.abs(value - output[output.length - 1]!) > 1e-10) output.push(value)
  return output
}
