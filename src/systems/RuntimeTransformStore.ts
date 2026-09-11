import type {
  CompiledEntityNode,
  CompiledPrimitive,
  CompiledWorld,
  Euler,
  Quaternion,
  RuntimeTransformInput,
  RuntimeTransformLayerSnapshot,
  RuntimeTransformMode,
  RuntimeTransformSpace,
  RuntimeTransformStoreLike,
  RuntimeTransformUpdate,
  RuntimeTransformWriteOptions,
  TransformDefinition,
  Vec3,
} from '../core/types.js'
import { decomposeMatrix4, invertMatrix4, multiplyMatrix4 } from '../math/matrix4.js'
import {
  eulerXYZFromQuaternion,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternionFromEulerXYZ,
} from '../math/quaternion.js'
import { composeTransforms, finalizeTransform, type ComposableTransform } from '../math/transform.js'

interface RuntimeTransformLayer {
  source: string
  priority: number
  mode: RuntimeTransformMode
  space: RuntimeTransformSpace
  transform: RuntimeTransformInput
}

function cloneVec3(value: Vec3 | undefined): Vec3 | undefined {
  return value ? [value[0], value[1], value[2]] : undefined
}

function cloneQuaternion(value: Quaternion | undefined): Quaternion | undefined {
  return value ? [value[0], value[1], value[2], value[3]] : undefined
}

function cloneInput(value: RuntimeTransformInput): RuntimeTransformInput {
  return {
    position: cloneVec3(value.position),
    rotation: cloneVec3(value.rotation) as Euler | undefined,
    quaternion: cloneQuaternion(value.quaternion),
    scale: cloneVec3(value.scale),
  }
}

function finiteTuple(value: readonly number[] | undefined, length: number, name: string): void {
  if (value === undefined) return
  if (value.length !== length || value.some((number) => !Number.isFinite(number))) {
    throw new Error(`Runtime transform ${name} must contain ${length} finite numbers.`)
  }
}

function validateInput(value: RuntimeTransformInput): void {
  finiteTuple(value.position, 3, 'position')
  finiteTuple(value.rotation, 3, 'rotation')
  finiteTuple(value.quaternion, 4, 'quaternion')
  finiteTuple(value.scale, 3, 'scale')
  if (value.rotation && value.quaternion) {
    throw new Error('Runtime transforms cannot set both rotation and quaternion in one layer.')
  }
}

function sameTuple(left: readonly number[] | undefined, right: readonly number[] | undefined): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function sameInput(left: RuntimeTransformInput, right: RuntimeTransformInput): boolean {
  return (
    sameTuple(left.position, right.position) &&
    sameTuple(left.rotation, right.rotation) &&
    sameTuple(left.quaternion, right.quaternion) &&
    sameTuple(left.scale, right.scale)
  )
}

function asComposable(transform: TransformDefinition): ComposableTransform {
  return {
    position: transform.position,
    rotation: transform.rotation,
    quaternion: transform.quaternion ?? quaternionFromEulerXYZ(transform.rotation),
    scale: transform.scale,
  }
}

function applyLayer(current: ComposableTransform, layer: RuntimeTransformLayer): ComposableTransform {
  const value = layer.transform
  if (layer.mode === 'override') {
    const quaternion = value.quaternion
      ? normalizeQuaternion(value.quaternion)
      : value.rotation
        ? quaternionFromEulerXYZ(value.rotation)
        : current.quaternion
    return {
      position: value.position ?? current.position,
      rotation: value.rotation ?? (value.quaternion ? eulerXYZFromQuaternion(quaternion) : current.rotation),
      quaternion,
      scale: value.scale ?? current.scale,
    }
  }

  const additiveQuaternion = value.quaternion
    ? normalizeQuaternion(value.quaternion)
    : quaternionFromEulerXYZ(value.rotation ?? [0, 0, 0])
  const quaternion = multiplyQuaternions(current.quaternion, additiveQuaternion)
  return {
    position: [
      current.position[0] + (value.position?.[0] ?? 0),
      current.position[1] + (value.position?.[1] ?? 0),
      current.position[2] + (value.position?.[2] ?? 0),
    ],
    rotation: eulerXYZFromQuaternion(quaternion),
    quaternion,
    scale: [
      current.scale[0] * (value.scale?.[0] ?? 1),
      current.scale[1] * (value.scale?.[1] ?? 1),
      current.scale[2] * (value.scale?.[2] ?? 1),
    ],
  }
}

function sortLayers(layers: Iterable<RuntimeTransformLayer>): RuntimeTransformLayer[] {
  return [...layers].sort((left, right) => (
    left.priority - right.priority || left.source.localeCompare(right.source)
  ))
}

