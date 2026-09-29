import type {
  GeometryDefinition,
  GeometryMeshDraft,
  GeometryVertexColorDefinition,
  GeometryVertexColorGradientDefinition,
  GeometryVertexColorGradientStop,
  GeometryVertexColorNoiseDefinition,
} from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { sampleGeometryNoise3 } from '../modifiers/noise.js'

const AXES = new Set(['x', 'y', 'z'])
const INT32_MIN = -0x8000_0000
const INT32_MAX = 0x7fff_ffff

export function normalizeVertexColorPolicy(definition: GeometryDefinition): GeometryDefinition {
  if (definition.vertexColor === undefined) return definition
  return { ...definition, vertexColor: normalizeVertexColorDefinition(definition.vertexColor) }
}

export function applyVertexColorPolicy(mesh: GeometryMeshDraft, definition: GeometryDefinition): GeometryMeshDraft {
  const policy = definition.vertexColor
  if (!policy) return mesh
  const vertexCount = mesh.positions.length / 3
  const colors = new Float32Array(vertexCount * 4)

  if (policy.mode === 'constant') {
    const color = parseHexColorToLinear(policy.color)
    for (let index = 0; index < vertexCount; index += 1) writeColor(colors, index, color)
    return { ...mesh, colors }
  }

  const bounds = normalizedBounds(mesh.positions)
  if (policy.mode === 'gradient') {
    const axis = axisIndex(policy.axis)
    const stops = policy.stops.map(([position, color]) => [position, parseHexColorToLinear(color)] as const)
    for (let index = 0; index < vertexCount; index += 1) {
      const t = normalizedPosition(mesh.positions[index * 3 + axis]!, bounds.min[axis], bounds.max[axis])
      writeColor(colors, index, sampleStops(stops, t))
    }
    return { ...mesh, colors }
  }

  const colorA = parseHexColorToLinear(policy.colors[0])
  const colorB = parseHexColorToLinear(policy.colors[1])
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 3
    const x = normalizedPosition(mesh.positions[offset]!, bounds.min[0], bounds.max[0])
    const y = normalizedPosition(mesh.positions[offset + 1]!, bounds.min[1], bounds.max[1])
    const z = normalizedPosition(mesh.positions[offset + 2]!, bounds.min[2], bounds.max[2])
    const frequency = policy.frequency ?? 1
    const strength = policy.strength ?? 1
    const seed = policy.seed ?? 0
    const sample = sampleGeometryNoise3(x * frequency, y * frequency, z * frequency, { seed })
    const t = clamp01(0.5 + sample * 0.5 * strength)
    writeColor(colors, index, mixColor(colorA, colorB, t))
  }
  return { ...mesh, colors }
}

export function normalizeVertexColorDefinition(input: GeometryVertexColorDefinition): GeometryVertexColorDefinition {
  if (!isPlainRecord(input)) throw colorError('/vertexColor', 'vertexColor must be a plain object.')
  if (input.mode === 'constant') {
    return { mode: 'constant', color: normalizeHexColor(input.color, '/vertexColor/color') }
  }
  if (input.mode === 'gradient') return normalizeGradient(input)
  if (input.mode === 'noise') return normalizeNoise(input)
  throw colorError('/vertexColor/mode', 'vertexColor.mode must be constant, gradient, or noise.')
}

function normalizeGradient(input: GeometryVertexColorGradientDefinition): GeometryVertexColorGradientDefinition {
  if (!AXES.has(input.axis)) throw colorError('/vertexColor/axis', 'vertexColor.axis must be x, y, or z.')
  if (!Array.isArray(input.stops) || input.stops.length < 2) throw colorError('/vertexColor/stops', 'vertexColor.stops must contain at least two [position, color] entries.')
  const stops: GeometryVertexColorGradientStop[] = []
  let previous = -Infinity
  for (let index = 0; index < input.stops.length; index += 1) {
    const stop = input.stops[index]
    const path = `/vertexColor/stops/${index}`
    if (!Array.isArray(stop) || stop.length !== 2) throw colorError(path, 'Each gradient stop must be [position, color].')
    const position = stop[0]
    if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 1) throw colorError(`${path}/0`, 'Gradient stop position must be a finite number from 0 to 1.')
    if (position <= previous) throw colorError(`${path}/0`, 'Gradient stop positions must be strictly increasing.')
    previous = position
    stops.push([position, normalizeHexColor(stop[1], `${path}/1`)])
  }
  return { mode: 'gradient', axis: input.axis, stops }
}

