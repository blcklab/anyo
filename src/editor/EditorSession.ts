import type { World } from '../core/World.js'
import type {
  Aabb,
  CompiledEntityNode,
  EntityDefinition,
  Matrix4Tuple,
  PickResult,
  Vec3,
  WorldDocument,
} from '../core/types.js'
import {
  collectEntityIds,
  createUniqueEntityId,
  findEntityLocation,
  getValueAtPointer,
} from '../document/index.js'
import { mergeAabb } from '../math/aabb.js'
import { composeMatrix4, decomposeMatrix4, relativeTransformMatrix } from '../math/matrix4.js'
import type {
  CreateEntityOptions,
  DuplicateEntitiesOptions,
  EditorHierarchyNode,
  EditorInspectorField,
  EditorInspectorModel,
  EditorMutationResult,
  EditorSelectionSnapshot,
  EditorSelectionTarget,
  EditorSessionOptions,
  EntityClipboardPayload,
  PasteEntitiesOptions,
  ReparentEntityOptions,
  ResolvedPick,
  TransformPreviewUpdate,
} from './types.js'

const IDENTITY_MATRIX: Matrix4Tuple = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]

function randomToken(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    const value = new Uint32Array(2)
    cryptoApi.getRandomValues(value)
    return `${value[0]?.toString(36)}${value[1]?.toString(36)}`
  }
  return Math.random().toString(36).slice(2, 12)
}

function defaultAuthoringId(base: string): string {
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'entity'
  return `anyo:${safe}:${randomToken()}`
}

function offsetPosition(position: Vec3 | undefined, offset: Vec3 | undefined): Vec3 | undefined {
  if (!offset) return position ? [...position] as Vec3 : undefined
  const source = position ?? [0, 0, 0]
  return [source[0] + offset[0], source[1] + offset[1], source[2] + offset[2]]
}

function cloneWithNewIds(
  entity: EntityDefinition,
  used: Set<string>,
  createId: (base: string, used: ReadonlySet<string>) => string,
  createAuthoringId: (base: string) => string,
  idMap: Record<string, string>,
): EntityDefinition {
  const nextId = createId(entity.id, used)
  used.add(nextId)
  idMap[entity.id] = nextId
  const clone: EntityDefinition = {
    ...structuredClone(entity),
    id: nextId,
    authoringId: createAuthoringId(nextId),
  }
  clone.children = entity.children?.map((child) => cloneWithNewIds(child, used, createId, createAuthoringId, idMap))
  return clone
}


function collectAuthoringIds(entities: readonly EntityDefinition[], output = new Set<string>()): Set<string> {
  for (const entity of entities) {
    if (entity.authoringId) output.add(entity.authoringId)
    collectAuthoringIds(entity.children ?? [], output)
  }
  return output
}

function prepareNewEntity(
  entity: EntityDefinition,
  usedIds: Set<string>,
  usedAuthoringIds: Set<string>,
  createId: (base: string, used: ReadonlySet<string>) => string,
  createAuthoringId: (base: string) => string,
  idMap: Record<string, string>,
): EntityDefinition {
  const source = structuredClone(entity)
  const nextId = usedIds.has(source.id) ? createId(source.id, usedIds) : source.id
  usedIds.add(nextId)
  idMap[source.id] = nextId
  let authoringId = source.authoringId?.trim()
  if (!authoringId || usedAuthoringIds.has(authoringId)) {
    do authoringId = createAuthoringId(nextId)
    while (usedAuthoringIds.has(authoringId))
  }
  usedAuthoringIds.add(authoringId)
  source.id = nextId
  source.authoringId = authoringId
  source.children = source.children?.map((child) => prepareNewEntity(
    child, usedIds, usedAuthoringIds, createId, createAuthoringId, idMap,
  ))
  return source
}

