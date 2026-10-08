import type {
  CurveResourceMap,
  ProfileResourceMap,
  ScalarFieldResourceMap,
  GeometryDefinition,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryOperator,
  GeometrySafetyLimits,
  GeometrySource,
} from '../types/index.js'
import { GeometryCache } from '../cache/GeometryCache.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import { finalizeGeometryMesh } from '../validation/validateMesh.js'
import { normalizeGeometryDefinition } from './normalizeGeometry.js'
import { hashGeometryDefinition } from './hashGeometry.js'
import { BUILTIN_GEOMETRY_KINDS } from '../primitives/index.js'
import { BUILTIN_GEOMETRY_OPERATORS } from '../operators/index.js'
import { applySurfacePolicy, normalizeSurfacePolicy } from '../attributes/surfacePolicy.js'
import { applyVertexColorPolicy, normalizeVertexColorPolicy } from '../attributes/vertexColor.js'
import { normalizeCurve } from '../curves/normalizeCurve.js'
import { normalizeProfile } from '../profiles/normalizeProfile.js'
import { normalizeScalarField } from '../fields/normalizeField.js'
import type { NormalizedScalarFieldDefinition } from '../fields/types.js'
import type { NormalizedCurveDefinition } from '../curves/types.js'
import { GeometryExtensionRegistry, assertGeometryExtensionDefinition, isNamespacedGeometryKind, splitNamespacedGeometryKind } from '../extensions/GeometryExtensionRegistry.js'
import type { GeometryExtensionProvider } from '../extensions/types.js'

export interface GeometryOperatorContext {
  readonly limits: GeometrySafetyLimits
  /** Resolve an inline or named scalar field into canonical mathematical content. */
  resolveField(input: unknown, path?: string): NormalizedScalarFieldDefinition
  /** One-based modifier depth used for safety-limit enforcement. */
  readonly modifierDepth: number
  finalizeDraft(mesh: GeometryMeshDraft): GeometryMesh
}

export interface GeometryOperatorCompiler {
  readonly kind: string
  /** Normalize one source-free operator descriptor before hashing or execution. */
  normalize?(operator: GeometryOperator, context: GeometryOperatorContext): GeometryOperator
  /** Apply one operator to an already finalized mesh. */
  apply(mesh: GeometryMesh, operator: GeometryOperator, context: GeometryOperatorContext): GeometryMeshDraft
}

export interface GeometryBuildContext {
  readonly limits: GeometrySafetyLimits
  readonly modifierDepth: number
  readonly booleanDepth: number
  /** Resolve an inline or named curve resource into the canonical evaluator vocabulary. */
  resolveCurve(input: unknown, path?: string): NormalizedCurveDefinition
  /** Resolve an inline or named profile resource into canonical winding/topology. */
  resolveProfile(input: unknown, path?: string): import('../profiles/types.js').NormalizedProfile
  /** Resolve an inline or named scalar field into canonical mathematical content. */
  resolveField(input: unknown, path?: string): NormalizedScalarFieldDefinition
  /** Compile a nested legacy modifier child and count the nesting boundary. */
  normalizeChild(definition: unknown, modifierKind: string): GeometryDefinition
  compileChild(definition: unknown, modifierKind: string): GeometryMesh
  /** Compile a container/pipeline source without treating the container itself as a modifier. */
  normalizeSource(definition: unknown): GeometryDefinition
  compileSource(definition: unknown): GeometryMesh
  /** Normalize/apply an ordered pipeline operator at its zero-based position. */
  normalizeOperator(operator: unknown, index?: number): GeometryOperator
  applyOperator(mesh: GeometryMesh, operator: unknown, index?: number): GeometryMesh
  normalizeBooleanChild(definition: unknown, booleanKind: string): GeometryDefinition
  compileBooleanChild(definition: unknown, booleanKind: string): GeometryMesh
  finalizeDraft(mesh: GeometryMeshDraft): GeometryMesh
}

/** Backward-compatible name retained for existing external kind compilers. */
export type GeometryCompileContext = GeometryBuildContext

