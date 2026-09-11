import type {
  AudioDefinition,
  ComponentDefinition,
  CompiledComponent,
  EntityDefinition,
  EntityLodDefinition,
  InteractionDefinition,
  JsonValue,
  NormalizedWorldDocument,
  Size3,
  TransformDefinition,
  TriggerDefinition,
} from '../core/types.js'

export type UnknownComponentPolicy = 'error' | 'warn' | 'preserve'

export interface ComponentValidationContext {
  entity: EntityDefinition
  document: NormalizedWorldDocument
  sourcePath: string
}

export interface ComponentCompileContext extends ComponentValidationContext {
  component: ComponentDefinition
  transform: TransformDefinition
  size: Size3
  roomId?: string
}

export interface ComponentTypeRegistration {
  type: string
  validate?(component: ComponentDefinition, context: ComponentValidationContext): void
  compile?(component: ComponentDefinition, context: ComponentCompileContext): Readonly<Record<string, JsonValue>> | void
}

export interface ComponentRegistryOptions {
  builtins?: boolean
}

export class ComponentTypeRegistry {
  private readonly registrations = new Map<string, ComponentTypeRegistration>()

  constructor(options: ComponentRegistryOptions = {}) {
    if (options.builtins ?? true) registerBuiltInComponents(this)
  }

  register(registration: ComponentTypeRegistration): () => void {
    const type = registration.type.trim()
    if (!type) throw new Error('Component type registrations require a non-empty type.')
    if (this.registrations.has(type)) throw new Error(`Component type "${type}" is already registered.`)
    const normalized = { ...registration, type }
    this.registrations.set(type, normalized)
    return () => {
      if (this.registrations.get(type) === normalized) this.registrations.delete(type)
    }
  }

  get(type: string): ComponentTypeRegistration | undefined {
    return this.registrations.get(type)
  }

  has(type: string): boolean {
    return this.registrations.has(type)
  }

  list(): readonly ComponentTypeRegistration[] {
    return [...this.registrations.values()]
  }
}

export function createComponentTypeRegistry(options: ComponentRegistryOptions = {}): ComponentTypeRegistry {
  return new ComponentTypeRegistry(options)
}

export interface ResolvedEntityComponents {
  components: CompiledComponent[]
  interaction?: InteractionDefinition
  collision: boolean
  audio?: AudioDefinition
  lod?: EntityLodDefinition[]
  trigger?: TriggerDefinition
  visible?: boolean
  dynamic: boolean
}

export interface ResolveEntityComponentsOptions {
  registry?: ComponentTypeRegistry
  unknown?: UnknownComponentPolicy
  warn?: (message: string) => void
  sourcePath: string
  document: NormalizedWorldDocument
  transform: TransformDefinition
  size: Size3
  roomId?: string
}

function componentData(component: ComponentDefinition): Readonly<Record<string, JsonValue>> {
  const data: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(component)) {
    if (key === 'type' || key === 'id' || key === 'enabled' || value === undefined) continue
    data[key] = structuredClone(value) as JsonValue
  }
  return data
}

function asInteraction(component: ComponentDefinition): InteractionDefinition {
  const events = component.events
  const select = events && typeof events === 'object' && !Array.isArray(events)
    ? (events as Record<string, JsonValue>).select
    : undefined
  const selectObject = select && typeof select === 'object' && !Array.isArray(select)
    ? select as Record<string, JsonValue>
    : undefined
  return {
    action: typeof component.action === 'string' ? component.action : typeof selectObject?.action === 'string' ? selectObject.action : undefined,
    event: typeof component.event === 'string' ? component.event : typeof selectObject?.event === 'string' ? selectObject.event : undefined,
    params: isRecord(component.params) ? structuredClone(component.params) as Record<string, unknown> : isRecord(selectObject?.params) ? structuredClone(selectObject?.params) as Record<string, unknown> : undefined,
    cursor: typeof component.cursor === 'string' ? component.cursor : undefined,
    distance: typeof component.distance === 'number' ? component.distance : undefined,
    hoverScale: typeof component.hoverScale === 'number' ? component.hoverScale : undefined,
  }
}