function toBounds3(bounds: Aabb | undefined): EditorSelectionSnapshot['bounds'] {
  if (!bounds) return null
  const size: Vec3 = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ]
  return {
    min: [...bounds.min] as Vec3,
    max: [...bounds.max] as Vec3,
    size,
    center: [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ],
  }
}


function inspectorField(
  entity: EntityDefinition,
  key: keyof EntityDefinition,
  label: string,
  kind: EditorInspectorField['kind'],
  options?: readonly string[],
  readOnly = false,
): EditorInspectorField {
  return { path: `/${String(key)}`, label, kind, value: structuredClone(entity[key]), options, readOnly }
}

function buildInspectorSections(entity: EntityDefinition): EditorInspectorModel['sections'] {
  const identity: EditorInspectorField[] = [
    inspectorField(entity, 'id', 'ID', 'string', undefined, true),
    inspectorField(entity, 'authoringId', 'Authoring ID', 'string', undefined, true),
    inspectorField(entity, 'type', 'Type', 'string', undefined, true),
  ]
  const transform: EditorInspectorField[] = [
    inspectorField(entity, 'position', 'Position', 'vec3'),
    inspectorField(entity, 'rotation', 'Rotation', 'vec3'),
    inspectorField(entity, 'scale', 'Scale', 'scale'),
  ]
  const appearance: EditorInspectorField[] = [
    inspectorField(entity, 'visible', 'Visible', 'boolean'),
    inspectorField(entity, 'material', 'Material', 'material'),
  ]
  if (entity.asset !== undefined) appearance.push(inspectorField(entity, 'asset', 'Asset', 'asset'))
  if (entity.src !== undefined) appearance.push(inspectorField(entity, 'src', 'Source', 'string'))
  if (entity.content !== undefined) appearance.push(inspectorField(entity, 'content', 'Content', 'json'))
  if (entity.size !== undefined) appearance.push(inspectorField(entity, 'size', 'Size', Array.isArray(entity.size) && entity.size.length === 2 ? 'vec2' : 'vec3'))
  if (entity.radius !== undefined) appearance.push(inspectorField(entity, 'radius', 'Radius', 'number'))
  if (entity.height !== undefined) appearance.push(inspectorField(entity, 'height', 'Height', 'number'))
  if (entity.color !== undefined) appearance.push(inspectorField(entity, 'color', 'Color', 'string'))
  if (entity.intensity !== undefined) appearance.push(inspectorField(entity, 'intensity', 'Intensity', 'number'))
  const behavior: EditorInspectorField[] = []
  if (entity.components !== undefined) behavior.push(inspectorField(entity, 'components', 'Components', 'json'))
  if (entity.interaction !== undefined) behavior.push(inspectorField(entity, 'interaction', 'Interaction', 'json'))
  if (entity.collision !== undefined) behavior.push(inspectorField(entity, 'collision', 'Collision', 'boolean'))
  return [
    { id: 'identity', label: 'Identity', fields: identity },
    { id: 'transform', label: 'Transform', fields: transform },
    { id: 'appearance', label: 'Appearance', fields: appearance },
    ...(behavior.length > 0 ? [{ id: 'behavior', label: 'Behavior', fields: behavior }] : []),
  ]
}

function matrixOf(node: CompiledEntityNode | undefined): Matrix4Tuple {
  return node?.transform.matrix ?? (node
    ? composeMatrix4(node.transform.position, node.transform.quaternion ?? [0, 0, 0, 1], node.transform.scale)
    : IDENTITY_MATRIX)
}

export class EditorSession {
  private selection: EditorSelectionTarget[] = []
  private clipboard: EntityClipboardPayload | null = null
  private readonly createId: (base: string, used: ReadonlySet<string>) => string
  private readonly createAuthoringId: (base: string) => string

  constructor(readonly world: World, options: EditorSessionOptions = {}) {
    this.createId = options.createId ?? createUniqueEntityId
    this.createAuthoringId = options.createAuthoringId ?? defaultAuthoringId
  }