export interface GeometryBuildResult {
  /** Fully normalized canonical source used for hashing and compilation. */
  readonly source: GeometrySource
  /** Deterministic identity of the normalized source. */
  readonly key: string
  /** Final validated renderer-neutral mesh. */
  readonly mesh: GeometryMesh
}

export interface GeometryKindCompiler {
  readonly kind: string
  /** Resolve kind-specific defaults before hashing. Explicit authored values should win. */
  normalize?(definition: GeometryDefinition, context: GeometryBuildContext): GeometryDefinition
  compile(definition: GeometryDefinition, context: GeometryBuildContext): GeometryMeshDraft
}

export interface GeometryCompilerOptions {
  kinds?: Iterable<GeometryKindCompiler>
  operators?: Iterable<GeometryOperatorCompiler>
  cache?: GeometryCache | false
  limits?: Partial<GeometrySafetyLimits>
  /** Optional named reusable curve resources available to geometry consumers such as sweep. */
  curves?: CurveResourceMap
  /** Optional named reusable profile resources available to extrude/sweep/loft. */
  profiles?: ProfileResourceMap
  /** Optional named reusable scalar-field resources available to geometry operators. */
  fields?: ScalarFieldResourceMap
  /** Trusted host-registered namespaced geometry providers. World JSON never installs providers. */
  extensions?: GeometryExtensionRegistry | Iterable<GeometryExtensionProvider>
}

export class GeometryCompiler {
  readonly #kinds = new Map<string, GeometryKindCompiler>()
  readonly #operators = new Map<string, GeometryOperatorCompiler>()
  readonly #cache?: GeometryCache
  readonly #limits: GeometrySafetyLimits
  readonly #curves: CurveResourceMap
  readonly #profiles: ProfileResourceMap
  readonly #fields: ScalarFieldResourceMap
  readonly #extensions: GeometryExtensionRegistry

