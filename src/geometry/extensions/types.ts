import type { GeometryBuildContext } from '../core/GeometryCompiler.js'
import type { GeometryDefinition, GeometryJsonValue, GeometryMeshDraft } from '../types/index.js'

/** Canonical lowercase namespace used by trusted geometry providers. */
export type GeometryExtensionNamespace = string

/** Generic JSON-safe namespaced geometry authoring surface. */
export interface GeometryExtensionDefinition extends GeometryDefinition {
  kind: `${string}:${string}`
  params?: { [key: string]: GeometryJsonValue | undefined }
}

/** One provider-owned geometry algorithm. The full kind is `${namespace}:${name}`. */
export interface GeometryExtensionKindCompiler {
  readonly name: string
  normalize?(definition: GeometryExtensionDefinition, context: GeometryBuildContext): GeometryExtensionDefinition
  compile(definition: GeometryExtensionDefinition, context: GeometryBuildContext): GeometryMeshDraft
}

/**
 * Trusted host-registered geometry provider. World JSON can reference its namespaced
 * kinds, but JSON never imports packages or executes source code itself.
 */
export interface GeometryExtensionProvider {
  readonly namespace: GeometryExtensionNamespace
  /** Stable provider/build version for diagnostics. Identity integration is finalized in Step 9. */
  readonly version?: string
  readonly kinds: Iterable<GeometryExtensionKindCompiler>
}

export interface GeometryExtensionProviderSnapshot {
  readonly namespace: GeometryExtensionNamespace
  readonly version?: string
  readonly kinds: readonly string[]
}

export interface ResolvedGeometryExtensionKind {
  readonly namespace: GeometryExtensionNamespace
  readonly version?: string
  readonly kind: string
  readonly compiler: GeometryExtensionKindCompiler
}