  getSelection(): readonly EditorSelectionTarget[] {
    return structuredClone(this.selection)
  }

  setSelection(targets: readonly EditorSelectionTarget[]): void {
    const unique = new Map(targets.map((target) => [`${target.kind}:${target.id}`, target]))
    this.selection = [...unique.values()].map((target) => structuredClone(target))
    this.world.emit('editor:selection', this.getSelectionSnapshot())
  }

  clearSelection(): void {
    this.setSelection([])
  }

  getSelectionSnapshot(): EditorSelectionSnapshot {
    return { targets: this.getSelection(), bounds: this.getSelectionBounds() }
  }

  resolvePick(pick: PickResult): ResolvedPick {
    const node = pick.entityId ? this.world.compiled?.entityById.get(pick.entityId) : undefined
    const target: EditorSelectionTarget = node
      ? { kind: 'entity', id: node.authoringId }
      : { kind: 'primitive', id: pick.primitiveId }
    return { pick: structuredClone(pick), target }
  }

  selectPick(pick: PickResult, additive = false): ResolvedPick {
    const resolved = this.resolvePick(pick)
    this.setSelection(additive ? [...this.selection, resolved.target] : [resolved.target])
    return resolved
  }

  getHierarchy(): EditorHierarchyNode[] {
    const compiled = this.requireCompiled()
    const build = (node: CompiledEntityNode): EditorHierarchyNode => ({
      id: node.id,
      authoringId: node.authoringId,
      type: node.type,
      editable: node.authoring.editable,
      generated: node.authoring.generatedIndex !== undefined || !node.authoring.editable,
      sourcePath: node.authoring.sourcePath,
      bounds: node.bounds ? structuredClone(node.bounds) : undefined,
      children: node.childIds
        .map((id) => compiled.entityById.get(id))
        .filter((child): child is CompiledEntityNode => Boolean(child))
        .map(build),
    })
    return compiled.entities.filter((node) => !node.parentId).map(build)
  }


  getInspector(authoringId: string): EditorInspectorModel {
    const node = this.requireEditableNode(authoringId)
    const entity = this.requireEditableSourceEntity(this.requireSource(), node.authoringId).entity
    return {
      entityId: node.id,
      authoringId: node.authoringId,
      type: node.type,
      sourcePath: node.authoring.sourcePath,
      editable: node.authoring.editable,
      sections: buildInspectorSections(entity),
    }
  }

  getSelectionBounds(): EditorSelectionSnapshot['bounds'] {
    const compiled = this.world.compiled
    if (!compiled) return null
    let bounds: Aabb | undefined
    for (const target of this.selection) {
      const next = target.kind === 'entity'
        ? compiled.entityByAuthoringId.get(target.id)?.bounds ?? compiled.entityById.get(target.id)?.bounds
        : target.kind === 'primitive'
          ? compiled.primitiveById.get(target.id)?.bounds
          : target.kind === 'room'
            ? compiled.roomById.get(target.id)?.bounds
            : undefined
      if (next) bounds = bounds ? mergeAabb(bounds, next) : next
    }
    return toBounds3(bounds)
  }

  copy(authoringIds?: readonly string[]): EntityClipboardPayload {
    const ids = authoringIds ?? this.selection.filter((target) => target.kind === 'entity').map((target) => target.id)
    const document = this.requireSource()
    const entities = ids.map((id) => {
      const node = this.requireEditableNode(id)
      return structuredClone(this.requireEditableSourceEntity(document, node.authoringId).entity)
    })
    const payload: EntityClipboardPayload = { kind: 'anyo/entities', version: 1, entities }
    this.clipboard = structuredClone(payload)
    return payload
  }

  getClipboard(): EntityClipboardPayload | null {
    return this.clipboard ? structuredClone(this.clipboard) : null
  }