function asAudio(component: ComponentDefinition): AudioDefinition | undefined {
  const source = typeof component.source === 'string' ? component.source : typeof component.src === 'string' ? component.src : undefined
  if (!source) return undefined
  const distance = isRecord(component.distance) ? component.distance : undefined
  const cone = isRecord(component.cone) ? component.cone : undefined
  const zone = isRecord(component.zone) ? component.zone : undefined
  return {
    src: source,
    source,
    category: component.category === 'music' || component.category === 'sfx' || component.category === 'ambient' || component.category === 'voice' ? component.category : undefined,
    spatial: typeof component.spatial === 'boolean' ? component.spatial : undefined,
    strategy: component.strategy === 'buffered' || component.strategy === 'streaming' ? component.strategy : undefined,
    radius: typeof component.radius === 'number' ? component.radius : undefined,
    volume: typeof component.volume === 'number' ? component.volume : undefined,
    loop: typeof component.loop === 'boolean' ? component.loop : undefined,
    autoplay: typeof component.autoplay === 'boolean' ? component.autoplay : undefined,
    playbackRate: typeof component.playbackRate === 'number' ? component.playbackRate : undefined,
    startOffset: typeof component.startOffset === 'number' ? component.startOffset : undefined,
    distance: distance ? {
      model: distance.model === 'linear' || distance.model === 'inverse' || distance.model === 'exponential' ? distance.model : undefined,
      min: typeof distance.min === 'number' ? distance.min : undefined,
      max: typeof distance.max === 'number' ? distance.max : undefined,
      rolloff: typeof distance.rolloff === 'number' ? distance.rolloff : undefined,
    } : undefined,
    cone: cone ? {
      innerAngle: typeof cone.innerAngle === 'number' ? cone.innerAngle : undefined,
      outerAngle: typeof cone.outerAngle === 'number' ? cone.outerAngle : undefined,
      outerGain: typeof cone.outerGain === 'number' ? cone.outerGain : undefined,
    } : undefined,
    zone: zone ? {
      shape: zone.shape === 'sphere' || zone.shape === 'box' ? zone.shape : undefined,
      radius: typeof zone.radius === 'number' ? zone.radius : undefined,
      size: Array.isArray(zone.size) && zone.size.length === 3 ? zone.size as unknown as Size3 : undefined,
      fadeDistance: typeof zone.fadeDistance === 'number' ? zone.fadeDistance : undefined,
    } : undefined,
  }
}

function asLod(component: ComponentDefinition): EntityLodDefinition[] | undefined {
  const source = Array.isArray(component.levels) ? component.levels : Array.isArray(component.lod) ? component.lod : undefined
  if (!source) return undefined
  return source.filter((entry): entry is { [key: string]: JsonValue } => isJsonRecord(entry)).map((entry) => ({
    distance: Number(entry.distance),
    visible: typeof entry.visible === 'boolean' ? entry.visible : undefined,
    src: typeof entry.src === 'string' ? entry.src : undefined,
    type: entry.type === 'model' || entry.type === 'box' || entry.type === 'hidden' ? entry.type : undefined,
  }))
}

