import type {
  AssetDefinition,
  AuthoringReference,
  ComponentDefinition,
  EntityDefinition,
  OpeningDefinition,
  NormalizedEntityDefinition,
  NormalizedFloor,
  NormalizedOpening,
  NormalizedRoom,
  NormalizedWorldDocument,
  RoomDefinition,
  Vec2,
  WallSide,
  WorldDocument,
  WorldSourceContext,
} from '../core/types.js'
import { getWallLength } from '../math/walls.js'
import { validateWorldDocument } from './validate.js'
import { resolveDocumentBindings } from './bindings.js'
import { normalizeEnvironmentDefinition, normalizeMaterialDefinition } from '../core/visualContract.js'
import { hasOwn, parseJsonPointer } from './safePath.js'

const DEFAULTS = {
  roomHeight: 3.2,
  wallThickness: 0.14,
  floorThickness: 0.18,
  ceilingThickness: 0.12,
} as const

function oppositeWall(wall: WallSide): WallSide {
  const opposite: Record<WallSide, WallSide> = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
  }
  return opposite[wall]
}

function alignedOffset(parentLength: number, childLength: number, align: 'start' | 'center' | 'end'): number {
  if (align === 'start') return -(parentLength - childLength) / 2
  if (align === 'end') return (parentLength - childLength) / 2
  return 0
}

function resolveAttachedPosition(room: RoomDefinition, parent: NormalizedRoom): Vec2 {
  const attach = room.attachTo
  if (!attach) return room.position ?? [0, 0]

  const gap = attach.gap ?? 0
  const offset = attach.offset ?? 0
  const align = attach.align ?? 'center'
  const [parentWidth, parentDepth] = parent.size
  const [childWidth, childDepth] = room.size
  const [parentX, parentZ] = parent.position

  if (attach.wall === 'north' || attach.wall === 'south') {
    const x = parentX + alignedOffset(parentWidth, childWidth, align) + offset
    const normal = attach.wall === 'north' ? -1 : 1
    const z = parentZ + normal * (parentDepth / 2 + gap + childDepth / 2)
    return [x, z]
  }

  const z = parentZ + alignedOffset(parentDepth, childDepth, align) + offset
  const normal = attach.wall === 'west' ? -1 : 1
  const x = parentX + normal * (parentWidth / 2 + gap + childWidth / 2)
  return [x, z]
}

function normalizeOpening(room: NormalizedRoom, opening: OpeningDefinition, index: number): NormalizedOpening {
  const wallLength = getWallLength(room, opening.wall)
  const rawOffset = opening.offset ?? 'center'
  const centeredOffset = rawOffset === 'center' ? 0 : rawOffset - wallLength / 2

  return {
    ...opening,
    id: opening.id ?? `${room.id}:${opening.wall}:${index}`,
    offset: centeredOffset,
    elevation: opening.elevation ?? (opening.type === 'window' ? 0.9 : 0),
    open: opening.open ?? opening.type !== 'door',
    collision: opening.collision ?? opening.type !== 'portal',
  }
}

function solveRooms(
  floorId: string,
  rooms: RoomDefinition[],
  defaults: { roomHeight: number; wallThickness: number; floorThickness: number; ceilingThickness: number },
): NormalizedRoom[] {
  const definitions = new Map(rooms.map((room) => [room.id, room]))
  const solved = new Map<string, NormalizedRoom>()
  const visiting = new Set<string>()

  const solve = (id: string): NormalizedRoom => {
    const cached = solved.get(id)
    if (cached) return cached
    if (visiting.has(id)) throw new Error(`Room attachment cycle detected at "${id}".`)

    const room = definitions.get(id)
    if (!room) throw new Error(`Unknown room "${id}".`)
    visiting.add(id)

    const parent = room.attachTo ? solve(room.attachTo.room) : null
    const base: NormalizedRoom = {
      ...room,
      floorId,
      position: parent ? resolveAttachedPosition(room, parent) : (room.position ?? [0, 0]),
      height: room.height ?? defaults.roomHeight,
      wallThickness: room.wallThickness ?? defaults.wallThickness,
      openings: [],
    }
    base.openings = (room.openings ?? []).map((opening, index) => normalizeOpening(base, opening, index))

    solved.set(id, base)
    visiting.delete(id)
    return base
  }

  return rooms.map((room) => solve(room.id))
}

