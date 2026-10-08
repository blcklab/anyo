import type {
  GeometryArrayDefinition,
  GeometryArrayLayout,
  GeometryArrayOperator,
  GeometryArrayPlacement,
  GeometryGroup,
  GeometryIssue,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryOperator,
  GeometrySafetyLimits,
} from '../types/index.js'
import type { GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import { normalizeGeometryDefinition } from '../core/normalizeGeometry.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import { transformGeometryMesh } from './meshTransform.js'

export interface GeometryArrayOptions {
  limits?: Partial<GeometrySafetyLimits>
}

export const arrayGeometryOperator: GeometryOperatorCompiler = {
  kind: 'array',
  normalize(operator, context) {
    return normalizeArrayOperator(operator, context.limits)
  },
  apply(mesh, operator, context) {
    return applyArrayOperator(mesh, operator, context.limits)
  },
}

export function normalizeArrayOperator(input: GeometryOperator | GeometryArrayDefinition, limitsInput: Partial<GeometrySafetyLimits> = {}): GeometryArrayOperator {
  const limits = resolveGeometrySafetyLimits(limitsInput)
  if (!input || typeof input !== 'object' || Array.isArray(input)) parameterError('', 'Array operator must be a plain object.')
  const count = input.count
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) parameterError('/count', 'count must be a positive safe integer.')
  if (count > limits.maxGeneratedInstances) {
    throw new GeometryValidationError([{ code: 'GEOMETRY_INSTANCE_LIMIT', path: '/count', message: `Array requests ${count} instances, above maxGeneratedInstances ${limits.maxGeneratedInstances}.`, suggestion: 'Reduce count or split the array into bounded groups.' }])
  }
  return {
    kind: 'array',
    count,
    offset: vec3(input.offset, '/offset', true),
    position: vec3(input.position ?? [0, 0, 0], '/position', true),
    rotation: vec3(input.rotation ?? [0, 0, 0], '/rotation', true),
    rotationOffset: vec3(input.rotationOffset ?? [0, 0, 0], '/rotationOffset', true),
    scale: vec3(input.scale ?? [1, 1, 1], '/scale', false),
  }
}

export function layoutGeometryArray(input: GeometryArrayDefinition, options: GeometryArrayOptions = {}): GeometryArrayLayout {
  const limits = resolveGeometrySafetyLimits(options.limits)
  if (!input || typeof input !== 'object' || Array.isArray(input)) parameterError('', 'Array modifier must be a plain object.')
  const source = normalizeGeometryDefinition(input.source, { limits })
  const operator = normalizeArrayOperator({ ...input, kind: 'array' }, limits)
  return Object.freeze({ source, placements: createArrayPlacements(operator) })
}

export function applyArrayOperator(
  source: GeometryMesh,
  input: GeometryOperator | GeometryArrayDefinition,
  limitsInput: Partial<GeometrySafetyLimits> = {},
): GeometryMeshDraft {
  const limits = resolveGeometrySafetyLimits(limitsInput)
  const operator = normalizeArrayOperator(input, limits)
  const count = operator.count
  const sourceVertexCount = source.positions.length / 3
  const sourceIndexCount = source.indices.length
  const totalVertices = sourceVertexCount * count
  const totalIndices = sourceIndexCount * count
  if (!Number.isSafeInteger(totalVertices) || totalVertices > limits.maxGeometryVertices) {
    meshLimit('/count', `Array would generate ${totalVertices} vertices, above maxGeometryVertices ${limits.maxGeometryVertices}.`)
  }
  if (!Number.isSafeInteger(totalIndices) || totalIndices > limits.maxGeometryIndices) {
    meshLimit('/count', `Array would generate ${totalIndices} indices, above maxGeometryIndices ${limits.maxGeometryIndices}.`)
  }

  const positions = new Float32Array(source.positions.length * count)
  const normals = source.normals ? new Float32Array(source.normals.length * count) : undefined
  const uvs = source.uvs ? new Float32Array(source.uvs.length * count) : undefined
  const tangents = source.tangents ? new Float32Array(source.tangents.length * count) : undefined
  const colors = source.colors ? new Float32Array(source.colors.length * count) : undefined
  const indices = totalVertices > 65_535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices)
  const groups: GeometryGroup[] = []
  const placements = createArrayPlacements(operator)

  for (let copy = 0; copy < count; copy += 1) {
    const placement = placements[copy]!
    const transformed = transformGeometryMesh(source, {
      position: [...placement.position],
      rotation: [...placement.rotation],
      scale: [...placement.scale],
    })
    positions.set(transformed.positions, copy * source.positions.length)
    if (normals && transformed.normals) normals.set(transformed.normals, copy * source.normals!.length)
    if (uvs && transformed.uvs) uvs.set(transformed.uvs, copy * source.uvs!.length)
    if (tangents && transformed.tangents) tangents.set(transformed.tangents, copy * source.tangents!.length)
    if (colors && transformed.colors) colors.set(transformed.colors, copy * source.colors!.length)
    const vertexOffset = copy * sourceVertexCount
    const indexOffset = copy * sourceIndexCount
    for (let index = 0; index < sourceIndexCount; index += 1) indices[indexOffset + index] = transformed.indices[index]! + vertexOffset
    if (transformed.groups) {
      for (const group of transformed.groups) groups.push({ ...group, start: group.start + indexOffset })
    }
  }

  return {
    positions,
    indices,
    ...(normals ? { normals } : {}),
    ...(uvs ? { uvs } : {}),
    ...(tangents ? { tangents } : {}),
    ...(colors ? { colors } : {}),
    ...(groups.length ? { groups: Object.freeze(groups.map(group => Object.freeze(group))) } : {}),
  }
}

function createArrayPlacements(operator: GeometryArrayOperator): readonly GeometryArrayPlacement[] {
  const count = operator.count
  const offset = operator.offset
  const position = operator.position!
  const rotation = operator.rotation!
  const rotationOffset = operator.rotationOffset!
  const scale = operator.scale!
  const placements: GeometryArrayPlacement[] = []
  for (let index = 0; index < count; index += 1) {
    placements.push(Object.freeze({
      index,
      position: Object.freeze([
        position[0] + offset[0] * index,
        position[1] + offset[1] * index,
        position[2] + offset[2] * index,
      ]) as readonly [number, number, number],
      rotation: Object.freeze([
        rotation[0] + rotationOffset[0] * index,
        rotation[1] + rotationOffset[1] * index,
        rotation[2] + rotationOffset[2] * index,
      ]) as readonly [number, number, number],
      scale: Object.freeze([...scale]) as readonly [number, number, number],
    }))
  }
  return Object.freeze(placements)
}

function vec3(input: unknown, path: string, allowZero: boolean): [number, number, number] {
  if (!Array.isArray(input) || input.length !== 3 || input.some(value => typeof value !== 'number' || !Number.isFinite(value) || (!allowZero && value === 0))) {
    parameterError(path, `${path.slice(1)} must be three finite${allowZero ? '' : ' non-zero'} numbers.`)
  }
  return [input[0] as number, input[1] as number, input[2] as number]
}
function meshLimit(path: string, message: string): never {
  throw new GeometryValidationError([{ code: 'GEOMETRY_MESH_LIMIT', path, message, suggestion: 'Reduce count or use instance resources instead of baking repeated mesh copies.' }])
}
function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}
