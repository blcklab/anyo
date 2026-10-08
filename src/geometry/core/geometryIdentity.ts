import type { GeometryDefinition, GeometrySource } from '../types/index.js'
import { isNamespacedGeometryKind } from '../extensions/GeometryExtensionRegistry.js'
import type { GeometryExtensionRegistry } from '../extensions/GeometryExtensionRegistry.js'

/**
 * Stable semantic ABI for deterministic geometry builds. Bump only when the
 * same canonical source is intentionally allowed to compile to different mesh
 * semantics across Anyo releases.
 */
export const GEOMETRY_BUILD_ABI = 'anyo.geometry/1' as const

export interface GeometryExtensionBuildProvenance {
  readonly namespace: string
  readonly version: string | null
  readonly kinds: readonly string[]
}

export interface GeometryBuildIdentity {
  readonly abi: typeof GEOMETRY_BUILD_ABI
  readonly source: GeometrySource
  readonly extensions: readonly GeometryExtensionBuildProvenance[]
}

function geometryChildren(definition: GeometryDefinition): readonly GeometryDefinition[] {
  if (
    definition.kind === 'pipeline' || definition.kind === 'transform' || definition.kind === 'mirror'
    || definition.kind === 'noise' || definition.kind === 'bend' || definition.kind === 'twist'
    || definition.kind === 'taper'
  ) {
    const source = definition.source
    return source && typeof source === 'object' && !Array.isArray(source)
      ? [source as GeometryDefinition]
      : []
  }
  if (definition.kind === 'union' || definition.kind === 'subtract' || definition.kind === 'intersect') {
    const children: GeometryDefinition[] = []
    if (definition.left && typeof definition.left === 'object' && !Array.isArray(definition.left)) children.push(definition.left as GeometryDefinition)
    if (definition.right && typeof definition.right === 'object' && !Array.isArray(definition.right)) children.push(definition.right as GeometryDefinition)
    return children
  }
  return []
}

/**
 * Collect trusted executable provenance only from actual geometry boundaries.
 * Provider-specific params stay opaque JSON; the provider version owns their
 * executable interpretation.
 */
export function collectGeometryExtensionProvenance(
  source: GeometryDefinition,
  registry: GeometryExtensionRegistry,
): readonly GeometryExtensionBuildProvenance[] {
  const providers = new Map<string, { version: string | null; kinds: Set<string> }>()
  const visit = (definition: GeometryDefinition): void => {
    if (isNamespacedGeometryKind(definition.kind)) {
      const resolved = registry.resolve(definition.kind)
      if (resolved) {
        let provider = providers.get(resolved.namespace)
        if (!provider) {
          provider = { version: resolved.version ?? null, kinds: new Set<string>() }
          providers.set(resolved.namespace, provider)
        }
        provider.kinds.add(resolved.kind)
      }
    }
    for (const child of geometryChildren(definition)) visit(child)
  }
  visit(source)
  return Object.freeze([...providers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, provider]) => Object.freeze({
      namespace,
      version: provider.version,
      kinds: Object.freeze([...provider.kinds].sort()),
    })))
}

export function createGeometryBuildIdentity(
  source: GeometrySource,
  registry: GeometryExtensionRegistry,
): GeometryBuildIdentity {
  return Object.freeze({
    abi: GEOMETRY_BUILD_ABI,
    source,
    extensions: collectGeometryExtensionProvenance(source, registry),
  })
}