  async create(entity: EntityDefinition, options: CreateEntityOptions = {}): Promise<EditorMutationResult> {
    const source = this.requireSource()
    const usedIds = collectEntityIds(source.entities ?? [])
    const usedAuthoringIds = collectAuthoringIds(source.entities ?? [])
    for (const floor of source.building?.floors ?? []) {
      for (const room of floor.rooms) {
        collectEntityIds(room.entities ?? [], usedIds)
        collectAuthoringIds(room.entities ?? [], usedAuthoringIds)
      }
    }
    const idMap: Record<string, string> = {}
    const prepared = prepareNewEntity(
      entity, usedIds, usedAuthoringIds, this.createId, this.createAuthoringId, idMap,
    )
    const parent = options.parentId ? this.requireEditableNode(options.parentId) : null
    await this.world.transaction((document) => {
      const destination = parent
        ? this.requireEditableSourceEntity(document, parent.authoringId).entity.children ??= []
        : document.entities ??= []
      destination.push(structuredClone(prepared))
    }, options.label ?? `Create ${prepared.id}`)
    const authoringId = prepared.authoringId as string
    if (options.select ?? true) this.setSelection([{ kind: 'entity', id: authoringId }])
    return { authoringIds: [authoringId], entityIds: [prepared.id], idMap }
  }

  async paste(payload = this.clipboard, options: PasteEntitiesOptions = {}): Promise<EditorMutationResult> {
    if (!payload || payload.kind !== 'anyo/entities' || payload.version !== 1) throw new Error('No compatible Anyo entity clipboard payload is available.')
    const source = this.requireSource()
    const used = collectEntityIds(source.entities ?? [])
    for (const floor of source.building?.floors ?? []) for (const room of floor.rooms) collectEntityIds(room.entities ?? [], used)
    const idMap: Record<string, string> = {}
    const clones = payload.entities.map((entity) => cloneWithNewIds(entity, used, this.createId, this.createAuthoringId, idMap))
    for (const clone of clones) clone.position = offsetPosition(clone.position, options.offset)
    const parent = options.parentId ? this.requireEditableNode(options.parentId) : null
    await this.world.transaction((document) => {
      const destination = parent
        ? this.requireEditableSourceEntity(document, parent.authoringId).entity.children ??= []
        : document.entities ??= []
      destination.push(...structuredClone(clones))
    }, options.label ?? 'Paste entities')
    const authoringIds = clones.map((entity) => entity.authoringId as string)
    this.setSelection(authoringIds.map((id) => ({ kind: 'entity', id })))
    return { authoringIds, entityIds: clones.map((entity) => entity.id), idMap }
  }

  async duplicate(authoringIds?: readonly string[], options: DuplicateEntitiesOptions = {}): Promise<EditorMutationResult> {
    return this.paste(this.copy(authoringIds), { offset: options.offset ?? [0.5, 0, 0.5], parentId: options.parentId, label: options.label ?? 'Duplicate entities' })
  }

  async remove(authoringIds?: readonly string[], label = 'Delete entities'): Promise<void> {
    const ids = authoringIds ?? this.selection.filter((target) => target.kind === 'entity').map((target) => target.id)
    const nodes = ids.map((id) => this.requireEditableNode(id))
    await this.world.transaction((document) => {
      const locations = nodes.map((node) => this.requireEditableSourceEntity(document, node.authoringId))
      locations.sort((a, b) => b.path.localeCompare(a.path))
      for (const location of locations) location.container.splice(location.index, 1)
    }, label)
    this.clearSelection()
  }

