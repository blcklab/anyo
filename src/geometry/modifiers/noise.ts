import type { GeometryDefinition, GeometryIssue, GeometryJsonValue, GeometryMeshDraft } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { GeometryValidationError } from '../validation/errors.js'
import { generateNormals } from '../attributes/normals.js'
import { generateTangents } from '../attributes/tangents.js'

const DEFAULT_SEED = 0
const DEFAULT_FREQUENCY = 1
const DEFAULT_STRENGTH = 0.1
const DEFAULT_OCTAVES = 1
const DEFAULT_LACUNARITY = 2
const DEFAULT_PERSISTENCE = 0.5
const MAX_NOISE_OCTAVES = 16
const UINT32_SCALE = 1 / 0x1_0000_0000

export const noiseGeometryKind: GeometryKindCompiler = {
  kind: 'noise',
  normalize(definition, context) {
    const source = context.normalizeChild(requireRecord(definition.source, '/source'), 'noise')
    const seed = integer(definition.seed ?? DEFAULT_SEED, '/seed', -0x8000_0000, 0x7fff_ffff)
    const frequency = positive(definition.frequency ?? DEFAULT_FREQUENCY, '/frequency')
    const strength = nonNegative(definition.strength ?? DEFAULT_STRENGTH, '/strength')
    const octaves = integer(definition.octaves ?? DEFAULT_OCTAVES, '/octaves', 1, MAX_NOISE_OCTAVES)
    const lacunarity = positive(definition.lacunarity ?? DEFAULT_LACUNARITY, '/lacunarity')
    const persistence = bounded(definition.persistence ?? DEFAULT_PERSISTENCE, '/persistence', 0, 1)
    const offset = vec3(definition.offset ?? [0, 0, 0], '/offset')
    return {
      ...definition,
      source: source as unknown as GeometryJsonValue,
      seed,
      frequency,
      strength,
      octaves,
      lacunarity,
      persistence,
      offset,
    }
  },
  compile(definition, context) {
    const source = context.compileChild(requireRecord(definition.source, '/source'), 'noise')
    const seed = definition.seed as number
    const frequency = definition.frequency as number
    const strength = definition.strength as number
    const octaves = definition.octaves as number
    const lacunarity = definition.lacunarity as number
    const persistence = definition.persistence as number
    const offset = definition.offset as [number, number, number]

    if (strength === 0) return cloneMeshWithoutBounds(source)

    // Surface displacement needs a stable direction per vertex. Existing authored
    // normals are preferred; meshes without normals receive deterministic smooth
    // normals before deformation. Normals are regenerated again afterwards.
    const sourceWithNormals = source.normals
      ? source
      : context.finalizeDraft(generateNormals(cloneMeshWithoutBounds(source), { mode: 'smooth', creaseAngle: Math.PI }))

    const positions = new Float32Array(sourceWithNormals.positions.length)
    for (let index = 0; index < sourceWithNormals.positions.length; index += 3) {
      const px = sourceWithNormals.positions[index]!
      const py = sourceWithNormals.positions[index + 1]!
      const pz = sourceWithNormals.positions[index + 2]!
      const nx = sourceWithNormals.normals![index]!
      const ny = sourceWithNormals.normals![index + 1]!
      const nz = sourceWithNormals.normals![index + 2]!
      const sx = px * frequency + offset[0]
      const sy = py * frequency + offset[1]
      const sz = pz * frequency + offset[2]
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) {
        parameterError('/frequency', 'frequency and offset must keep sampled noise coordinates finite for the source geometry.')
      }
      const displacement = fbm3(sx, sy, sz, seed, octaves, lacunarity, persistence) * strength
      positions[index] = px + nx * displacement
      positions[index + 1] = py + ny * displacement
      positions[index + 2] = pz + nz * displacement
    }

    const deformed: GeometryMeshDraft = {
      positions,
      indices: sourceWithNormals.indices,
      ...(sourceWithNormals.uvs ? { uvs: sourceWithNormals.uvs } : {}),
      ...(sourceWithNormals.colors ? { colors: sourceWithNormals.colors } : {}),
      ...(sourceWithNormals.groups ? { groups: sourceWithNormals.groups } : {}),
    }

    // Never retain stale surface attributes after displacement. Preserve the
    // source's tangent capability when present; outer surface policy may still
    // override normal/UV/tangent generation after this compiler returns.
    let result = generateNormals(deformed, { mode: 'smooth', creaseAngle: Math.PI })
    if (source.tangents && result.uvs) result = generateTangents(result)
    return result
  },
}