function relativeComposable(parent: ComposableTransform, world: ComposableTransform): ComposableTransform {
  try {
    const parentTransform = finalizeTransform(parent)
    const worldTransform = finalizeTransform(world)
    if (!parentTransform.matrix || !worldTransform.matrix) return world
    return asComposable(decomposeMatrix4(multiplyMatrix4(invertMatrix4(parentTransform.matrix), worldTransform.matrix)))
  } catch {
    return world
  }
}

function inferredStaticParent(entity: CompiledEntityNode): ComposableTransform | null {
  if (!entity.localTransform?.matrix || !entity.transform.matrix) return null
  try {
    return asComposable(decomposeMatrix4(multiplyMatrix4(entity.transform.matrix, invertMatrix4(entity.localTransform.matrix))))
  } catch {
    return null
  }
}

function transformPrimitive(
  entity: CompiledEntityNode,
  finalEntityTransform: TransformDefinition,
  primitive: CompiledPrimitive,
): TransformDefinition {
  if (primitive.transform === entity.transform || primitive.id === `entity:${entity.id}`) return finalEntityTransform
  const entityMatrix = entity.transform.matrix
  const finalMatrix = finalEntityTransform.matrix
  const primitiveMatrix = primitive.transform.matrix
  if (entityMatrix && finalMatrix && primitiveMatrix) {
    try {
      const delta = multiplyMatrix4(finalMatrix, invertMatrix4(entityMatrix))
      return decomposeMatrix4(multiplyMatrix4(delta, primitiveMatrix))
    } catch {
      // Fall through to a conservative TRS approximation for custom multi-primitive entities.
    }
  }

  const baseQuaternion = entity.transform.quaternion ?? quaternionFromEulerXYZ(entity.transform.rotation)
  const finalQuaternion = finalEntityTransform.quaternion ?? quaternionFromEulerXYZ(finalEntityTransform.rotation)
  const primitiveQuaternion = primitive.transform.quaternion ?? quaternionFromEulerXYZ(primitive.transform.rotation)
  const deltaQuaternion = multiplyQuaternions(finalQuaternion, [-baseQuaternion[0], -baseQuaternion[1], -baseQuaternion[2], baseQuaternion[3]])
  const quaternion = multiplyQuaternions(deltaQuaternion, primitiveQuaternion)
  return finalizeTransform({
    position: [
      primitive.transform.position[0] + finalEntityTransform.position[0] - entity.transform.position[0],
      primitive.transform.position[1] + finalEntityTransform.position[1] - entity.transform.position[1],
      primitive.transform.position[2] + finalEntityTransform.position[2] - entity.transform.position[2],
    ],
    rotation: eulerXYZFromQuaternion(quaternion),
    quaternion,
    scale: [
      primitive.transform.scale[0] * finalEntityTransform.scale[0] / (entity.transform.scale[0] || 1),
      primitive.transform.scale[1] * finalEntityTransform.scale[1] / (entity.transform.scale[1] || 1),
      primitive.transform.scale[2] * finalEntityTransform.scale[2] / (entity.transform.scale[2] || 1),
    ],
  })
}

export class RuntimeTransformStore implements RuntimeTransformStoreLike {
  private compiled: CompiledWorld | null = null
  private readonly layers = new Map<string, Map<string, RuntimeTransformLayer>>()
  private readonly children = new Map<string, string[]>()
  private readonly staticParents = new Map<string, ComposableTransform | null>()
  private readonly dirty = new Set<string>()
  private readonly resolved = new Map<string, TransformDefinition>()
  private readonly influenced = new Set<string>()

  constructor(private readonly onDirty?: () => void) {}

  updateWorld(compiled: CompiledWorld | null): void {
    const previousCompiled = this.compiled
    const previousInfluenced = new Set(this.influenced)
    const previousLayers = new Map(this.layers)
    this.compiled = compiled
    this.children.clear()
    this.staticParents.clear()
    this.layers.clear()
    this.resolved.clear()
    this.influenced.clear()

    if (!compiled) {
      this.dirty.clear()
      return
    }

    for (const entity of compiled.entities) {
      if (entity.parentId) {
        const bucket = this.children.get(entity.parentId) ?? []
        bucket.push(entity.id)
        this.children.set(entity.parentId, bucket)
      } else {
        this.staticParents.set(entity.id, inferredStaticParent(entity))
      }
    }

    const rebaseId = (previousId: string): string | null => {
      if (compiled.entityById.has(previousId)) return previousId
      const authoringId = previousCompiled?.entityById.get(previousId)?.authoringId
      return authoringId ? compiled.entityByAuthoringId.get(authoringId)?.id ?? null : null
    }

    for (const [previousId, bucket] of previousLayers) {
      const nextId = rebaseId(previousId)
      if (!nextId) continue
      const target = this.layers.get(nextId) ?? new Map<string, RuntimeTransformLayer>()
      for (const [source, layer] of bucket) target.set(source, layer)
      this.layers.set(nextId, target)
      this.dirty.add(nextId)
    }
    for (const previousId of previousInfluenced) {
      const nextId = rebaseId(previousId)
      if (nextId) this.dirty.add(nextId)
    }
    if (this.dirty.size > 0) this.onDirty?.()
  }