  async reparent(authoringId: string, parentAuthoringId: string | null, options: ReparentEntityOptions = {}): Promise<EditorMutationResult> {
    const node = this.requireEditableNode(authoringId)
    const parent = parentAuthoringId ? this.requireEditableNode(parentAuthoringId) : null
    if (parent && this.isDescendant(parent.id, node.id)) throw new Error('ANYO_EDITOR_HIERARCHY_CYCLE')
    const preserve = options.preserve ?? 'world'
    const local = preserve === 'world'
      ? decomposeMatrix4(relativeTransformMatrix(matrixOf(parent ?? undefined), matrixOf(node)))
      : null
    await this.world.transaction((document) => {
      const location = this.requireEditableSourceEntity(document, node.authoringId)
      const entity = structuredClone(location.entity)
      entity.authoringId ??= node.authoringId
      location.container.splice(location.index, 1)
      if (local) {
        entity.position = local.position
        entity.rotation = local.rotation
        entity.scale = local.scale
        entity.room = undefined
        entity.surface = undefined
      }
      const destination = parent
        ? this.requireEditableSourceEntity(document, parent.authoringId).entity.children ??= []
        : document.entities ??= []
      destination.push(entity)
    }, options.label ?? `Reparent ${node.id}`)
    this.setSelection([{ kind: 'entity', id: node.authoringId }])
    return { authoringIds: [node.authoringId], entityIds: [this.world.compiled?.entityByAuthoringId.get(node.authoringId)?.id ?? node.id], idMap: {} }
  }

