import type { GeometryDefinition, GeometryJsonValue, GeometryMesh, MeshGeometryDefinition } from '../types/index.js'
import { isNamespacedGeometryKind } from './GeometryExtensionRegistry.js'

/** True when any nested JSON geometry definition contains a namespaced extension kind. */
export function containsGeometryExtension(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsGeometryExtension)
  const record = value as Record<string, unknown>
  if (typeof record.kind === 'string' && isNamespacedGeometryKind(record.kind)) return true
  return Object.values(record).some(containsGeometryExtension)
}

/** Lower a finalized renderer-neutral mesh back into the built-in JSON `mesh` source. */
export function geometryMeshToDefinition(mesh: GeometryMesh): MeshGeometryDefinition {
  const attributes: Record<string, GeometryJsonValue> = Object.create(null)
  if (mesh.normals) attributes.normals = Array.from(mesh.normals)
  if (mesh.uvs) attributes.uvs = Array.from(mesh.uvs)
  if (mesh.tangents) attributes.tangents = Array.from(mesh.tangents)
  if (mesh.colors) attributes.colors = Array.from(mesh.colors)
  const definition: MeshGeometryDefinition = {
    kind: 'mesh',
    positions: Array.from(mesh.positions),
    indices: Array.from(mesh.indices),
  }
  if (Object.keys(attributes).length > 0) definition.attributes = attributes
  if (mesh.groups?.length) definition.groups = mesh.groups.map((group) => ({ ...group }))
  return definition
}

/** Bake any extension-containing expression into ordinary indexed mesh authoring. */
export function lowerGeometryExtensions(definition: GeometryDefinition, compile: (definition: GeometryDefinition) => GeometryMesh): GeometryDefinition {
  if (!containsGeometryExtension(definition)) return definition
  return geometryMeshToDefinition(compile(definition))
}