function normalizeNoise(input: GeometryVertexColorNoiseDefinition): GeometryVertexColorNoiseDefinition {
  const seed = input.seed ?? 0
  if (!Number.isSafeInteger(seed) || seed < INT32_MIN || seed > INT32_MAX) throw colorError('/vertexColor/seed', `vertexColor.seed must be a safe integer from ${INT32_MIN} to ${INT32_MAX}.`)
  const frequency = input.frequency ?? 1
  if (typeof frequency !== 'number' || !Number.isFinite(frequency) || frequency <= 0) throw colorError('/vertexColor/frequency', 'vertexColor.frequency must be a finite number greater than zero.')
  const strength = input.strength ?? 1
  if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 1) throw colorError('/vertexColor/strength', 'vertexColor.strength must be a finite number from 0 to 1.')
  if (!Array.isArray(input.colors) || input.colors.length !== 2) throw colorError('/vertexColor/colors', 'vertexColor.colors must contain exactly two colors.')
  return {
    mode: 'noise',
    seed,
    frequency,
    strength,
    colors: [normalizeHexColor(input.colors[0], '/vertexColor/colors/0'), normalizeHexColor(input.colors[1], '/vertexColor/colors/1')],
  }
}

function normalizedBounds(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis]!
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  return { min, max }
}

function normalizedPosition(value: number, min: number, max: number): number {
  const extent = max - min
  return extent > 1e-12 ? clamp01((value - min) / extent) : 0.5
}

function sampleStops(stops: readonly (readonly [number, readonly [number, number, number, number]])[], t: number): [number, number, number, number] {
  if (t <= stops[0]![0]) return [...stops[0]![1]] as [number, number, number, number]
  const last = stops[stops.length - 1]!
  if (t >= last[0]) return [...last[1]] as [number, number, number, number]
  for (let index = 1; index < stops.length; index += 1) {
    const right = stops[index]!
    const left = stops[index - 1]!
    if (t <= right[0]) return mixColor(left[1], right[1], (t - left[0]) / (right[0] - left[0]))
  }
  return [...last[1]] as [number, number, number, number]
}

function parseHexColorToLinear(value: string): [number, number, number, number] {
  const normalized = normalizeHexColor(value, '/vertexColor/color')
  const text = normalized.slice(1)
  const rgb = text.slice(0, 6)
  const alpha = text.length === 8 ? parseInt(text.slice(6, 8), 16) / 255 : 1
  return [
    srgbToLinear(parseInt(rgb.slice(0, 2), 16) / 255),
    srgbToLinear(parseInt(rgb.slice(2, 4), 16) / 255),
    srgbToLinear(parseInt(rgb.slice(4, 6), 16) / 255),
    alpha,
  ]
}

function normalizeHexColor(value: unknown, path: string): string {
  if (typeof value !== 'string') throw colorError(path, 'Vertex colors must be hexadecimal color strings.')
  const input = value.trim().toLowerCase()
  const short = /^#([0-9a-f]{3,4})$/.exec(input)
  if (short) {
    const text = short[1]!
    return `#${text.split('').map(character => character + character).join('')}`
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(input)) return input
  throw colorError(path, 'Vertex colors must use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA hexadecimal syntax.')
}

function srgbToLinear(value: number): number { return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4 }
function mixColor(a: readonly [number, number, number, number], b: readonly [number, number, number, number], t: number): [number, number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}
function writeColor(target: Float32Array, vertexIndex: number, color: readonly [number, number, number, number]): void {
  const offset = vertexIndex * 4
  target[offset] = color[0]; target[offset + 1] = color[1]; target[offset + 2] = color[2]; target[offset + 3] = color[3]
}
function axisIndex(axis: 'x' | 'y' | 'z'): 0 | 1 | 2 { return axis === 'x' ? 0 : axis === 'y' ? 1 : 2 }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) }
function colorError(path: string, message: string): GeometryValidationError { return new GeometryValidationError([{ code: 'GEOMETRY_PARAMETER_INVALID', path, message }]) }