  async group(authoringIds?: readonly string[], groupId = 'group', label = 'Group entities'): Promise<EditorMutationResult> {
    const ids = authoringIds ?? this.selection.filter((target) => target.kind === 'entity').map((target) => target.id)
    if (ids.length === 0) throw new Error('Select at least one entity to group.')
    const nodes = ids.map((id) => this.requireEditableNode(id))
    const parents = new Set(nodes.map((node) => node.parentId ?? null))
    if (parents.size !== 1) throw new Error('ANYO_EDITOR_GROUP_PARENT_MISMATCH')
    const parent = nodes[0]?.parentId ? this.requireEditableNode(nodes[0].parentId as string) : null
    const availableBounds = nodes.map((node) => node.bounds).filter((value): value is Aabb => Boolean(value))
    const bounds = availableBounds.length > 0 ? availableBounds.slice(1).reduce((a, b) => mergeAabb(a, b), availableBounds[0]!) : undefined
    const center: Vec3 = bounds
      ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2]
      : [0, 0, 0]
    const parentMatrix = matrixOf(parent ?? undefined)
    const groupWorld = composeMatrix4(center, [0, 0, 0, 1], [1, 1, 1])
    const groupLocal = decomposeMatrix4(relativeTransformMatrix(parentMatrix, groupWorld))
    const source = this.requireSource()
    const used = collectEntityIds(source.entities ?? [])
    for (const floor of source.building?.floors ?? []) for (const room of floor.rooms) collectEntityIds(room.entities ?? [], used)
    const nextGroupId = this.createId(groupId, used)
    const groupAuthoringId = this.createAuthoringId(nextGroupId)
    await this.world.transaction((document) => {
      const locations = nodes.map((node) => ({ node, location: this.requireEditableSourceEntity(document, node.authoringId) }))
      const entities = locations.map(({ node, location }) => {
        const entity = structuredClone(location.entity)
        const local = decomposeMatrix4(relativeTransformMatrix(groupWorld, matrixOf(node)))
        entity.position = local.position
        entity.rotation = local.rotation
        entity.scale = local.scale
        entity.room = undefined
        entity.surface = undefined
        entity.authoringId ??= node.authoringId
        return entity
      })
      locations.map(({ location }) => location).sort((a, b) => b.path.localeCompare(a.path)).forEach((location) => location.container.splice(location.index, 1))
      const group: EntityDefinition = {
        id: nextGroupId,
        authoringId: groupAuthoringId,
        type: 'group',
        position: groupLocal.position,
        rotation: groupLocal.rotation,
        scale: groupLocal.scale,
        children: entities,
      }
      const destination = parent
        ? this.requireEditableSourceEntity(document, parent.authoringId).entity.children ??= []
        : document.entities ??= []
      destination.push(group)
    }, label)
    this.setSelection([{ kind: 'entity', id: groupAuthoringId }])
    return { authoringIds: [groupAuthoringId], entityIds: [nextGroupId], idMap: {} }
  }

  async ungroup(groupAuthoringId: string, label = 'Ungroup entities'): Promise<EditorMutationResult> {
    const group = this.requireEditableNode(groupAuthoringId)
    if (group.type !== 'group') throw new Error(`Entity "${group.id}" is not a group.`)
    const parent = group.parentId ? this.requireEditableNode(group.parentId) : null
    const parentMatrix = matrixOf(parent ?? undefined)
    const childNodes = group.childIds.map((id) => this.requireEditableNode(id))
    await this.world.transaction((document) => {
      const groupLocation = this.requireEditableSourceEntity(document, group.authoringId)
      const groupEntity = groupLocation.entity
      const children = (groupEntity.children ?? []).map((entity, index) => {
        const node = childNodes[index]
        if (!node) return structuredClone(entity)
        const local = decomposeMatrix4(relativeTransformMatrix(parentMatrix, matrixOf(node)))
        const clone = structuredClone(entity)
        clone.position = local.position
        clone.rotation = local.rotation
        clone.scale = local.scale
        clone.room = undefined
        clone.surface = undefined
        clone.authoringId ??= node.authoringId
        return clone
      })
      groupLocation.container.splice(groupLocation.index, 1, ...children)
    }, label)
    const authoringIds = childNodes.map((node) => node.authoringId)
    this.setSelection(authoringIds.map((id) => ({ kind: 'entity', id })))
    return { authoringIds, entityIds: childNodes.map((node) => node.id), idMap: {} }
  }

  beginTransformPreview(authoringId: string, label = 'Transform entity'): void {
    this.requireEditableNode(authoringId)
    this.world.beginPreview(label)
  }

  async updateTransformPreview(authoringId: string, update: TransformPreviewUpdate): Promise<void> {
    const node = this.requireEditableNode(authoringId)
    await this.world.previewEntityTransform(node.authoringId, update)
  }

  commitTransformPreview(label?: string): Promise<boolean> {
    return this.world.commitPreview(label)
  }

  cancelTransformPreview(): Promise<boolean> {
    return this.world.cancelPreview()
  }

  private requireCompiled() {
    if (!this.world.compiled) throw new Error('Load an Anyo world before creating editor state.')
    return this.world.compiled
  }

  private requireSource(): WorldDocument {
    const source = this.world.getSourceDocument()
    if (!source) throw new Error('Load an Anyo world before editing it.')
    return source
  }

  private requireEditableNode(id: string): CompiledEntityNode {
    const compiled = this.requireCompiled()
    const node = compiled.entityByAuthoringId.get(id) ?? compiled.entityById.get(id)
    if (!node) throw new Error(`Unknown editor entity "${id}".`)
    if (!node.authoring.editable) {
      throw new Error(`ANYO_EDITOR_TARGET_GENERATED\nEntity: ${node.id}\nSource: ${node.authoring.sourcePath}`)
    }
    return node
  }

  private requireEditableSourceEntity(document: WorldDocument, id: string) {
    const node = this.world.compiled?.entityByAuthoringId.get(id) ?? this.world.compiled?.entityById.get(id)
    if (node) {
      const entity = getValueAtPointer(document, node.authoring.sourcePath)
      if (entity && typeof entity === 'object' && !Array.isArray(entity)) {
        const location = findEntityLocation(document, (entity as EntityDefinition).authoringId ?? (entity as EntityDefinition).id)
        if (location) return location
      }
    }
    const location = findEntityLocation(document, id)
    if (!location) throw new Error(`Cannot find source entity "${id}".`)
    return location
  }

  private isDescendant(candidateId: string, ancestorId: string): boolean {
    const compiled = this.requireCompiled()
    let current = compiled.entityById.get(candidateId)
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true
      current = compiled.entityById.get(current.parentId)
    }
    return false
  }
}
