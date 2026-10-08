import type {
  GeometryDisplaceOperator,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryOperator,
} from '../types/index.js'
import type { GeometryOperatorCompiler } from '../core/GeometryCompiler.js'
import { GeometryValidationError } from '../validation/errors.js'
import { generateNormals } from '../attributes/normals.js'
import { generateTangents } from '../attributes/tangents.js'
import { sampleNormalizedScalarField } from '../fields/sampleField.js'
import type { NormalizedScalarFieldDefinition } from '../fields/types.js'

export const displaceGeometryOperator: GeometryOperatorCompiler = {
  kind: 'displace',
  normalize(operator, context) {
    return normalizeDisplaceOperator(operator, context.resolveField)
  },
  apply(mesh, operator, context) {
    return applyDisplaceOperator(mesh, operator as GeometryDisplaceOperator, context.finalizeDraft)
  },
}

export function normalizeDisplaceOperator(
  input: GeometryOperator,
  resolveField: (input: unknown, path?: string) => NormalizedScalarFieldDefinition,
): GeometryDisplaceOperator {
  if (input.field === undefined) parameterError('/field', 'displace.field is required.')
  const direction = input.direction ?? 'normal'
  if (direction !== 'normal' && direction !== 'x' && direction !== 'y' && direction !== 'z') {
    parameterError('/direction', 'displace.direction must be normal, x, y, or z.')
  }
  const strength = finite(input.strength ?? 1, '/strength')
  return {
    kind: 'displace',
    field: resolveField(input.field, '/field'),
    strength,
    direction,
  }
}

export function applyDisplaceOperator(
  source: GeometryMesh,
  operator: GeometryDisplaceOperator,
  finalizeDraft: (mesh: GeometryMeshDraft) => GeometryMesh,
): GeometryMeshDraft {
  const strength = operator.strength ?? 1
  if (strength === 0) return cloneMeshWithoutBounds(source)
  const direction = operator.direction ?? 'normal'
  const field = operator.field as NormalizedScalarFieldDefinition

  const sourceWithNormals = direction === 'normal' && !source.normals
    ? finalizeDraft(generateNormals(cloneMeshWithoutBounds(source), { mode: 'smooth', creaseAngle: Math.PI }))
    : source

  const positions = new Float32Array(sourceWithNormals.positions.length)
  for (let index = 0; index < sourceWithNormals.positions.length; index += 3) {
    const px = sourceWithNormals.positions[index]!
    const py = sourceWithNormals.positions[index + 1]!
    const pz = sourceWithNormals.positions[index + 2]!
    const value = sampleNormalizedScalarField(field, [px, py, pz])
    const amount = value * strength
    let dx = 0, dy = 0, dz = 0
    if (direction === 'normal') {
      dx = sourceWithNormals.normals![index]!
      dy = sourceWithNormals.normals![index + 1]!
      dz = sourceWithNormals.normals![index + 2]!
    } else if (direction === 'x') dx = 1
    else if (direction === 'y') dy = 1
    else dz = 1
    positions[index] = px + dx * amount
    positions[index + 1] = py + dy * amount
    positions[index + 2] = pz + dz * amount
  }

  const displaced: GeometryMeshDraft = {
    positions,
    indices: sourceWithNormals.indices,
    ...(sourceWithNormals.uvs ? { uvs: sourceWithNormals.uvs } : {}),
    ...(sourceWithNormals.colors ? { colors: sourceWithNormals.colors } : {}),
    ...(sourceWithNormals.groups ? { groups: sourceWithNormals.groups } : {}),
  }
  let result = generateNormals(displaced, { mode: 'smooth', creaseAngle: Math.PI })
  if (source.tangents && result.uvs) result = generateTangents(result)
  return result
}

function cloneMeshWithoutBounds(source: GeometryMesh): GeometryMeshDraft {
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
function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) parameterError(path, `${path.slice(1)} must be a finite number.`)
  return Object.is(value, -0) ? 0 : value
}
function parameterError(path: string, message: string): never {
  throw new GeometryValidationError([{ code: 'GEOMETRY_PARAMETER_INVALID', path, message }])
}