  set(entityId: string, transform: RuntimeTransformInput, options: RuntimeTransformWriteOptions): void {
    const source = options.source.trim()
    if (!source) throw new Error('Runtime transform writes require a non-empty source.')
    if (this.compiled && !this.compiled.entityById.has(entityId) && !this.compiled.entityByAuthoringId.has(entityId)) {
      throw new Error(`Unknown runtime transform entity "${entityId}".`)
    }
    validateInput(transform)
    const resolvedId = this.compiled?.entityByAuthoringId.get(entityId)?.id ?? entityId
    const priority = options.priority ?? 0
    if (!Number.isFinite(priority)) throw new Error('Runtime transform priority must be finite.')
    const mode = options.mode ?? 'override'
    const space = options.space ?? 'world'
    const next: RuntimeTransformLayer = { source, priority, mode, space, transform: cloneInput(transform) }
    const bucket = this.layers.get(resolvedId) ?? new Map<string, RuntimeTransformLayer>()
    const previous = bucket.get(source)
    if (previous && previous.priority === priority && previous.mode === mode && previous.space === space && sameInput(previous.transform, next.transform)) return
    bucket.set(source, next)
    this.layers.set(resolvedId, bucket)
    this.markDirty(resolvedId)
  }

  clear(entityId: string, source?: string): boolean {
    const resolvedId = this.compiled?.entityByAuthoringId.get(entityId)?.id ?? entityId
    const bucket = this.layers.get(resolvedId)
    if (!bucket) return false
    let changed = false
    if (source === undefined) {
      changed = bucket.size > 0
      this.layers.delete(resolvedId)
    } else {
      changed = bucket.delete(source)
      if (bucket.size === 0) this.layers.delete(resolvedId)
    }
    if (changed) this.markDirty(resolvedId)
    return changed
  }

  clearSource(source: string): number {
    let count = 0
    for (const [entityId, bucket] of this.layers) {
      if (!bucket.delete(source)) continue
      count += 1
      if (bucket.size === 0) this.layers.delete(entityId)
      this.markDirty(entityId)
    }
    return count
  }

  clearAll(): void {
    if (this.layers.size === 0 && this.influenced.size === 0) return
    const affected = new Set([...this.layers.keys(), ...this.influenced])
    this.layers.clear()
    for (const entityId of affected) this.markDirty(entityId)
  }

  has(entityId: string, source?: string): boolean {
    const resolvedId = this.compiled?.entityByAuthoringId.get(entityId)?.id ?? entityId
    const bucket = this.layers.get(resolvedId)
    return source === undefined ? Boolean(bucket?.size) : Boolean(bucket?.has(source))
  }

  getLayers(entityId: string): readonly RuntimeTransformLayerSnapshot[] {
    const resolvedId = this.compiled?.entityByAuthoringId.get(entityId)?.id ?? entityId
    const bucket = this.layers.get(resolvedId)
    if (!bucket) return []
    return sortLayers(bucket.values()).map((layer) => ({
      source: layer.source,
      priority: layer.priority,
      mode: layer.mode,
      space: layer.space,
      transform: cloneInput(layer.transform),
    }))
  }

  getResolved(entityId: string): TransformDefinition | null {
    const resolvedId = this.compiled?.entityByAuthoringId.get(entityId)?.id ?? entityId
    return this.resolved.get(resolvedId) ?? this.compiled?.entityById.get(resolvedId)?.transform ?? null
  }


  snapshotLayers(): ReadonlyMap<string, readonly RuntimeTransformLayerSnapshot[]> {
    const snapshot = new Map<string, readonly RuntimeTransformLayerSnapshot[]>()
    for (const entityId of this.layers.keys()) snapshot.set(entityId, this.getLayers(entityId))
    return snapshot
  }

  restoreLayers(snapshot: ReadonlyMap<string, readonly RuntimeTransformLayerSnapshot[]>): void {
    this.layers.clear()
    this.resolved.clear()
    this.influenced.clear()
    this.dirty.clear()
    for (const [entityId, layers] of snapshot) {
      for (const layer of layers) {
        const bucket = this.layers.get(entityId) ?? new Map<string, RuntimeTransformLayer>()
        bucket.set(layer.source, {
          source: layer.source,
          priority: layer.priority,
          mode: layer.mode,
          space: layer.space,
          transform: cloneInput(layer.transform),
        })
        this.layers.set(entityId, bucket)
      }
      this.dirty.add(entityId)
    }
    if (this.dirty.size > 0) this.onDirty?.()
  }