function translatedOpeningOffset(
  opening: NormalizedOpening,
  fromRoom: NormalizedRoom,
  toRoom: NormalizedRoom,
  wall: WallSide,
): number {
  const tangentCoordinate = wall === 'north' || wall === 'south'
    ? fromRoom.position[0] + opening.offset
    : fromRoom.position[1] + opening.offset
  return wall === 'north' || wall === 'south'
    ? tangentCoordinate - toRoom.position[0]
    : tangentCoordinate - toRoom.position[1]
}

function mirrorOpening(
  opening: NormalizedOpening,
  fromRoom: NormalizedRoom,
  toRoom: NormalizedRoom,
  wall: WallSide,
): NormalizedOpening {
  return {
    ...opening,
    id: opening.id,
    wall,
    offset: translatedOpeningOffset(opening, fromRoom, toRoom, wall),
    targetRoom: fromRoom.id,
  }
}

function addImplicitConnections(floors: NormalizedFloor[]): void {
  const rooms = new Map<string, NormalizedRoom>()
  for (const floor of floors) for (const room of floor.rooms) rooms.set(room.id, room)

  for (const floor of floors) {
    for (const room of floor.rooms) {
      const attach = room.attachTo
      if (!attach) continue
      const parent = rooms.get(attach.room)
      if (!parent) continue

      const tangentIsX = attach.wall === 'north' || attach.wall === 'south'
      const childCenter = tangentIsX ? room.position[0] : room.position[1]
      const parentCenter = tangentIsX ? parent.position[0] : parent.position[1]
      const childLength = tangentIsX ? room.size[0] : room.size[1]
      const parentLength = tangentIsX ? parent.size[0] : parent.size[1]
      const overlap = Math.min(childCenter + childLength / 2, parentCenter + parentLength / 2)
        - Math.max(childCenter - childLength / 2, parentCenter - parentLength / 2)
      if (overlap <= 1e-6) {
        throw new Error([
          'ANYO_ATTACHMENT_OVERLAP_INVALID',
          `Room: ${room.id}`,
          `Parent room: ${parent.id}`,
          `Wall: ${attach.wall}`,
          `Source: building.floors[${floor.id}].rooms[${room.id}].attachTo`,
          'The attached room does not overlap the selected parent wall.',
        ].join('\n'))
      }
      if (Math.abs(attach.gap ?? 0) > 1e-6) continue

      const childWall = oppositeWall(attach.wall)
      let childOpening = room.openings.find((opening) => opening.targetRoom === parent.id)
      let parentOpening = parent.openings.find((opening) => opening.targetRoom === room.id)

      if (!childOpening && !parentOpening) {
        const width = Math.min(1.4, getWallLength(room, childWall) * 0.5)
        childOpening = {
          id: `${room.id}:auto-connect`,
          type: 'door',
          wall: childWall,
          offset: 0,
          width,
          height: Math.min(2.4, room.height - 0.1),
          elevation: 0,
          targetRoom: parent.id,
          open: true,
          collision: false,
        }
        parentOpening = mirrorOpening(childOpening, room, parent, attach.wall)
        room.openings.push(childOpening)
        parent.openings.push(parentOpening)
        continue
      }

      if (childOpening && !parentOpening) {
        parentOpening = mirrorOpening(childOpening, room, parent, attach.wall)
        parent.openings.push(parentOpening)
      } else if (parentOpening && !childOpening) {
        childOpening = mirrorOpening(parentOpening, parent, room, childWall)
        room.openings.push(childOpening)
      }
    }
  }
}


function mergeComponents(
  template: ComponentDefinition[] | undefined,
  instance: ComponentDefinition[] | undefined,
): ComponentDefinition[] | undefined {
  if (!template && !instance) return undefined
  const result = [...(template ?? []).map((component) => structuredClone(component))]
  for (const component of instance ?? []) {
    const index = result.findIndex((candidate) => candidate.type === component.type && candidate.id === component.id)
    if (index >= 0) result[index] = { ...result[index], ...structuredClone(component) }
    else result.push(structuredClone(component))
  }
  return result
}

