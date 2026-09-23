import type { GeometryInspectionResult, GeometryIssue, GeometryMesh, GeometryMeshDraft, GeometrySafetyLimits } from '../types/index.js'
import { computeGeometryBounds } from '../bounds/computeBounds.js'
import { GeometryValidationError } from './errors.js'
import { resolveGeometrySafetyLimits } from './limits.js'

function finiteArray(values: Float32Array, path: string, issues: GeometryIssue[]): void {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index]!)) {
      issues.push({ code: 'GEOMETRY_MESH_INVALID', path: `${path}/${index}`, message: `${path.slice(1)} must contain only finite numbers.` })
      return
    }
  }
}

export function inspectGeometryMesh(
  mesh: GeometryMeshDraft,
  options: { limits?: Partial<GeometrySafetyLimits> } = {},
): GeometryInspectionResult<GeometryMesh> {
  const limits = resolveGeometrySafetyLimits(options.limits)
  const issues: GeometryIssue[] = []
  if (!(mesh.positions instanceof Float32Array) || mesh.positions.length === 0 || mesh.positions.length % 3 !== 0) {
    issues.push({ code: 'GEOMETRY_MESH_INVALID', path: '/positions', message: 'Positions must be a non-empty Float32Array with xyz layout.' })
  }
  if (!(mesh.indices instanceof Uint16Array) && !(mesh.indices instanceof Uint32Array)) {
    issues.push({ code: 'GEOMETRY_MESH_INVALID', path: '/indices', message: 'Indices must be Uint16Array or Uint32Array.' })
  } else if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    issues.push({ code: 'GEOMETRY_MESH_INVALID', path: '/indices', message: 'Indices must describe a non-empty triangle list.' })
  }
  const vertexCount = Math.floor(mesh.positions.length / 3)
  if (vertexCount > limits.maxGeometryVertices) issues.push({ code: 'GEOMETRY_MESH_LIMIT', path: '/positions', message: `Mesh exceeds ${limits.maxGeometryVertices} vertices.` })
  if (mesh.indices.length > limits.maxGeometryIndices) issues.push({ code: 'GEOMETRY_MESH_LIMIT', path: '/indices', message: `Mesh exceeds ${limits.maxGeometryIndices} indices.` })
  finiteArray(mesh.positions, '/positions', issues)
  const attributes: Array<[Float32Array | undefined, number, string]> = [
    [mesh.normals, 3, '/normals'], [mesh.uvs, 2, '/uvs'], [mesh.tangents, 4, '/tangents'], [mesh.colors, 4, '/colors'],
  ]
  for (const [attribute, width, path] of attributes) {
    if (!attribute) continue
    if (!(attribute instanceof Float32Array) || attribute.length !== vertexCount * width) {
      issues.push({ code: 'GEOMETRY_ATTRIBUTE_LENGTH_INVALID', path, message: `${path.slice(1)} must contain ${width} values per vertex.` })
      continue
    }
    finiteArray(attribute, path, issues)
  }
  if (mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array) {
    for (let index = 0; index < mesh.indices.length; index += 1) {
      if (mesh.indices[index]! >= vertexCount) {
        issues.push({ code: 'GEOMETRY_INDEX_OUT_OF_RANGE', path: `/indices/${index}`, message: `Index ${mesh.indices[index]} is outside ${vertexCount} vertices.` })
        break
      }
    }
  }
  for (let index = 0; index < (mesh.groups?.length ?? 0); index += 1) {
    const group = mesh.groups![index]!
    if (!Number.isSafeInteger(group.start) || !Number.isSafeInteger(group.count) || !Number.isSafeInteger(group.materialIndex) || group.start < 0 || group.count <= 0 || group.materialIndex < 0 || group.start % 3 !== 0 || group.count % 3 !== 0 || group.start + group.count > mesh.indices.length) {
      issues.push({ code: 'GEOMETRY_GROUP_INVALID', path: `/groups/${index}`, message: 'Geometry groups must be non-negative triangle-aligned index ranges with a valid materialIndex.' })
    }
  }
  if (issues.length > 0) return { valid: false, issues }
  const bounds = mesh.bounds ?? computeGeometryBounds(mesh.positions)
  return { valid: true, value: { ...mesh, bounds }, issues }
}

export function finalizeGeometryMesh(
  mesh: GeometryMeshDraft,
  options: { limits?: Partial<GeometrySafetyLimits> } = {},
): GeometryMesh {
  const result = inspectGeometryMesh(mesh, options)
  if (!result.valid || !result.value) throw new GeometryValidationError(result.issues)
  return result.value
}
