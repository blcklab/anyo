import type { GeometryDefinition, GeometryMesh, GeometryMeshDraft, GeometrySafetyLimits, GeometrySource } from '../types/index.js'
import { GeometryCache } from '../cache/GeometryCache.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import { finalizeGeometryMesh } from '../validation/validateMesh.js'
import { normalizeGeometryDefinition } from './normalizeGeometry.js'
import { hashGeometryDefinition } from './hashGeometry.js'
import { BUILTIN_GEOMETRY_KINDS } from '../primitives/index.js'
import { applySurfacePolicy, normalizeSurfacePolicy } from '../attributes/surfacePolicy.js'
import { applyVertexColorPolicy, normalizeVertexColorPolicy } from '../attributes/vertexColor.js'

export interface GeometryBuildContext {
  readonly limits: GeometrySafetyLimits
  readonly modifierDepth: number
  readonly booleanDepth: number
  normalizeChild(definition: unknown, modifierKind: string): GeometryDefinition
  compileChild(definition: unknown, modifierKind: string): GeometryMesh
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
  cache?: GeometryCache | false
  limits?: Partial<GeometrySafetyLimits>
}

export class GeometryCompiler {
  readonly #kinds = new Map<string, GeometryKindCompiler>()
  readonly #cache?: GeometryCache
  readonly #limits: GeometrySafetyLimits

  constructor(options: GeometryCompilerOptions = {}) {
    this.#limits = resolveGeometrySafetyLimits(options.limits)
    this.#cache = options.cache === false ? undefined : (options.cache ?? new GeometryCache({ limits: this.#limits }))
    for (const kind of BUILTIN_GEOMETRY_KINDS) this.register(kind)
    for (const kind of options.kinds ?? []) this.register(kind)
  }

  register(kindCompiler: GeometryKindCompiler): this {
    const kind = kindCompiler.kind.trim()
    if (!kind || this.#kinds.has(kind)) throw new Error(`Geometry compiler kind "${kind}" is invalid or already registered.`)
    this.#kinds.set(kind, kindCompiler)
    return this
  }

  normalize(definition: unknown): GeometryDefinition {
    return this.#normalizeInternal(definition, 0, 0)
  }

  #normalizeInternal(definition: unknown, modifierDepth: number, booleanDepth: number): GeometryDefinition {
    const base = normalizeGeometryDefinition(definition, { limits: this.#limits })
    const kindCompiler = this.#kinds.get(base.kind)
    if (!kindCompiler) throw new GeometryValidationError([{ code: 'GEOMETRY_KIND_UNSUPPORTED', path: '/kind', message: `Unsupported geometry kind "${base.kind}".` }])
    const context = this.#contextFor(modifierDepth, booleanDepth)
    const kindNormalized = kindCompiler.normalize ? kindCompiler.normalize(base, context) : base
    return normalizeGeometryDefinition(normalizeVertexColorPolicy(normalizeSurfacePolicy(kindNormalized)), { limits: this.#limits })
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

  #compileInternal(definition: unknown, modifierDepth: number, booleanDepth: number): GeometryMesh {
    return this.#buildInternal(definition, modifierDepth, booleanDepth).mesh
  }

  #buildInternal(definition: unknown, modifierDepth: number, booleanDepth: number): GeometryBuildResult {
    const source = this.#normalizeInternal(definition, modifierDepth, booleanDepth)
    const key = hashGeometryDefinition(source, { limits: this.#limits })
    const cached = this.#cache?.get(source)
    if (cached) return { source, key, mesh: cached }
    const kindCompiler = this.#kinds.get(source.kind)!
    const compiled = kindCompiler.compile(source, this.#contextFor(modifierDepth, booleanDepth))
    const colored = applyVertexColorPolicy(compiled, source)
    const finalized = finalizeGeometryMesh(applySurfacePolicy(colored, source), { limits: this.#limits })
    const mesh = this.#cache ? this.#cache.set(source, finalized) : finalized
    return { source, key, mesh }
  }

  #contextFor(modifierDepth: number, booleanDepth: number): GeometryBuildContext {
    return {
      limits: this.#limits,
      modifierDepth,
      booleanDepth,
      normalizeChild: (definition, modifierKind) => this.#normalizeInternal(definition, this.#nextModifierDepth(modifierDepth, modifierKind), booleanDepth),
      compileChild: (definition, modifierKind) => this.#compileInternal(definition, this.#nextModifierDepth(modifierDepth, modifierKind), booleanDepth),
      normalizeBooleanChild: (definition, booleanKind) => this.#normalizeInternal(definition, modifierDepth, this.#nextBooleanDepth(booleanDepth, booleanKind)),
      compileBooleanChild: (definition, booleanKind) => this.#compileInternal(definition, modifierDepth, this.#nextBooleanDepth(booleanDepth, booleanKind)),
      finalizeDraft: (mesh) => finalizeGeometryMesh(mesh, { limits: this.#limits }),
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
