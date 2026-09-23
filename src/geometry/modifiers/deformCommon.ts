import type { GeometryDefinition, GeometryIssue, GeometryMesh, GeometryMeshDraft } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { generateNormals } from '../attributes/normals.js'
import { generateTangents } from '../attributes/tangents.js'

export type GeometryAxis = 'x' | 'y' | 'z'

export function requireGeometrySource(value: unknown, path = '/source'): GeometryDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) parameterError(path, `${path.slice(1)} must be a geometry definition object.`)
  return value as GeometryDefinition
}

export function normalizeAxis(value: unknown, path = '/axis', fallback: GeometryAxis = 'y'): GeometryAxis {
  const axis = value ?? fallback
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') parameterError(path, `${path.slice(1)} must be x, y, or z.`)
  return axis
}

export function finiteNumber(value: unknown, path: string, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) parameterError(path, `${label} must be a finite number.`)
  return value
}

export function nonNegativeNumber(value: unknown, path: string, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) parameterError(path, `${label} must be a finite number greater than or equal to zero.`)
  return value
}

export function axisIndex(axis: GeometryAxis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2
}

export function axisExtent(mesh: GeometryMesh, axis: GeometryAxis): { min: number; max: number; extent: number } {
  const index = axisIndex(axis)
  const min = mesh.bounds.min[index]
  const max = mesh.bounds.max[index]
  return { min, max, extent: max - min }
}

export function perpendicularAxes(axis: GeometryAxis): readonly [0 | 1 | 2, 0 | 1 | 2] {
  if (axis === 'x') return [1, 2]
  if (axis === 'y') return [0, 2]
  return [0, 1]
}

export function cloneMeshWithoutBounds(source: GeometryMesh): GeometryMeshDraft {
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

export function deformGeometryMesh(
  source: GeometryMesh,
  map: (position: readonly [number, number, number], vertexIndex: number) => readonly [number, number, number],
): GeometryMeshDraft {
  const positions = new Float32Array(source.positions.length)
  for (let vertex = 0; vertex < source.positions.length / 3; vertex += 1) {
    const offset = vertex * 3
    const mapped = map([source.positions[offset]!, source.positions[offset + 1]!, source.positions[offset + 2]!], vertex)
    if (!mapped.every(Number.isFinite)) parameterError('/source', 'deformation produced a non-finite vertex position.')
    positions[offset] = mapped[0]
    positions[offset + 1] = mapped[1]
    positions[offset + 2] = mapped[2]
  }
  const draft: GeometryMeshDraft = {
    positions,
    indices: source.indices,
    ...(source.uvs ? { uvs: source.uvs } : {}),
    ...(source.colors ? { colors: source.colors } : {}),
    ...(source.groups ? { groups: source.groups } : {}),
  }
  let repaired = generateNormals(draft, { mode: 'smooth', creaseAngle: Math.PI })
  if (source.tangents && repaired.uvs) repaired = generateTangents(repaired)
  return repaired
}

export function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}