function asTrigger(component: ComponentDefinition): TriggerDefinition | undefined {
  if (!Array.isArray(component.size) || component.size.length !== 3) return undefined
  return {
    size: component.size as unknown as Size3,
    once: typeof component.once === 'boolean' ? component.once : undefined,
    onEnter: Array.isArray(component.onEnter) ? component.onEnter as never : undefined,
    onLeave: Array.isArray(component.onLeave) ? component.onLeave as never : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isJsonRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function legacyComponent(type: string, data: Record<string, JsonValue>): ComponentDefinition {
  return { type, ...data }
}

export function resolveEntityComponents(
  entity: EntityDefinition,
  options: ResolveEntityComponentsOptions,
): ResolvedEntityComponents {
  const registry = options.registry ?? createComponentTypeRegistry()
  const unknown = options.unknown ?? 'error'
  const explicit = [...(entity.components ?? [])]
  const explicitTypes = new Set(explicit.map((component) => component.type))
  const all: ComponentDefinition[] = [...explicit]

  if (entity.interaction && !explicitTypes.has('anyo.interactable')) {
    all.unshift(legacyComponent('anyo.interactable', structuredClone(entity.interaction) as Record<string, JsonValue>))
  }
  if (entity.collision !== undefined && !explicitTypes.has('anyo.collider')) {
    all.unshift(legacyComponent('anyo.collider', { enabled: entity.collision }))
  }
  if (entity.audio && !explicitTypes.has('anyo.audio')) {
    all.unshift(legacyComponent('anyo.audio', structuredClone(entity.audio) as unknown as Record<string, JsonValue>))
  }
  if (entity.lod && !explicitTypes.has('anyo.lod')) {
    all.unshift(legacyComponent('anyo.lod', { levels: structuredClone(entity.lod) as unknown as JsonValue }))
  }
  if (entity.trigger && !explicitTypes.has('anyo.trigger')) {
    all.unshift(legacyComponent('anyo.trigger', structuredClone(entity.trigger) as unknown as Record<string, JsonValue>))
  }
  if (entity.visible !== undefined && typeof entity.visible === 'boolean' && !explicitTypes.has('anyo.visibility')) {
    all.unshift(legacyComponent('anyo.visibility', { visible: entity.visible }))
  }

  const compiled: CompiledComponent[] = []
  let interaction = explicitTypes.has('anyo.interactable') ? undefined : entity.interaction
  let collision = explicitTypes.has('anyo.collider') ? false : entity.collision ?? false
  let audio = explicitTypes.has('anyo.audio') ? undefined : entity.audio
  let lod = explicitTypes.has('anyo.lod') ? undefined : entity.lod
  let trigger = explicitTypes.has('anyo.trigger') ? undefined : entity.trigger
  let visible = explicitTypes.has('anyo.visibility') ? undefined : typeof entity.visible === 'boolean' ? entity.visible : undefined
  let dynamic = false

  for (const [index, component] of all.entries()) {
    const sourcePath = `${options.sourcePath}/components/${index}`
    const registration = registry.get(component.type)
    if (!registration) {
      const message = `ANYO_COMPONENT_TYPE_UNSUPPORTED\nEntity: ${entity.id}\nType: ${component.type}\nSource: ${sourcePath}`
      if (unknown === 'error') throw new Error(message)
      if (unknown === 'warn') options.warn?.(message)
    } else {
      registration.validate?.(component, { entity, document: options.document, sourcePath })
    }

    const enabled = component.enabled ?? true
    const context: ComponentCompileContext = {
      component,
      entity,
      document: options.document,
      sourcePath,
      transform: options.transform,
      size: options.size,
      roomId: options.roomId,
    }
    const data = registration?.compile?.(component, context) ?? componentData(component)
    compiled.push({ type: component.type, id: component.id, enabled, data, sourcePath })
    if (!enabled) continue

    switch (component.type) {
      case 'anyo.interactable': interaction = asInteraction(component); dynamic = true; break
      case 'anyo.collider': collision = typeof component.enabled === 'boolean' ? component.enabled : true; dynamic = true; break
      case 'anyo.audio': audio = asAudio(component); dynamic = true; break
      case 'anyo.lod': lod = asLod(component); dynamic = true; break
      case 'anyo.trigger': trigger = asTrigger(component); dynamic = true; break
      case 'anyo.visibility': if (typeof component.visible === 'boolean') visible = component.visible; dynamic = true; break
      case 'anyo.map': dynamic = true; break
      case 'anyo.mapFeature': dynamic = true; break
      case 'anyo.animation': dynamic = true; break
      case 'anyo.rigidBody': dynamic = true; break
      case 'anyo.characterController': dynamic = true; break
      case 'anyo.joint': dynamic = true; break
    }
  }

  return { components: compiled, interaction, collision, audio, lod, trigger, visible, dynamic }
}

function componentError(code: string, context: ComponentValidationContext, message: string): Error {
  return new Error(`${code}\nEntity: ${context.entity.id}\nSource: ${context.sourcePath}\n${message}`)
}

function isFiniteSize3(value: unknown): value is Size3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item) && item > 0)
}

function validateSurfaceHost(component: ComponentDefinition, context: ComponentValidationContext): void {
  if (!(component.enabled ?? true)) return
  if (!isRecord(component.slots) || Object.keys(component.slots).length === 0) {
    throw componentError('ANYO_SURFACE_HOST_SLOTS_REQUIRED', context, 'Field: slots')
  }
  for (const [slotName, slot] of Object.entries(component.slots)) {
    if (!slotName.trim()) throw componentError('ANYO_SURFACE_HOST_SLOT_NAME_INVALID', context, 'Field: slots')
    if (!isRecord(slot)) throw componentError('ANYO_SURFACE_HOST_SLOT_INVALID', context, `Field: slots/${slotName}`)
    if (typeof slot.mesh !== 'string' || !slot.mesh.trim()) {
      throw componentError('ANYO_SURFACE_HOST_SLOT_MESH_REQUIRED', context, `Field: slots/${slotName}/mesh`)
    }
    if (!Number.isInteger(slot.materialSlot) || Number(slot.materialSlot) < 0) {
      throw componentError('ANYO_SURFACE_HOST_MATERIAL_SLOT_INVALID', context, `Field: slots/${slotName}/materialSlot`)
    }
    if (slot.uvSet !== undefined && (!Number.isInteger(slot.uvSet) || Number(slot.uvSet) < 0)) {
      throw componentError('ANYO_SURFACE_HOST_UV_SET_INVALID', context, `Field: slots/${slotName}/uvSet`)
    }
  }
}