type WorkingEntity = EntityDefinition & {
  children?: WorkingEntity[]
  __authoring?: AuthoringReference
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function hashIdentity(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function hashUint32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Stable one-shot PRNG used only during document normalization. */
function repeatRandom(entityId: string, seed: number, index: number, channel: string): number {
  let state = hashUint32(`${entityId}:${seed}:${index}:${channel}`) + 0x6d2b79f5
  state = Math.imul(state ^ (state >>> 15), state | 1)
  state ^= state + Math.imul(state ^ (state >>> 7), state | 61)
  return ((state ^ (state >>> 14)) >>> 0) / 4294967296
}

function sampleVariationRange(
  range: readonly [number, number] | undefined,
  entityId: string,
  seed: number,
  index: number,
  channel: string,
  fallback: number,
): number {
  if (!range) return fallback
  return range[0] + (range[1] - range[0]) * repeatRandom(entityId, seed, index, channel)
}

function applyRepeatVariation(entity: WorkingEntity, sourceId: string, index: number, repeat: NonNullable<EntityDefinition['repeat']>): WorkingEntity {
  const variation = repeat.variation
  if (!variation) return entity
  const seed = variation.seed ?? 0

  if (variation.position) {
    const basePosition = entity.position ?? [0, 0, 0]
    const position = [...basePosition] as [number, number, number]
    position[0] += sampleVariationRange(variation.position.x, sourceId, seed, index, 'position.x', 0)
    position[1] += sampleVariationRange(variation.position.y, sourceId, seed, index, 'position.y', 0)
    position[2] += sampleVariationRange(variation.position.z, sourceId, seed, index, 'position.z', 0)
    entity.position = position
  }

  if (variation.rotation) {
    const baseRotation = entity.rotation ?? [0, 0, 0]
    entity.rotation = [
      baseRotation[0] + sampleVariationRange(variation.rotation.x, sourceId, seed, index, 'rotation.x', 0),
      baseRotation[1] + sampleVariationRange(variation.rotation.y, sourceId, seed, index, 'rotation.y', 0),
      baseRotation[2] + sampleVariationRange(variation.rotation.z, sourceId, seed, index, 'rotation.z', 0),
    ]
  }

  if (variation.scale) {
    const baseScale = typeof entity.scale === 'number'
      ? [entity.scale, entity.scale, entity.scale] as [number, number, number]
      : [...(entity.scale ?? [1, 1, 1])] as [number, number, number]
    const uniform = sampleVariationRange(variation.scale.uniform, sourceId, seed, index, 'scale.uniform', 1)
    entity.scale = [
      baseScale[0] * uniform * sampleVariationRange(variation.scale.x, sourceId, seed, index, 'scale.x', 1),
      baseScale[1] * uniform * sampleVariationRange(variation.scale.y, sourceId, seed, index, 'scale.y', 1),
      baseScale[2] * uniform * sampleVariationRange(variation.scale.z, sourceId, seed, index, 'scale.z', 1),
    ]
  }

  return entity
}

function createAuthoringReference(entity: EntityDefinition, sourcePath: string): AuthoringReference {
  return {
    id: entity.authoringId?.trim() || (entity.instanceId?.trim() ? `anyo:instance:${hashIdentity(entity.instanceId)}` : `anyo:${hashIdentity(`${sourcePath}:${entity.id}`)}`),
    sourcePath,
    editable: true,
  }
}

function annotateEntity(entity: EntityDefinition, sourcePath: string): WorkingEntity {
  return {
    ...structuredClone(entity),
    __authoring: createAuthoringReference(entity, sourcePath),
    children: entity.children?.map((child, index) => annotateEntity(child, `${sourcePath}/children/${index}`)),
  }
}

function mergeEntityTemplate(
  template: WorkingEntity,
  instance: WorkingEntity,
): WorkingEntity {
  return {
    ...template,
    ...instance,
    id: instance.id,
    authoringId: instance.authoringId,
    use: undefined,
    __authoring: instance.__authoring,
    style: { ...(template.style ?? {}), ...(instance.style ?? {}) },
    data: { ...(template.data ?? {}), ...(instance.data ?? {}) },
    interaction: template.interaction || instance.interaction
      ? { ...(template.interaction ?? {}), ...(instance.interaction ?? {}) }
      : undefined,
    components: mergeComponents(template.components, instance.components),
    children: instance.children ?? template.children,
  }
}

function markTemplateInstance(entity: WorkingEntity, instance: AuthoringReference, lineage = ''): WorkingEntity {
  const template = entity.__authoring
  const localIdentity = `${lineage}/${entity.id}:${template?.sourcePath ?? entity.id}`
  const authoring: AuthoringReference = {
    id: `${instance.id}/template:${hashIdentity(localIdentity)}`,
    sourcePath: instance.sourcePath,
    instancePath: instance.sourcePath,
    templatePath: template?.sourcePath,
    editable: false,
  }
  const nextLineage = `${lineage}/${entity.id}`
  return {
    ...entity,
    __authoring: authoring,
    children: entity.children?.map((child) => markTemplateInstance(child, instance, nextLineage)),
  }
}

function markRepeated(entity: WorkingEntity, source: AuthoringReference, index: number): WorkingEntity {
  const authoring: AuthoringReference = {
    id: `${source.id}#repeat:${index}${entity.id === source.id ? '' : `/${hashIdentity(entity.id)}`}`,
    sourcePath: source.sourcePath,
    instancePath: source.sourcePath,
    templatePath: entity.__authoring?.templatePath,
    generatedIndex: index,
    editable: false,
  }
  return {
    ...entity,
    __authoring: authoring,
    children: entity.children?.map((child) => markRepeated(child, source, index)),
  }
}

function expandRepeat(entity: WorkingEntity): WorkingEntity[] {
  const repeat = entity.repeat
  if (!repeat) return [entity]
  const start = repeat.start ?? 0
  const entities: WorkingEntity[] = []
  const source = entity.__authoring ?? createAuthoringReference(entity, `/entities/${escapePointer(entity.id)}`)

  for (let index = 0; index < repeat.count; index += 1) {
    const displacement = start + index * repeat.spacing
    let copy: WorkingEntity = { ...structuredClone(entity), id: `${entity.id}:${index}`, repeat: undefined }

    if (copy.surface) {
      const offset = copy.surface.offset ?? [0, 0]
      copy.surface = {
        ...copy.surface,
        offset: repeat.axis === 'x'
          ? [offset[0] + displacement, offset[1]]
          : repeat.axis === 'y'
            ? [offset[0], offset[1] + displacement]
            : offset,
        depth: repeat.axis === 'z' ? (copy.surface.depth ?? 0.012) + displacement : copy.surface.depth,
      }
    } else {
      const position = copy.position ?? [0, 0, 0]
      const axis = repeat.axis === 'x' ? 0 : repeat.axis === 'y' ? 1 : 2
      const next = [...position] as [number, number, number]
      next[axis] += displacement
      copy.position = next
    }
    copy = applyRepeatVariation(copy, source.id, index, repeat)
    copy = markRepeated(copy, source, index)
    entities.push(copy)
  }
  return entities
}


function applyTemplateOverrides(template: WorkingEntity, overrides: Record<string, unknown> | undefined): WorkingEntity {
  if (!overrides || Object.keys(overrides).length === 0) return template
  const result = structuredClone(template) as unknown
  for (const [pointer, value] of Object.entries(overrides)) {
    const parts = parseJsonPointer(pointer)
    if (parts.length === 0) throw new Error('Template override paths must not replace the complete template.')
    let target: unknown = result
    for (const part of parts.slice(0, -1)) {
      if (Array.isArray(target)) {
        const index = Number(part)
        if (!Number.isInteger(index) || index < 0 || index >= target.length) throw new Error(`Template override path "${pointer}" is outside the template.`)
        target = target[index]
      } else if (target && typeof target === 'object' && hasOwn(target, part)) target = (target as Record<string, unknown>)[part]
      else throw new Error(`Template override path "${pointer}" does not exist.`)
    }
    const key = parts.at(-1) as string
    if (Array.isArray(target)) {
      const index = Number(key)
      if (!Number.isInteger(index) || index < 0 || index >= target.length) throw new Error(`Template override path "${pointer}" is outside the template.`)
      target[index] = structuredClone(value)
    } else if (target && typeof target === 'object') {
      if (!hasOwn(target, key)) throw new Error(`Template override path "${pointer}" does not exist.`)
      ;(target as Record<string, unknown>)[key] = structuredClone(value)
    } else throw new Error(`Template override path "${pointer}" cannot be assigned.`)
  }
  return result as WorkingEntity
}

function resolvePrefabDefinition(
  id: string,
  prefabs: NonNullable<WorldDocument['prefabs']>,
  stack: string[] = [],
): Omit<EntityDefinition, 'id' | 'repeat'> & { id?: string } {
  if (stack.includes(id)) throw new Error(`Prefab inheritance cycle detected: ${[...stack, id].join(' -> ')}`)
  const prefab = prefabs[id]
  if (!prefab) throw new Error(`Unknown prefab "${id}".`)
  const { extends: baseId, version: _version, provenance: _provenance, ...own } = prefab
  if (!baseId) return own
  const base = resolvePrefabDefinition(baseId, prefabs, [...stack, id])
  return {
    ...structuredClone(base),
    ...structuredClone(own),
    style: { ...(base.style ?? {}), ...(own.style ?? {}) },
    data: { ...(base.data ?? {}), ...(own.data ?? {}) },
    components: mergeComponents(base.components, own.components),
    children: own.children ?? base.children,
  }
}


function resolveCompositionDefinition(
  id: string,
  compositions: NonNullable<WorldDocument['compositions']>,
  stack: string[] = [],
): Omit<EntityDefinition, 'id' | 'repeat' | 'use' | 'composition'> & { id?: string } {
  if (stack.includes(id)) throw new Error(`Composition inheritance cycle detected: ${[...stack, id].join(' -> ')}`)
  const composition = compositions[id]
  if (!composition) throw new Error(`Unknown composition "${id}".`)
  const { extends: baseId, version: _version, provenance: _provenance, type: _type, ...own } = composition
  const normalizedOwn = { ...own, type: 'group' as const }
  if (!baseId) return normalizedOwn
  const base = resolveCompositionDefinition(baseId, compositions, [...stack, id])
  return {
    ...structuredClone(base),
    ...structuredClone(normalizedOwn),
    type: 'group',
    style: { ...(base.style ?? {}), ...(normalizedOwn.style ?? {}) },
    data: { ...(base.data ?? {}), ...(normalizedOwn.data ?? {}) },
    components: mergeComponents(base.components, normalizedOwn.components),
    children: normalizedOwn.children ?? base.children,
  }
}

function expandEntity(
  entity: WorkingEntity,
  prefabs: WorldDocument['prefabs'],
  compositions: WorldDocument['compositions'],
  stack: string[] = [],
): WorkingEntity[] {
  let resolved = entity
  if (entity.use && entity.composition) throw new Error(`Entity "${entity.id}" cannot reference both prefab and composition templates.`)
  if (entity.use) {
    const stackKey = `prefab:${entity.use}`
    if (stack.includes(stackKey)) {
      throw new Error(`Prefab cycle detected: ${[...stack, stackKey].join(' -> ')}`)
    }
    if (!prefabs?.[entity.use]) throw new Error(`Unknown prefab "${entity.use}".`)
    const template = resolvePrefabDefinition(entity.use, prefabs)
    const templatePath = `/prefabs/${escapePointer(entity.use)}`
    const templateEntity = annotateEntity({ ...template, id: entity.id } as EntityDefinition, templatePath)
    const expandedTemplate = expandEntity(templateEntity, prefabs, compositions, [...stack, `prefab:${entity.use}`])[0]
    if (!expandedTemplate) throw new Error(`Prefab "${entity.use}" produced no entity.`)
    const instanceAuthoring = entity.__authoring ?? createAuthoringReference(entity, `/entities/${escapePointer(entity.id)}`)
    const overriddenTemplate = applyTemplateOverrides(expandedTemplate, entity.overrides)
    const templateWithProvenance = entity.children
      ? overriddenTemplate
      : {
          ...overriddenTemplate,
          children: overriddenTemplate.children?.map((child) => markTemplateInstance(child, instanceAuthoring)),
        }
    resolved = mergeEntityTemplate(templateWithProvenance, { ...entity, overrides: undefined })
    resolved.__authoring = {
      ...instanceAuthoring,
      templatePath,
      instancePath: instanceAuthoring.sourcePath,
      editable: true,
    }
  } else if (entity.composition) {
    const stackKey = `composition:${entity.composition}`
    if (stack.includes(stackKey)) {
      throw new Error(`Composition cycle detected: ${[...stack, stackKey].join(' -> ')}`)
    }
    if (!compositions?.[entity.composition]) throw new Error(`Unknown composition "${entity.composition}".`)
    const template = resolveCompositionDefinition(entity.composition, compositions)
    const templatePath = `/compositions/${escapePointer(entity.composition)}`
    const templateEntity = annotateEntity({ ...template, id: entity.id, type: 'group' } as EntityDefinition, templatePath)
    const expandedTemplate = expandEntity(templateEntity, prefabs, compositions, [...stack, stackKey])[0]
    if (!expandedTemplate) throw new Error(`Composition "${entity.composition}" produced no entity.`)
    const instanceAuthoring = entity.__authoring ?? createAuthoringReference(entity, `/entities/${escapePointer(entity.id)}`)
    const overriddenTemplate = applyTemplateOverrides(expandedTemplate, entity.overrides)
    const templateWithProvenance = entity.children
      ? overriddenTemplate
      : {
          ...overriddenTemplate,
          children: overriddenTemplate.children?.map((child) => markTemplateInstance(child, instanceAuthoring)),
        }
    resolved = mergeEntityTemplate(templateWithProvenance, { ...entity, composition: undefined, overrides: undefined, type: entity.type ?? 'group' })
    resolved.__authoring = {
      ...instanceAuthoring,
      templatePath,
      instancePath: instanceAuthoring.sourcePath,
      editable: true,
    }
  }

  const children = (resolved.children ?? []).flatMap((child) => expandEntity(child, prefabs, compositions, stack))
  resolved = { ...resolved, children: children.length > 0 ? children : undefined }
  return expandRepeat(resolved)
}

function namespaceChildIds(entity: WorkingEntity): NormalizedEntityDefinition {
  const children = entity.children?.map((child) => namespaceChildIds({
    ...child,
    id: `${entity.id}/${child.id}`,
  }))
  return { ...entity, children }
}

function collectEntityIds(entity: NormalizedEntityDefinition, ids: Set<string>): void {
  if (ids.has(entity.id)) throw new Error(`Expanded entity id "${entity.id}" is duplicated.`)
  ids.add(entity.id)
  for (const child of entity.children ?? []) collectEntityIds(child, ids)
}

function flattenEntities(document: WorldDocument): NormalizedEntityDefinition[] {
  const raw: WorkingEntity[] = (document.entities ?? []).map((entity, index) => annotateEntity(entity, `/entities/${index}`))
  for (const [floorIndex, floor] of (document.building?.floors ?? []).entries()) {
    for (const [roomIndex, room] of floor.rooms.entries()) {
      for (const [entityIndex, entity] of (room.entities ?? []).entries()) {
        const path = `/building/floors/${floorIndex}/rooms/${roomIndex}/entities/${entityIndex}`
        raw.push({ ...annotateEntity(entity, path), room: entity.room ?? room.id })
      }
    }
  }

  const entities = raw.flatMap((entity) => expandEntity(entity, document.prefabs, document.compositions)).map(namespaceChildIds)
  const ids = new Set<string>()
  const authoringIds = new Set<string>()
  const visit = (entity: NormalizedEntityDefinition): void => {
    const authoringId = entity.__authoring?.id
    if (authoringId) {
      if (authoringIds.has(authoringId)) throw new Error(`Authoring identity "${authoringId}" is duplicated.`)
      authoringIds.add(authoringId)
    }
    for (const child of entity.children ?? []) visit(child)
  }
  for (const entity of entities) {
    collectEntityIds(entity, ids)
    visit(entity)
  }
  return entities
}

export interface NormalizeWorldOptions {
  sourceContext?: WorldSourceContext
}

function resolveUrl(value: string, sourceContext?: WorldSourceContext): string {
  const base = sourceContext?.baseUrl ?? sourceContext?.documentUrl
  if (!base) return value
  try {
    return new URL(value, base).href
  } catch {
    return value
  }
}

function normalizeAsset(asset: AssetDefinition, sourceContext?: WorldSourceContext): AssetDefinition {
  const src = typeof asset.src === 'string' ? resolveUrl(asset.src, sourceContext) : asset.src
  return {
    ...asset,
    src,
    lod: asset.lod?.map((entry) => ({
      ...entry,
      src: entry.src ? resolveUrl(entry.src, sourceContext) : entry.src,
    })),
  }
}

function normalizeComponentUrls(component: ComponentDefinition, sourceContext?: WorldSourceContext): ComponentDefinition {
  const normalized = structuredClone(component)
  if (typeof normalized.src === 'string') normalized.src = resolveUrl(normalized.src, sourceContext)
  if (typeof normalized.source === 'string') normalized.source = resolveUrl(normalized.source, sourceContext)
  if (typeof normalized.texture === 'string') normalized.texture = resolveUrl(normalized.texture, sourceContext)
  const levels = Array.isArray(normalized.levels) ? normalized.levels : Array.isArray(normalized.lod) ? normalized.lod : undefined
  if (levels) {
    const resolved = levels.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
      const record = { ...entry }
      if (typeof record.src === 'string') record.src = resolveUrl(record.src, sourceContext)
      return record
    })
    if (Array.isArray(normalized.levels)) normalized.levels = resolved
    else normalized.lod = resolved
  }
  return normalized
}