  constructor(options: GeometryCompilerOptions = {}) {
    this.#limits = resolveGeometrySafetyLimits(options.limits)
    this.#curves = Object.freeze(Object.fromEntries(Object.entries(options.curves ?? {}).map(([id, definition]) => {
      if (!id.trim()) throw new Error('Geometry curve resource ids must be non-empty strings.')
      return [id, structuredClone(definition)]
    })))
    this.#profiles = Object.freeze(Object.fromEntries(Object.entries(options.profiles ?? {}).map(([id, definition]) => {
      if (!id.trim()) throw new Error('Geometry profile resource ids must be non-empty strings.')
      return [id, structuredClone(definition)]
    })))
    this.#fields = Object.freeze(Object.fromEntries(Object.entries(options.fields ?? {}).map(([id, definition]) => {
      if (!id.trim()) throw new Error('Geometry scalar-field resource ids must be non-empty strings.')
      return [id, structuredClone(definition)]
    })))
    this.#extensions = options.extensions instanceof GeometryExtensionRegistry
      ? options.extensions
      : new GeometryExtensionRegistry(options.extensions ?? [])
    this.#cache = options.cache === false ? undefined : (options.cache ?? new GeometryCache({ limits: this.#limits }))
    for (const kind of BUILTIN_GEOMETRY_KINDS) this.register(kind)
    for (const kind of options.kinds ?? []) this.register(kind)
    for (const operator of BUILTIN_GEOMETRY_OPERATORS) this.registerOperator(operator)
    for (const operator of options.operators ?? []) this.registerOperator(operator)
  }

  register(kindCompiler: GeometryKindCompiler): this {
    const kind = kindCompiler.kind.trim()
    if (!kind || isNamespacedGeometryKind(kind) || this.#kinds.has(kind)) {
      throw new Error(`Geometry compiler kind "${kind}" is invalid or already registered. Namespaced kinds must use registerExtension().`)
    }
    this.#kinds.set(kind, kindCompiler)
    return this
  }

  /** Register a trusted namespaced provider. This is a host action, never a JSON side effect. */
  registerExtension(provider: GeometryExtensionProvider): this {
    this.#extensions.register(provider)
    return this
  }

  /** Remove one trusted provider namespace. Existing JSON then fails cleanly on the next compile. */
  unregisterExtension(namespace: string): boolean {
    return this.#extensions.unregister(namespace)
  }

  get extensionRegistry(): GeometryExtensionRegistry {
    return this.#extensions
  }

  registerOperator(operatorCompiler: GeometryOperatorCompiler): this {
    const kind = operatorCompiler.kind.trim()
    if (!kind || this.#operators.has(kind)) throw new Error(`Geometry operator kind "${kind}" is invalid or already registered.`)
    this.#operators.set(kind, operatorCompiler)
    return this
  }

  normalize(definition: unknown): GeometryDefinition {
    return this.#normalizeInternal(definition, 0, 0)
  }

  #normalizeInternal(definition: unknown, modifierDepth: number, booleanDepth: number): GeometryDefinition {
    const base = normalizeGeometryDefinition(definition, { limits: this.#limits })
    const context = this.#contextFor(modifierDepth, booleanDepth)
    if (isNamespacedGeometryKind(base.kind)) {
      assertGeometryExtensionDefinition(base)
      const resolved = this.#extensions.resolve(base.kind)
      if (!resolved) {
        const parts = splitNamespacedGeometryKind(base.kind)!
        const namespaceRegistered = this.#extensions.has(parts[0])
        throw new GeometryValidationError([{
          code: namespaceRegistered ? 'GEOMETRY_EXTENSION_KIND_UNREGISTERED' : 'GEOMETRY_EXTENSION_UNREGISTERED',
          path: '/kind',
          message: namespaceRegistered
            ? `Geometry extension kind "${base.kind}" is not registered by provider "${parts[0]}".`
            : `Geometry extension provider "${parts[0]}" is not registered for kind "${base.kind}".`,
          suggestion: 'Register the trusted provider in host code before compiling or loading this geometry.',
        }])
      }
      const kindNormalized = resolved.compiler.normalize
        ? resolved.compiler.normalize(base, context)
        : base
      const normalizedExtension = normalizeGeometryDefinition(kindNormalized, { limits: this.#limits })
      assertGeometryExtensionDefinition(normalizedExtension)
      if (normalizedExtension.kind !== base.kind) {
        throw new GeometryValidationError([{
          code: 'GEOMETRY_EXTENSION_KIND_MISMATCH',
          path: '/kind',
          message: `Geometry extension normalizer for "${base.kind}" may not change the namespaced kind.`,
        }])
      }
      return normalizeGeometryDefinition(normalizeVertexColorPolicy(normalizeSurfacePolicy(normalizedExtension)), { limits: this.#limits })
    }
    const kindCompiler = this.#kinds.get(base.kind)
    if (!kindCompiler) throw new GeometryValidationError([{ code: 'GEOMETRY_KIND_UNSUPPORTED', path: '/kind', message: `Unsupported geometry kind "${base.kind}".` }])
    const kindNormalized = kindCompiler.normalize ? kindCompiler.normalize(base, context) : base
    return normalizeGeometryDefinition(normalizeVertexColorPolicy(normalizeSurfacePolicy(kindNormalized)), { limits: this.#limits })
  }

  normalizeOperator(operator: unknown): GeometryOperator {
    return this.#normalizeOperatorInternal(operator, 1)
  }

  #normalizeOperatorInternal(operator: unknown, modifierDepth: number): GeometryOperator {
    const base = normalizeGeometryDefinition(operator, { limits: this.#limits }) as GeometryOperator
    this.#assertModifierDepth(modifierDepth, base.kind)
    const operatorCompiler = this.#operators.get(base.kind)
    if (!operatorCompiler) {
      throw new GeometryValidationError([{
        code: 'GEOMETRY_OPERATOR_UNSUPPORTED',
        path: '/kind',
        message: `Unsupported geometry operator "${base.kind}".`,
      }])
    }
    const context = this.#operatorContextFor(modifierDepth)
    const normalized = operatorCompiler.normalize ? operatorCompiler.normalize(base, context) : base
    return normalizeGeometryDefinition(normalized, { limits: this.#limits }) as GeometryOperator
  }

  keyFor(definition: unknown): string {
    return hashGeometryDefinition(this.normalize(definition), { limits: this.#limits })
  }

  /**
   * Execute the canonical geometry build pipeline once and expose its normalized
   * source, deterministic identity, and final renderer-neutral mesh together.
   */
  build(definition: unknown): GeometryBuildResult {
    return this.#buildInternal(definition, 0, 0)
  }

  compile(definition: unknown): GeometryMesh {
    return this.#buildInternal(definition, 0, 0).mesh
  }

  /** Apply one normalized/normalizable source-free operator to a finalized mesh. */
  applyOperator(mesh: GeometryMesh, operator: unknown): GeometryMesh {
    return this.#applyOperatorInternal(mesh, operator, 1)
  }

  #compileInternal(definition: unknown, modifierDepth: number, booleanDepth: number): GeometryMesh {
    return this.#buildInternal(definition, modifierDepth, booleanDepth).mesh
  }

  #buildInternal(definition: unknown, modifierDepth: number, booleanDepth: number): GeometryBuildResult {
    const source = this.#normalizeInternal(definition, modifierDepth, booleanDepth)
    const key = hashGeometryDefinition(source, { limits: this.#limits })
    const cached = this.#cache?.get(source)
    if (cached) return { source, key, mesh: cached }
    const context = this.#contextFor(modifierDepth, booleanDepth)
    const compiled = isNamespacedGeometryKind(source.kind)
      ? this.#extensions.resolve(source.kind)!.compiler.compile(source as import('../extensions/types.js').GeometryExtensionDefinition, context)
      : this.#kinds.get(source.kind)!.compile(source, context)
    const colored = applyVertexColorPolicy(compiled, source)
    const finalized = finalizeGeometryMesh(applySurfacePolicy(colored, source), { limits: this.#limits })
    const mesh = this.#cache ? this.#cache.set(source, finalized) : finalized
    return { source, key, mesh }
  }

  #applyOperatorInternal(mesh: GeometryMesh, operator: unknown, modifierDepth: number): GeometryMesh {
    const normalized = this.#normalizeOperatorInternal(operator, modifierDepth)
    const operatorCompiler = this.#operators.get(normalized.kind)!
    const applied = operatorCompiler.apply(mesh, normalized, this.#operatorContextFor(modifierDepth))
    return finalizeGeometryMesh(applied, { limits: this.#limits })
  }

  #contextFor(modifierDepth: number, booleanDepth: number): GeometryBuildContext {
    return {
      limits: this.#limits,
      modifierDepth,
      resolveCurve: (input, path = '/path') => normalizeCurve(input, { limits: this.#limits, path, curves: this.#curves }),
      resolveProfile: (input, path = '/profile') => normalizeProfile(input, { limits: this.#limits, path, profiles: this.#profiles }),
      resolveField: (input, path = '/field') => normalizeScalarField(input, { limits: this.#limits, path, fields: this.#fields }),
      booleanDepth,
      normalizeChild: (definition, modifierKind) => this.#normalizeInternal(definition, this.#nextModifierDepth(modifierDepth, modifierKind), booleanDepth),
      compileChild: (definition, modifierKind) => this.#compileInternal(definition, this.#nextModifierDepth(modifierDepth, modifierKind), booleanDepth),
      normalizeSource: (definition) => this.#normalizeInternal(definition, modifierDepth, booleanDepth),
      compileSource: (definition) => this.#compileInternal(definition, modifierDepth, booleanDepth),
      normalizeOperator: (operator, index = 0) => this.#normalizeOperatorInternal(operator, this.#operatorDepth(modifierDepth, index, operator)),
      applyOperator: (mesh, operator, index = 0) => this.#applyOperatorInternal(mesh, operator, this.#operatorDepth(modifierDepth, index, operator)),
      normalizeBooleanChild: (definition, booleanKind) => this.#normalizeInternal(definition, modifierDepth, this.#nextBooleanDepth(booleanDepth, booleanKind)),
      compileBooleanChild: (definition, booleanKind) => this.#compileInternal(definition, modifierDepth, this.#nextBooleanDepth(booleanDepth, booleanKind)),
      finalizeDraft: (mesh) => finalizeGeometryMesh(mesh, { limits: this.#limits }),
    }
  }

  #operatorContextFor(modifierDepth: number): GeometryOperatorContext {
    return {
      limits: this.#limits,
      modifierDepth,
      resolveField: (input, path = '/field') => normalizeScalarField(input, { limits: this.#limits, path, fields: this.#fields }),
      finalizeDraft: (mesh) => finalizeGeometryMesh(mesh, { limits: this.#limits }),
    }
  }

  #operatorDepth(current: number, index: number, operator: unknown): number {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new GeometryValidationError([{
        code: 'GEOMETRY_PARAMETER_INVALID',
        path: '/modifiers',
        message: 'Geometry operator index must be a non-negative safe integer.',
      }])
    }
    const kind = operator && typeof operator === 'object' && !Array.isArray(operator) && typeof (operator as { kind?: unknown }).kind === 'string'
      ? (operator as { kind: string }).kind
      : 'operator'
    const next = current + index + 1
    this.#assertModifierDepth(next, kind)
    return next
  }

  #assertModifierDepth(depth: number, modifierKind: string): void {
    if (depth > this.#limits.maxModifierDepth) {
      throw new GeometryValidationError([{
        code: 'GEOMETRY_MODIFIER_LIMIT',
        path: '/modifiers',
        message: `Geometry modifier nesting exceeds maxModifierDepth ${this.#limits.maxModifierDepth}.`,
        suggestion: `Flatten the ${modifierKind} operator stack or increase the explicit safety limit.`,
      }])
    }
  }

  #nextBooleanDepth(current: number, booleanKind: string): number {
    const next = current + 1
    if (next > this.#limits.maxBooleanDepth) {
      throw new GeometryValidationError([{
        code: 'CSG_DEPTH_LIMIT', path: '/left',
        message: `Boolean geometry nesting exceeds maxBooleanDepth ${this.#limits.maxBooleanDepth}.`,
        suggestion: `Flatten nested ${booleanKind} operations or increase the explicit maxBooleanDepth safety limit.`,
      }])
    }
    return next
  }

  #nextModifierDepth(current: number, modifierKind: string): number {
    const next = current + 1
    if (next > this.#limits.maxModifierDepth) {
      throw new GeometryValidationError([{
        code: 'GEOMETRY_MODIFIER_LIMIT', path: '/source',
        message: `Geometry modifier nesting exceeds maxModifierDepth ${this.#limits.maxModifierDepth}.`,
        suggestion: `Flatten nested ${modifierKind} modifiers or increase the explicit safety limit.`,
      }])
    }
    return next
  }
}

export function createGeometryCompiler(options: GeometryCompilerOptions = {}): GeometryCompiler {
  return new GeometryCompiler(options)
}

/** Build normalized source, deterministic identity, and mesh through one canonical pipeline. */
export function buildGeometry(definition: unknown, options: GeometryCompilerOptions = {}): GeometryBuildResult {
  return createGeometryCompiler(options).build(definition)
}

/** Compile a built-in geometry expression or an explicitly registered extension kind. */
export function compileGeometry(definition: unknown, options: GeometryCompilerOptions = {}): GeometryMesh {
  return createGeometryCompiler(options).compile(definition)
}

/** Apply one source-free geometry operator to an already finalized mesh. */
export function applyGeometryOperator(mesh: GeometryMesh, operator: unknown, options: GeometryCompilerOptions = {}): GeometryMesh {
  return createGeometryCompiler(options).applyOperator(mesh, operator)
}
