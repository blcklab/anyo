import type { GeometryDefinition, GeometryMeshDraft, GeometryNormalPolicy, GeometryUvAxis, GeometryUvMode, GeometryUvPolicy } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { generateNormals } from './normals.js'
import { generateUvs } from './uv.js'
import { generateTangents } from './tangents.js'

const UV_MODES = new Set<GeometryUvMode>(['generated', 'planar', 'box', 'cylindrical', 'spherical'])
const UV_AXES = new Set<GeometryUvAxis>(['xy', 'xz', 'yz', 'auto'])

export function normalizeSurfacePolicy(definition: GeometryDefinition): GeometryDefinition {
  const output: GeometryDefinition = { ...definition }
  if (definition.normals !== undefined) output.normals = normalizeNormalPolicy(definition.normals)
  if (definition.uv !== undefined) output.uv = normalizeUvPolicy(definition.uv)
  if (definition.tangents !== undefined) {
    if (typeof definition.tangents !== 'boolean') throw policyError('/tangents', 'tangents must be boolean.')
    if (definition.tangents) output.tangents = true
    else delete output.tangents
  }
  return output
}

export function applySurfacePolicy(mesh: GeometryMeshDraft, definition: GeometryDefinition): GeometryMeshDraft {
  let result = mesh
  if (definition.normals) result = generateNormals(result, definition.normals)
  if (definition.uv) result = generateUvs(result, definition.uv as RequiredPickUvPolicy)
  if (definition.tangents) result = generateTangents(result)
  return result
}

type RequiredPickUvPolicy = GeometryUvPolicy & { mode: GeometryUvMode; axis: GeometryUvAxis; scale: [number, number]; rotation: number; offset: [number, number] }

function normalizeNormalPolicy(input: GeometryNormalPolicy): GeometryNormalPolicy {
  if (!isPlainRecord(input)) throw policyError('/normals', 'normals must be a plain object.')
  const mode = input.mode ?? 'smooth'
  if (mode !== 'flat' && mode !== 'smooth') throw policyError('/normals/mode', 'normals.mode must be flat or smooth.')
  if (mode === 'flat') return { mode: 'flat' }
  const creaseAngle = input.creaseAngle ?? Math.PI
  if (typeof creaseAngle !== 'number' || !Number.isFinite(creaseAngle) || creaseAngle < 0 || creaseAngle > Math.PI) throw policyError('/normals/creaseAngle', 'normals.creaseAngle must be a finite radian value from 0 to PI.')
  return { mode: 'smooth', creaseAngle }
}

function normalizeUvPolicy(input: GeometryUvPolicy): RequiredPickUvPolicy {
  if (!isPlainRecord(input)) throw policyError('/uv', 'uv must be a plain object.')
  const mode = (input.mode ?? 'generated') as GeometryUvMode
  if (!UV_MODES.has(mode)) throw policyError('/uv/mode', 'uv.mode must be generated, planar, box, cylindrical, or spherical.')
  const axis = (input.axis ?? 'auto') as GeometryUvAxis
  if (!UV_AXES.has(axis)) throw policyError('/uv/axis', 'uv.axis must be auto, xy, xz, or yz.')
  const scale = vec2(input.scale ?? [1, 1], '/uv/scale', false)
  const offset = vec2(input.offset ?? [0, 0], '/uv/offset', true)
  const rotation = input.rotation ?? 0
  if (typeof rotation !== 'number' || !Number.isFinite(rotation)) throw policyError('/uv/rotation', 'uv.rotation must be finite radians.')
  const metersPerTile = input.metersPerTile
  if (metersPerTile !== undefined && (typeof metersPerTile !== 'number' || !Number.isFinite(metersPerTile) || metersPerTile <= 0)) throw policyError('/uv/metersPerTile', 'uv.metersPerTile must be a finite positive number.')
  return { mode, axis, scale, rotation, offset, ...(metersPerTile === undefined ? {} : { metersPerTile }) }
}

function vec2(input: unknown, path: string, allowZero: boolean): [number, number] {
  if (!Array.isArray(input) || input.length !== 2 || input.some(value => typeof value !== 'number' || !Number.isFinite(value) || (!allowZero && value === 0))) {
    throw policyError(path, `${path.slice(1)} must be two finite${allowZero ? '' : ' non-zero'} numbers.`)
  }
  return [input[0] as number, input[1] as number]
}
function isPlainRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) }
function policyError(path: string, message: string): GeometryValidationError { return new GeometryValidationError([{ code: 'GEOMETRY_PARAMETER_INVALID', path, message }]) }