function normalizeEntityUrls(entity: EntityDefinition, sourceContext?: WorldSourceContext): EntityDefinition {
  const src = typeof entity.src === 'string' ? resolveUrl(entity.src, sourceContext) : entity.src
  const webSurface = entity.webSurface ? {
    ...entity.webSurface,
    source: entity.webSurface.source.type === 'url'
      ? { ...entity.webSurface.source, url: resolveUrl(entity.webSurface.source.url, sourceContext) }
      : entity.webSurface.source.type === 'snapshot'
        ? { ...entity.webSurface.source, image: resolveUrl(entity.webSurface.source.image, sourceContext), href: entity.webSurface.source.href ? resolveUrl(entity.webSurface.source.href, sourceContext) : undefined }
        : entity.webSurface.source,
    fallback: entity.webSurface.fallback
      ? { ...entity.webSurface.fallback, image: resolveUrl(entity.webSurface.fallback.image, sourceContext), href: entity.webSurface.fallback.href ? resolveUrl(entity.webSurface.fallback.href, sourceContext) : undefined }
      : undefined,
  } : undefined
  return {
    ...entity,
    src,
    webSurface,
    audio: entity.audio ? { ...entity.audio, src: resolveUrl(entity.audio.src, sourceContext) } : undefined,
    lod: entity.lod?.map((entry) => ({
      ...entry,
      src: entry.src ? resolveUrl(entry.src, sourceContext) : entry.src,
    })),
    components: entity.components?.map((component) => normalizeComponentUrls(component, sourceContext)),
    children: entity.children?.map((child) => normalizeEntityUrls(child, sourceContext)),
  }
}

