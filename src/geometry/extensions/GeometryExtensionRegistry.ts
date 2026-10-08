import { GeometryValidationError } from '../validation/errors.js'
import type { GeometryDefinition, GeometryIssueCode } from '../types/index.js'
import type {
  GeometryExtensionDefinition,
  GeometryExtensionKindCompiler,
  GeometryExtensionProvider,
  GeometryExtensionProviderSnapshot,
  ResolvedGeometryExtensionKind,
} from './types.js'

export const GEOMETRY_EXTENSION_NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
export const GEOMETRY_EXTENSION_KIND_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
export const GEOMETRY_NAMESPACED_KIND_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

const EXTENSION_ROOT_FIELDS = new Set(['kind', 'params', 'quality', 'normals', 'uv', 'tangents', 'vertexColor'])

interface RegisteredProvider {
  readonly namespace: string
  readonly version?: string
  readonly kinds: ReadonlyMap<string, GeometryExtensionKindCompiler>
}

function extensionError(code: GeometryIssueCode, path: string, message: string, suggestion?: string): never {
  throw new GeometryValidationError([{ code, path, message, ...(suggestion ? { suggestion } : {}) }])
}

function validateNamespace(namespace: unknown): string {
  if (typeof namespace !== 'string' || !GEOMETRY_EXTENSION_NAMESPACE_PATTERN.test(namespace)) {
    extensionError(
      'GEOMETRY_EXTENSION_NAMESPACE_INVALID',
      '/namespace',
      `Geometry extension namespace must match ${GEOMETRY_EXTENSION_NAMESPACE_PATTERN}.`,
    )
  }
  return namespace
}

function validateKindName(name: unknown): string {
  if (typeof name !== 'string' || !GEOMETRY_EXTENSION_KIND_NAME_PATTERN.test(name)) {
    extensionError(
      'GEOMETRY_EXTENSION_KIND_INVALID',
      '/kinds/name',
      `Geometry extension kind names must match ${GEOMETRY_EXTENSION_KIND_NAME_PATTERN}.`,
    )
  }
  return name
}

export function splitNamespacedGeometryKind(kind: string): readonly [namespace: string, name: string] | undefined {
  if (!GEOMETRY_NAMESPACED_KIND_PATTERN.test(kind)) return undefined
  const separator = kind.indexOf(':')
  return [kind.slice(0, separator), kind.slice(separator + 1)] as const
}

export function isNamespacedGeometryKind(kind: string): boolean {
  return splitNamespacedGeometryKind(kind) !== undefined
}

/** Enforce the stable code-free JSON envelope used by namespaced extension kinds. */
export function assertGeometryExtensionDefinition(definition: GeometryDefinition): asserts definition is GeometryExtensionDefinition {
  if (!isNamespacedGeometryKind(definition.kind)) {
    extensionError('GEOMETRY_EXTENSION_KIND_INVALID', '/kind', `Geometry extension kind "${definition.kind}" must be namespaced as "namespace:name".`)
  }
  for (const key of Object.keys(definition)) {
    if (!EXTENSION_ROOT_FIELDS.has(key)) {
      extensionError(
        'GEOMETRY_EXTENSION_FIELD_INVALID',
        `/${key}`,
        `Namespaced geometry extensions may not author root field "${key}".`,
        `Move provider-specific JSON data under /params/${key}.`,
      )
    }
  }
  if (definition.params !== undefined && (definition.params === null || Array.isArray(definition.params) || typeof definition.params !== 'object')) {
    extensionError('GEOMETRY_EXTENSION_PARAMS_INVALID', '/params', 'Geometry extension params must be a JSON object when provided.')
  }
}

/** Mutable trusted-host registry. Register/unregister never occurs implicitly from world JSON. */
export class GeometryExtensionRegistry {
  readonly #providers = new Map<string, RegisteredProvider>()

  constructor(providers: Iterable<GeometryExtensionProvider> = []) {
    for (const provider of providers) this.register(provider)
  }

  register(provider: GeometryExtensionProvider): this {
    const namespace = validateNamespace(provider.namespace)
    if (this.#providers.has(namespace)) {
      extensionError('GEOMETRY_EXTENSION_NAMESPACE_CONFLICT', '/namespace', `Geometry extension namespace "${namespace}" is already registered.`)
    }
    if (provider.version !== undefined && (typeof provider.version !== 'string' || provider.version.trim().length === 0)) {
      extensionError('GEOMETRY_EXTENSION_VERSION_INVALID', '/version', 'Geometry extension provider version must be a non-empty string when provided.')
    }
    const kinds = new Map<string, GeometryExtensionKindCompiler>()
    for (const compiler of provider.kinds) {
      const name = validateKindName(compiler.name)
      if (kinds.has(name)) {
        extensionError('GEOMETRY_EXTENSION_KIND_CONFLICT', '/kinds', `Geometry extension kind "${namespace}:${name}" is registered more than once by the provider.`)
      }
      if (typeof compiler.compile !== 'function') {
        extensionError('GEOMETRY_EXTENSION_KIND_INVALID', `/kinds/${name}`, `Geometry extension kind "${namespace}:${name}" must provide compile().`)
      }
      kinds.set(name, compiler)
    }
    if (kinds.size === 0) {
      extensionError('GEOMETRY_EXTENSION_PROVIDER_EMPTY', '/kinds', `Geometry extension provider "${namespace}" must register at least one kind.`)
    }
    this.#providers.set(namespace, Object.freeze({
      namespace,
      ...(provider.version !== undefined ? { version: provider.version } : {}),
      kinds,
    }))
    return this
  }

  unregister(namespace: string): boolean {
    return this.#providers.delete(namespace)
  }

  has(namespace: string): boolean {
    return this.#providers.has(namespace)
  }

  hasKind(kind: string): boolean {
    return this.resolve(kind) !== undefined
  }

  resolve(kind: string): ResolvedGeometryExtensionKind | undefined {
    const parts = splitNamespacedGeometryKind(kind)
    if (!parts) return undefined
    const [namespace, name] = parts
    const provider = this.#providers.get(namespace)
    const compiler = provider?.kinds.get(name)
    if (!provider || !compiler) return undefined
    return Object.freeze({
      namespace,
      ...(provider.version !== undefined ? { version: provider.version } : {}),
      kind,
      compiler,
    })
  }

  list(): readonly GeometryExtensionProviderSnapshot[] {
    return Object.freeze([...this.#providers.values()]
      .sort((a, b) => a.namespace.localeCompare(b.namespace))
      .map((provider) => Object.freeze({
        namespace: provider.namespace,
        ...(provider.version !== undefined ? { version: provider.version } : {}),
        kinds: Object.freeze([...provider.kinds.keys()].sort()),
      })))
  }
}