  takeUpdates(): RuntimeTransformUpdate[] {
    const compiled = this.compiled
    if (!compiled || this.dirty.size === 0) return []
    const affected = new Set<string>()
    for (const entityId of this.dirty) this.collectDescendants(entityId, affected)
    this.dirty.clear()

    const depthCache = new Map<string, number>()
    const depthOf = (entityId: string): number => {
      const cached = depthCache.get(entityId)
      if (cached !== undefined) return cached
      const parentId = compiled.entityById.get(entityId)?.parentId
      const depth = parentId ? depthOf(parentId) + 1 : 0
      depthCache.set(entityId, depth)
      return depth
    }
    const ordered = [...affected].filter((id) => compiled.entityById.has(id)).sort((left, right) => depthOf(left) - depthOf(right))
    const updates: RuntimeTransformUpdate[] = []

    for (const entityId of ordered) {
      const entity = compiled.entityById.get(entityId)
      if (!entity) continue
      const parent = entity.parentId ? compiled.entityById.get(entity.parentId) : undefined
      const parentInfluenced = Boolean(parent && this.influenced.has(parent.id))
      let inherited = entity.transform
      if (parent && parentInfluenced) {
        const parentTransform = this.resolved.get(parent.id) ?? parent.transform
        if (entity.localTransform) inherited = finalizeTransform(composeTransforms(asComposable(parentTransform), asComposable(entity.localTransform)))
        else if (parent.transform.matrix && parentTransform.matrix && entity.transform.matrix) {
          try {
            const local = decomposeMatrix4(multiplyMatrix4(invertMatrix4(parent.transform.matrix), entity.transform.matrix))
            inherited = decomposeMatrix4(multiplyMatrix4(parentTransform.matrix, local.matrix as NonNullable<typeof local.matrix>))
          } catch {
            inherited = entity.transform
          }
        }
      }

      const ownLayers = this.layers.get(entityId)
      const isInfluenced = parentInfluenced || Boolean(ownLayers?.size)
      let finalTransform = inherited
      if (ownLayers?.size) {
        let currentWorld = asComposable(inherited)
        const parentWorld = parent
          ? asComposable(this.resolved.get(parent.id) ?? parent.transform)
          : this.staticParents.get(entity.id) ?? null
        let currentLocal: ComposableTransform | null = null
        let worldLayerApplied = false

        for (const layer of sortLayers(ownLayers.values())) {
          if (layer.space === 'local' && parentWorld) {
            if (!currentLocal) {
              currentLocal = !worldLayerApplied && entity.localTransform
                ? asComposable(entity.localTransform)
                : relativeComposable(parentWorld, currentWorld)
            }
            currentLocal = applyLayer(currentLocal, layer)
            continue
          }

          if (currentLocal && parentWorld) {
            currentWorld = composeTransforms(parentWorld, currentLocal)
            currentLocal = null
          }
          currentWorld = applyLayer(currentWorld, layer)
          worldLayerApplied = true
        }

        if (currentLocal && parentWorld) currentWorld = composeTransforms(parentWorld, currentLocal)
        finalTransform = finalizeTransform(currentWorld)
      }

      if (isInfluenced) {
        this.influenced.add(entityId)
        this.resolved.set(entityId, finalTransform)
      } else {
        this.influenced.delete(entityId)
        this.resolved.delete(entityId)
        finalTransform = entity.transform
      }

      for (const primitiveId of entity.primitiveIds) {
        const primitive = compiled.primitiveById.get(primitiveId)
        if (!primitive) continue
        const transform = isInfluenced ? transformPrimitive(entity, finalTransform, primitive) : primitive.transform
        updates.push({
          entityId,
          authoringId: entity.authoringId,
          primitiveId,
          transform,
          primitive: { ...primitive, transform },
        })
      }
    }
    return updates
  }

  restoreUpdates(updates: readonly RuntimeTransformUpdate[]): void {
    for (const update of updates) this.dirty.add(update.entityId)
    if (updates.length > 0) this.onDirty?.()
  }

  markAllActiveDirty(): void {
    for (const entityId of new Set([...this.layers.keys(), ...this.influenced])) this.dirty.add(entityId)
    if (this.dirty.size > 0) this.onDirty?.()
  }

  get dirtyCount(): number { return this.dirty.size }

  private markDirty(entityId: string): void {
    this.dirty.add(entityId)
    this.onDirty?.()
  }

  private collectDescendants(entityId: string, output: Set<string>): void {
    if (output.has(entityId)) return
    output.add(entityId)
    for (const childId of this.children.get(entityId) ?? []) this.collectDescendants(childId, output)
  }
}
