import type {
  CompiledEntityNode,
  CompiledPrimitive,
  CompiledWorld,
  ComponentQueryResult,
  WorldQueryLike,
} from '../core/types.js'

export class WorldQuery implements WorldQueryLike {
  private compiled: CompiledWorld | null = null
  private readonly componentIndex = new Map<string, ComponentQueryResult[]>()
  private readonly tagIndex = new Map<string, Set<string>>()

  update(compiled: CompiledWorld | null): void {
    this.compiled = compiled
    this.componentIndex.clear()
    this.tagIndex.clear()
    if (!compiled) return

    for (const entity of compiled.entities) {
      for (const component of entity.components ?? []) {
        const bucket = this.componentIndex.get(component.type) ?? []
        bucket.push({ entity, component })
        this.componentIndex.set(component.type, bucket)
      }
    }

    for (const primitive of compiled.primitives) {
      if (!primitive.entityId) continue
      for (const tag of primitive.tags ?? []) {
        const bucket = this.tagIndex.get(tag) ?? new Set<string>()
        bucket.add(primitive.entityId)
        this.tagIndex.set(tag, bucket)
      }
    }
  }

  entity(id: string): CompiledEntityNode | null {
    return this.compiled?.entityById.get(id) ?? this.compiled?.entityByAuthoringId.get(id) ?? null
  }

  entities(): readonly CompiledEntityNode[] {
    return this.compiled?.entities ?? []
  }

  components(type: string, options: { enabledOnly?: boolean } = {}): readonly ComponentQueryResult[] {
    const matches = this.componentIndex.get(type) ?? []
    if (options.enabledOnly ?? true) return matches.filter((match) => match.component.enabled)
    return [...matches]
  }

  tagged(tag: string): readonly CompiledEntityNode[] {
    const ids = this.tagIndex.get(tag)
    if (!ids || !this.compiled) return []
    const entities: CompiledEntityNode[] = []
    for (const id of ids) {
      const entity = this.compiled.entityById.get(id)
      if (entity) entities.push(entity)
    }
    return entities
  }

  primitives(entityId: string): readonly CompiledPrimitive[] {
    const entity = this.entity(entityId)
    if (!entity || !this.compiled) return []
    const primitives: CompiledPrimitive[] = []
    for (const id of entity.primitiveIds) {
      const primitive = this.compiled.primitiveById.get(id)
      if (primitive) primitives.push(primitive)
    }
    return primitives
  }
}
