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

  keyFor(definition: GeometryDefinition): string {
    return hashGeometryDefinition(definition, { limits: this.#limits })
  }

  has(definition: GeometryDefinition): boolean { return this.#entries.has(this.keyFor(definition)) }
  get(definition: GeometryDefinition): GeometryMesh | undefined { return this.#entries.get(this.keyFor(definition)) }

  set(definition: GeometryDefinition, mesh: GeometryMesh): GeometryMesh {
    const validated = finalizeGeometryMesh(mesh, { limits: this.#limits })
    this.#entries.set(this.keyFor(definition), validated)
    return validated
  }

  getOrCreate(definition: GeometryDefinition, create: () => GeometryMesh): GeometryMesh {
    const key = this.keyFor(definition)
    const existing = this.#entries.get(key)
    if (existing) return existing
    const mesh = finalizeGeometryMesh(create(), { limits: this.#limits })
    this.#entries.set(key, mesh)
    return mesh
  }

  delete(definition: GeometryDefinition): boolean { return this.#entries.delete(this.keyFor(definition)) }
  clear(): void { this.#entries.clear() }
}