export function normalizeWorldDocument(input: WorldDocument, options: NormalizeWorldOptions = {}): NormalizedWorldDocument {
  const document = resolveDocumentBindings(input)
  validateWorldDocument(document)
  const building = document.building ?? { floors: [] }
  const defaults = { ...DEFAULTS, ...(building.defaults ?? {}) }
  const floors: NormalizedFloor[] = building.floors.map((floor) => ({
    ...floor,
    rooms: solveRooms(floor.id, floor.rooms, defaults),
    stairs: floor.stairs ?? [],
  }))
  addImplicitConnections(floors)

  const assets = Object.fromEntries(
    Object.entries(document.assets ?? {}).map(([id, asset]) => [id, normalizeAsset(asset, options.sourceContext)]),
  )
  const entities = flattenEntities(document).map((entity) => normalizeEntityUrls(entity, options.sourceContext))

  return {
    ...document,
    units: 'meters',
    revision: document.revision ?? 0,
    rendering: structuredClone(document.rendering ?? {}),
    cameras: structuredClone(document.cameras ?? {}),
    activeCamera: document.activeCamera,
    channels: structuredClone(document.channels ?? {}),
    requires: structuredClone(document.requires ?? {}),
    environment: normalizeEnvironmentDefinition(document.environment),
    materials: Object.fromEntries(
      Object.entries(document.materials ?? {}).map(([id, material]) => [id, normalizeMaterialDefinition(material)]),
    ),
    assets,
    entities,
    building: {
      ...building,
      defaults,
      floors,
    },
    sourceContext: options.sourceContext,
  }
}
