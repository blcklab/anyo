import type {
  GeometryDefinition,
  GeometryGroup,
  GeometryIssueCode,
  GeometryJsonValue,
  GeometryMeshAttributesDefinition,
  GeometryMeshDraft,
  GeometryMeshGroupDefinition,
} from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { indexArray, withoutQuality } from './common.js'
import { GeometryValidationError } from '../validation/errors.js'

const ATTRIBUTE_WIDTHS = Object.freeze({ normals: 3, uvs: 2, tangents: 4, colors: 4 } as const)
type AttributeName = keyof typeof ATTRIBUTE_WIDTHS

export const meshGeometryKind: GeometryKindCompiler = {
  kind: 'mesh',
  normalize(definition, context) {
    const positions = numberArray(definition.positions, '/positions')
    if (positions.length === 0 || positions.length % 3 !== 0) meshError('GEOMETRY_MESH_INVALID', '/positions', 'mesh positions must be a non-empty flat xyz array.')
    const vertexCount = positions.length / 3
    if (vertexCount > context.limits.maxGeometryVertices) meshError('GEOMETRY_MESH_LIMIT', '/positions', `mesh exceeds maxGeometryVertices ${context.limits.maxGeometryVertices}.`)

    const indices = indexList(definition.indices, vertexCount, context.limits.maxGeometryIndices)
    const attributes = normalizeAttributes(definition.attributes, vertexCount)
    const groups = normalizeGroups(definition.groups, indices.length)

    const output: GeometryDefinition = {
      ...withoutQuality(definition),
      kind: 'mesh',
      positions,
      indices,
    } as GeometryDefinition
    if (attributes) output.attributes = attributes as unknown as GeometryJsonValue
    else delete output.attributes
    if (groups) output.groups = groups as unknown as GeometryJsonValue
    else delete output.groups
    return output
  },
  compile(definition) {
    const positions = definition.positions as unknown as number[]
    const indices = definition.indices as unknown as number[]
    const attributes = definition.attributes as unknown as GeometryMeshAttributesDefinition | undefined
    const groups = definition.groups as unknown as GeometryMeshGroupDefinition[] | undefined
    const draft: GeometryMeshDraft = {
      positions: new Float32Array(positions),
      indices: indexArray(indices, positions.length / 3),
    }
    if (attributes?.normals) draft.normals = new Float32Array(attributes.normals)
    if (attributes?.uvs) draft.uvs = new Float32Array(attributes.uvs)
    if (attributes?.tangents) draft.tangents = new Float32Array(attributes.tangents)
    if (attributes?.colors) draft.colors = new Float32Array(attributes.colors)
    if (groups) draft.groups = groups.map(group => ({ ...group })) as GeometryGroup[]
    return draft
  },
}

function numberArray(input: unknown, path: string): number[] {
  if (!Array.isArray(input)) meshError('GEOMETRY_MESH_INVALID', path, `${path.slice(1)} must be a flat numeric array.`)
  const output: number[] = new Array(input.length)
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]
    if (typeof value !== 'number' || !Number.isFinite(value)) meshError('GEOMETRY_MESH_INVALID', `${path}/${index}`, `${path.slice(1)} must contain only finite numbers.`)
    output[index] = Object.is(value, -0) ? 0 : value
  }
  return output
}

function indexList(input: unknown, vertexCount: number, maximum: number): number[] {
  if (!Array.isArray(input) || input.length === 0 || input.length % 3 !== 0) meshError('GEOMETRY_MESH_INVALID', '/indices', 'mesh indices must be a non-empty flat triangle-list array.')
  if (input.length > maximum) meshError('GEOMETRY_MESH_LIMIT', '/indices', `mesh exceeds maxGeometryIndices ${maximum}.`)
  const output: number[] = new Array(input.length)
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) meshError('GEOMETRY_MESH_INVALID', `/indices/${index}`, 'mesh indices must be non-negative safe integers.')
    if (value >= vertexCount) meshError('GEOMETRY_INDEX_OUT_OF_RANGE', `/indices/${index}`, `mesh index ${value} is outside ${vertexCount} vertices.`)
    output[index] = value
  }
  return output
}

function normalizeAttributes(input: unknown, vertexCount: number): GeometryMeshAttributesDefinition | undefined {
  if (input === undefined) return undefined
  if (!isPlainRecord(input)) meshError('GEOMETRY_MESH_INVALID', '/attributes', 'mesh attributes must be a plain object.')
  const unknown = Object.keys(input).filter(key => !(key in ATTRIBUTE_WIDTHS))
  if (unknown.length > 0) meshError('GEOMETRY_PARAMETER_INVALID', `/attributes/${unknown[0]}`, `Unsupported mesh attribute "${unknown[0]}".`)
  const output: GeometryMeshAttributesDefinition = Object.create(null) as GeometryMeshAttributesDefinition
  for (const [name, width] of Object.entries(ATTRIBUTE_WIDTHS) as [AttributeName, number][]) {
    if (input[name] === undefined) continue
    const values = numberArray(input[name], `/attributes/${name}`)
    if (values.length !== vertexCount * width) meshError('GEOMETRY_ATTRIBUTE_LENGTH_INVALID', `/attributes/${name}`, `mesh ${name} must contain exactly ${width} values per vertex (${vertexCount * width} values).`)
    output[name] = values
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function normalizeGroups(input: unknown, indexCount: number): GeometryMeshGroupDefinition[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) meshError('GEOMETRY_GROUP_INVALID', '/groups', 'mesh groups must be an array.')
  const output: GeometryMeshGroupDefinition[] = []
  for (let index = 0; index < input.length; index += 1) {
    const raw = input[index]
    const path = `/groups/${index}`
    if (!isPlainRecord(raw)) meshError('GEOMETRY_GROUP_INVALID', path, 'mesh group must be a plain object.')
    const unknown = Object.keys(raw).filter(key => !['start', 'count', 'materialIndex', 'name'].includes(key))
    if (unknown.length > 0) meshError('GEOMETRY_GROUP_INVALID', `${path}/${unknown[0]}`, `Unsupported mesh group property "${unknown[0]}".`)
    const start = nonNegativeInteger(raw.start, `${path}/start`)
    const count = positiveInteger(raw.count, `${path}/count`)
    const materialIndex = nonNegativeInteger(raw.materialIndex, `${path}/materialIndex`)
    if (start % 3 !== 0 || count % 3 !== 0) meshError('GEOMETRY_GROUP_INVALID', path, 'mesh group start and count must be triangle-aligned.')
    if (start + count > indexCount) meshError('GEOMETRY_GROUP_INVALID', path, 'mesh group range exceeds the index buffer.')
    if (raw.name !== undefined && typeof raw.name !== 'string') meshError('GEOMETRY_GROUP_INVALID', `${path}/name`, 'mesh group name must be a string.')
    output.push({ start, count, materialIndex, ...(raw.name === undefined ? {} : { name: raw.name }) })
  }
  return output.length > 0 ? output : undefined
}

function nonNegativeInteger(input: unknown, path: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) meshError('GEOMETRY_GROUP_INVALID', path, `${path.slice(path.lastIndexOf('/') + 1)} must be a non-negative safe integer.`)
  return input
}

function positiveInteger(input: unknown, path: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) meshError('GEOMETRY_GROUP_INVALID', path, `${path.slice(path.lastIndexOf('/') + 1)} must be a positive safe integer.`)
  return input
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function meshError(code: GeometryIssueCode, path: string, message: string): never {
  throw new GeometryValidationError([{ code, path, message }])
}