export function registerBuiltInComponents(registry: ComponentTypeRegistry): void {
  const registrations: ComponentTypeRegistration[] = [
    { type: 'anyo.interactable' },
    { type: 'anyo.collider' },
    { type: 'anyo.map' },
    { type: 'anyo.mapFeature' },
    {
      type: 'anyo.audio',
      validate(component, context) {
        const source = typeof component.source === 'string' ? component.source : typeof component.src === 'string' ? component.src : undefined
        if ((component.enabled ?? true) && !source?.trim()) {
          throw componentError('ANYO_AUDIO_COMPONENT_SOURCE_REQUIRED', context, 'Field: source')
        }
        if (component.category !== undefined && !['music', 'sfx', 'ambient', 'voice'].includes(String(component.category))) {
          throw componentError('ANYO_AUDIO_COMPONENT_CATEGORY_INVALID', context, 'Field: category')
        }
        if (component.strategy !== undefined && component.strategy !== 'buffered' && component.strategy !== 'streaming') {
          throw componentError('ANYO_AUDIO_COMPONENT_STRATEGY_INVALID', context, 'Field: strategy')
        }
        if (component.volume !== undefined && (typeof component.volume !== 'number' || !Number.isFinite(component.volume) || component.volume < 0 || component.volume > 1)) {
          throw componentError('ANYO_AUDIO_COMPONENT_VOLUME_INVALID', context, 'Field: volume')
        }
        if (component.playbackRate !== undefined && (typeof component.playbackRate !== 'number' || !Number.isFinite(component.playbackRate) || component.playbackRate <= 0)) {
          throw componentError('ANYO_AUDIO_COMPONENT_PLAYBACK_RATE_INVALID', context, 'Field: playbackRate')
        }
        if (component.startOffset !== undefined && (typeof component.startOffset !== 'number' || !Number.isFinite(component.startOffset) || component.startOffset < 0)) {
          throw componentError('ANYO_AUDIO_COMPONENT_START_OFFSET_INVALID', context, 'Field: startOffset')
        }
        if (component.radius !== undefined && (typeof component.radius !== 'number' || !Number.isFinite(component.radius) || component.radius <= 0)) {
          throw componentError('ANYO_AUDIO_COMPONENT_RADIUS_INVALID', context, 'Field: radius')
        }
        if (isRecord(component.distance)) {
          const distance = component.distance
          if (distance.min !== undefined && (typeof distance.min !== 'number' || !Number.isFinite(distance.min) || distance.min <= 0)) throw componentError('ANYO_AUDIO_DISTANCE_MIN_INVALID', context, 'Field: distance/min')
          if (distance.max !== undefined && (typeof distance.max !== 'number' || !Number.isFinite(distance.max) || distance.max <= 0)) throw componentError('ANYO_AUDIO_DISTANCE_MAX_INVALID', context, 'Field: distance/max')
          if (distance.rolloff !== undefined && (typeof distance.rolloff !== 'number' || !Number.isFinite(distance.rolloff) || distance.rolloff < 0)) throw componentError('ANYO_AUDIO_DISTANCE_ROLLOFF_INVALID', context, 'Field: distance/rolloff')
        }
        if (isRecord(component.cone)) {
          const cone = component.cone
          for (const field of ['innerAngle', 'outerAngle'] as const) if (cone[field] !== undefined && (typeof cone[field] !== 'number' || !Number.isFinite(cone[field]) || Number(cone[field]) < 0 || Number(cone[field]) > 360)) throw componentError('ANYO_AUDIO_CONE_ANGLE_INVALID', context, `Field: cone/${field}`)
          if (cone.outerGain !== undefined && (typeof cone.outerGain !== 'number' || !Number.isFinite(cone.outerGain) || cone.outerGain < 0 || cone.outerGain > 1)) throw componentError('ANYO_AUDIO_CONE_GAIN_INVALID', context, 'Field: cone/outerGain')
        }
      },
    },
    {
      type: 'anyo.lod',
      validate(component, context) {
        const levels = Array.isArray(component.levels) ? component.levels : Array.isArray(component.lod) ? component.lod : undefined
        if (!levels || levels.length === 0) throw componentError('ANYO_LOD_COMPONENT_LEVELS_REQUIRED', context, 'Field: levels')
        for (const [index, level] of levels.entries()) {
          if (!isRecord(level) || typeof level.distance !== 'number' || !Number.isFinite(level.distance) || level.distance < 0) {
            throw componentError('ANYO_LOD_COMPONENT_LEVEL_INVALID', context, `Field: levels/${index}/distance`)
          }
        }
      },
    },
    {
      type: 'anyo.visibility',
      validate(component, context) {
        if (component.visible !== undefined && typeof component.visible !== 'boolean') {
          throw componentError('ANYO_VISIBILITY_COMPONENT_VALUE_INVALID', context, 'Field: visible')
        }
      },
    },
    {
      type: 'anyo.trigger',
      validate(component, context) {
        if ((component.enabled ?? true) && !isFiniteSize3(component.size)) {
          throw componentError('ANYO_TRIGGER_COMPONENT_SIZE_REQUIRED', context, 'Field: size')
        }
        if (component.onEnter !== undefined && !Array.isArray(component.onEnter)) {
          throw componentError('ANYO_TRIGGER_COMPONENT_ACTIONS_INVALID', context, 'Field: onEnter')
        }
        if (component.onLeave !== undefined && !Array.isArray(component.onLeave)) {
          throw componentError('ANYO_TRIGGER_COMPONENT_ACTIONS_INVALID', context, 'Field: onLeave')
        }
      },
    },
    { type: 'anyo.animation' },
    {
      type: 'anyo.rigidBody',
      validate(component, context) {
        if (!(component.enabled ?? true)) return
        if (component.bodyType !== undefined && component.bodyType !== 'static' && component.bodyType !== 'dynamic' && component.bodyType !== 'kinematic') {
          throw componentError('ANYO_RIGID_BODY_TYPE_INVALID', context, 'Field: bodyType')
        }
        if (component.mass !== undefined) {
          const bodyType = component.bodyType ?? 'dynamic'
          const invalidMass = typeof component.mass !== 'number'
            || !Number.isFinite(component.mass)
            || (bodyType === 'dynamic' ? component.mass <= 0 : component.mass < 0)
          if (invalidMass) throw componentError('ANYO_RIGID_BODY_MASS_INVALID', context, 'Field: mass')
        }
        for (const field of ['gravityScale', 'linearDamping', 'angularDamping'] as const) {
          const value = component[field]
          if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || ((field === 'linearDamping' || field === 'angularDamping') && value < 0))) {
            throw componentError('ANYO_RIGID_BODY_VALUE_INVALID', context, `Field: ${field}`)
          }
        }
      },
    },
    {
      type: 'anyo.characterController',
      validate(component, context) {
        if (!(component.enabled ?? true)) return
        if (component.mode !== undefined && component.mode !== 'first-person' && component.mode !== 'third-person') {
          throw componentError('ANYO_CHARACTER_MODE_INVALID', context, 'Field: mode')
        }
        for (const field of ['walkSpeed', 'runSpeed', 'jumpSpeed', 'acceleration', 'airAcceleration', 'deceleration', 'gravity', 'terminalVelocity', 'stepHeight', 'groundSnap', 'rotationSpeed', 'cameraDistance', 'cameraHeight'] as const) {
          const value = component[field]
          if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
            throw componentError('ANYO_CHARACTER_VALUE_INVALID', context, `Field: ${field}`)
          }
        }
        for (const field of ['maxSlopeAngle', 'minSlideAngle'] as const) {
          const value = component[field]
          if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 89.9)) {
            throw componentError('ANYO_CHARACTER_ANGLE_INVALID', context, `Field: ${field}`)
          }
        }
      },
    },
    {
      type: 'anyo.joint',
      validate(component, context) {
        if (!(component.enabled ?? true)) return
        if (typeof component.entityB !== 'string' || !component.entityB.trim()) {
          throw componentError('ANYO_PHYSICS_JOINT_TARGET_REQUIRED', context, 'Field: entityB')
        }
        if (component.jointType !== undefined
          && component.jointType !== 'fixed'
          && component.jointType !== 'spherical'
          && component.jointType !== 'revolute'
          && component.jointType !== 'prismatic') {
          throw componentError('ANYO_PHYSICS_JOINT_TYPE_INVALID', context, 'Field: jointType')
        }
        for (const field of ['anchorA', 'anchorB', 'axis'] as const) {
          const value = component[field]
          if (value !== undefined && (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item)))) {
            throw componentError('ANYO_PHYSICS_JOINT_VECTOR_INVALID', context, `Field: ${field}`)
          }
        }
        if (component.limits !== undefined && (!Array.isArray(component.limits)
          || component.limits.length !== 2
          || component.limits.some((item) => typeof item !== 'number' || !Number.isFinite(item)))) {
          throw componentError('ANYO_PHYSICS_JOINT_LIMITS_INVALID', context, 'Field: limits')
        }
      },
    },
    { type: 'anyo.billboard' },
    { type: 'anyo.surface-host', validate: validateSurfaceHost },
  ]
  for (const registration of registrations) registry.register(registration)
}
