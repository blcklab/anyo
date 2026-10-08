import type { GeometryDefinition, GeometryMesh, GeometrySafetyLimits } from '../types/index.js'
import { hashGeometryDefinition } from '../core/hashGeometry.js'
import { finalizeGeometryMesh } from '../validation/validateMesh.js'

export class GeometryCache {
  readonly #entries = new Map<string, GeometryMesh>()
  readonly #limits?: Partial<GeometrySafetyLimits>

  constructor(options: { limits?: Partial<GeometrySafetyLimits> } = {}) {
    this.#limits = options.limits
  }

  get size(): number { return this.#entries.size }

  /** Legacy pure-definition cache key retained for direct cache consumers. */
  keyFor(definition: GeometryDefinition): string {
    return hashGeometryDefinition(definition, { limits: this.#limits })
  }

  hasKey(key: string): boolean { return this.#entries.has(key) }
  getByKey(key: string): GeometryMesh | undefined { return this.#entries.get(key) }

  setByKey(key: string, mesh: GeometryMesh): GeometryMesh {
    const validated = finalizeGeometryMesh(mesh, { limits: this.#limits })
    this.#entries.set(key, validated)
    return validated
  }

  getOrCreateByKey(key: string, create: () => GeometryMesh): GeometryMesh {
    const existing = this.#entries.get(key)
    if (existing) return existing
    return this.setByKey(key, create())
  }

  deleteByKey(key: string): boolean { return this.#entries.delete(key) }

  has(definition: GeometryDefinition): boolean { return this.hasKey(this.keyFor(definition)) }
  get(definition: GeometryDefinition): GeometryMesh | undefined { return this.getByKey(this.keyFor(definition)) }

  set(definition: GeometryDefinition, mesh: GeometryMesh): GeometryMesh {
    return this.setByKey(this.keyFor(definition), mesh)
  }

  getOrCreate(definition: GeometryDefinition, create: () => GeometryMesh): GeometryMesh {
    return this.getOrCreateByKey(this.keyFor(definition), create)
  }

  delete(definition: GeometryDefinition): boolean { return this.deleteByKey(this.keyFor(definition)) }
  clear(): void { this.#entries.clear() }
}