/** Deterministic normalized fBm built from small integer-hashed 3D value noise. */
export function sampleGeometryNoise3(
  x: number,
  y: number,
  z: number,
  options: { seed?: number; octaves?: number; lacunarity?: number; persistence?: number } = {},
): number {
  const seed = integer(options.seed ?? DEFAULT_SEED, '/seed', -0x8000_0000, 0x7fff_ffff)
  const octaves = integer(options.octaves ?? DEFAULT_OCTAVES, '/octaves', 1, MAX_NOISE_OCTAVES)
  const lacunarity = positive(options.lacunarity ?? DEFAULT_LACUNARITY, '/lacunarity')
  const persistence = bounded(options.persistence ?? DEFAULT_PERSISTENCE, '/persistence', 0, 1)
  if (![x, y, z].every(Number.isFinite)) parameterError('/position', 'Noise sample coordinates must be finite numbers.')
  return fbm3(x, y, z, seed, octaves, lacunarity, persistence)
}

function fbm3(x: number, y: number, z: number, seed: number, octaves: number, lacunarity: number, persistence: number): number {
  let value = 0
  let amplitude = 1
  let weight = 0
  let frequency = 1
  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise3(x * frequency, y * frequency, z * frequency, seed + Math.imul(octave, 0x9e3779b1)) * amplitude
    weight += amplitude
    frequency *= lacunarity
    amplitude *= persistence
    if (!Number.isFinite(frequency) || !Number.isFinite(amplitude)) parameterError('/octaves', 'Noise octave parameters overflow finite numeric range.')
  }
  return weight > 0 ? value / weight : 0
}

function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z)
  const tx = fade(x - x0), ty = fade(y - y0), tz = fade(z - z0)
  const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1
  const c000 = lattice(x0, y0, z0, seed), c100 = lattice(x1, y0, z0, seed)
  const c010 = lattice(x0, y1, z0, seed), c110 = lattice(x1, y1, z0, seed)
  const c001 = lattice(x0, y0, z1, seed), c101 = lattice(x1, y0, z1, seed)
  const c011 = lattice(x0, y1, z1, seed), c111 = lattice(x1, y1, z1, seed)
  const a = lerp(lerp(c000, c100, tx), lerp(c010, c110, tx), ty)
  const b = lerp(lerp(c001, c101, tx), lerp(c011, c111, tx), ty)
  return lerp(a, b, tz)
}

function lattice(x: number, y: number, z: number, seed: number): number {
  let h = seed | 0
  h ^= Math.imul(x | 0, 0x632be5ab)
  h ^= Math.imul(y | 0, 0x85157af5)
  h ^= Math.imul(z | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) * UINT32_SCALE * 2 - 1
}

function fade(value: number): number { return value * value * (3 - 2 * value) }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

function cloneMeshWithoutBounds(source: GeometryMeshDraft): GeometryMeshDraft {
  return {
    positions: source.positions,
    indices: source.indices,
    ...(source.normals ? { normals: source.normals } : {}),
    ...(source.uvs ? { uvs: source.uvs } : {}),
    ...(source.tangents ? { tangents: source.tangents } : {}),
    ...(source.colors ? { colors: source.colors } : {}),
    ...(source.groups ? { groups: source.groups } : {}),
  }
}

function requireRecord(value: unknown, path: string): GeometryDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) parameterError(path, `${path.slice(1)} must be a geometry definition object.`)
  return value as GeometryDefinition
}
function vec3(input: unknown, path: string): [number, number, number] {
  if (!Array.isArray(input) || input.length !== 3 || input.some(value => typeof value !== 'number' || !Number.isFinite(value))) parameterError(path, `${path.slice(1)} must be three finite numbers.`)
  return [input[0] as number, input[1] as number, input[2] as number]
}
function positive(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) parameterError(path, `${path.slice(1)} must be a finite number greater than zero.`)
  return value
}
function nonNegative(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) parameterError(path, `${path.slice(1)} must be a finite number greater than or equal to zero.`)
  return value
}
function bounded(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) parameterError(path, `${path.slice(1)} must be a finite number from ${min} to ${max}.`)
  return value
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) parameterError(path, `${path.slice(1)} must be a safe integer from ${min} to ${max}.`)
  return value
}
function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}
