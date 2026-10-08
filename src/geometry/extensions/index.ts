export {
  GeometryExtensionRegistry,
  GEOMETRY_EXTENSION_KIND_NAME_PATTERN,
  GEOMETRY_EXTENSION_NAMESPACE_PATTERN,
  GEOMETRY_NAMESPACED_KIND_PATTERN,
  assertGeometryExtensionDefinition,
  isNamespacedGeometryKind,
  splitNamespacedGeometryKind,
} from './GeometryExtensionRegistry.js'
export type {
  GeometryExtensionDefinition,
  GeometryExtensionKindCompiler,
  GeometryExtensionNamespace,
  GeometryExtensionProvider,
  GeometryExtensionProviderSnapshot,
  ResolvedGeometryExtensionKind,
} from './types.js'
export { containsGeometryExtension, geometryMeshToDefinition, lowerGeometryExtensions } from './lower.js'
