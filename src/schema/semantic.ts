import type {
  ActionDefinition,
  ComponentDefinition,
  EntityDefinition,
  MaterialDefinition,
  RendererInfo,
  ValidationMode,
  WorldDocument,
  WorldValidationOptions,
} from '../core/types.js'
import type { ValidationIssue } from './errors.js'
import { getDataPath } from './bindings.js'

const BUILTIN_ENTITY_TYPES = new Set([
  'box', 'plane', 'cylinder', 'disc', 'cone', 'sphere', 'text', 'image', 'model', 'light', 'group',
  'trigger', 'audio', 'portal', 'web-surface', 'geometry', 'construction',
])
const BUILTIN_COMPONENT_TYPES = new Set([
  'anyo.interactable', 'anyo.collider', 'anyo.audio', 'anyo.vfx', 'anyo.map', 'anyo.mapFeature', 'anyo.lod',
  'anyo.visibility', 'anyo.trigger', 'anyo.animation', 'anyo.rigidBody', 'anyo.characterController', 'anyo.joint', 'anyo.billboard', 'anyo.surface-host',
])
const MARKER_COMPONENTS = new Set(['anyo.vfx', 'anyo.map', 'anyo.mapFeature', 'anyo.animation', 'anyo.rigidBody', 'anyo.characterController', 'anyo.joint', 'anyo.billboard'])

const TOP_LEVEL_FIELDS = new Set([
  '$schema', 'version', 'revision', 'units', 'metadata', 'data', 'environment', 'rendering', 'cameras', 'activeCamera', 'channels', 'requires', 'events', 'materials', 'geometries',
  'assets', 'prefabs', 'compositions', 'building', 'entities', 'exploration', 'visibility', 'extensions',
])
const ENTITY_FIELDS = new Set([
  'id', 'authoringId', 'instanceId', 'use', 'composition', 'overrides', 'repeat', 'type', 'room', 'position', 'rotation',
  'scale', 'size', 'radius', 'height', 'surface', 'material', 'geometry', 'construction', 'materialBindings', 'asset', 'src',
  'content', 'color', 'intensity', 'lightType', 'range', 'decay', 'castShadow', 'receiveShadow', 'shadow', 'collision', 'collisionPolicy', 'visible', 'children',
  'components', 'interaction', 'trigger', 'audio', 'lod', 'loading', 'webSurface',
  'data', 'style', 'enabled', 'layers', 'pickLayers', 'editorLayers', 'events', 'extensions',
  'version', 'extends', 'provenance',
])

function severity(mode: ValidationMode, strict: boolean): 'error' | 'warning' {
  return strict && mode !== 'permissive' ? 'error' : 'warning'
}

function add(
  issues: ValidationIssue[],
  severityValue: 'error' | 'warning',
  code: string,
  path: string,
  message: string,
  suggestion?: string,
): void {
  issues.push({ severity: severityValue, code, path, message, suggestion })
}

function has(registry: WorldValidationOptions['actionRegistry'], name: string): boolean {
  return Boolean(registry?.has(name))
}

function inspectUnknownFields(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  mode: ValidationMode,
  issues: ValidationIssue[],
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue
    add(
      issues,
      mode === 'generator' ? 'error' : 'warning',
      'ANYO_UNKNOWN_FIELD',
      `${path}/${key}`,
      `Unknown field "${key}" is not part of the stable Anyo contract.`,
      'Move namespaced extension data under extensions, or register a custom component/entity type.',
    )
  }
}

function inspectAction(
  definition: ActionDefinition | undefined,
  path: string,
  options: WorldValidationOptions,
  mode: ValidationMode,
  issues: ValidationIssue[],
): void {
  if (!definition) return
  const name = definition.type === 'invoke' || !definition.type ? definition.action : undefined
  if (name && !has(options.actionRegistry, name)) add(issues, severity(mode, true), 'ANYO_ACTION_NOT_REGISTERED', `${path}/action`, `Action "${name}" is not registered.`)
  if (definition.type === 'sequence') definition.actions?.forEach((child, index) => inspectAction(child, `${path}/actions/${index}`, options, mode, issues))
}

function inspectComponents(
  entity: EntityDefinition,
  path: string,
  options: WorldValidationOptions,
  mode: ValidationMode,
  issues: ValidationIssue[],
): void {
  for (const [index, component] of (entity.components ?? []).entries()) {
    if (!component || typeof component !== 'object') continue
    const componentPath = `${path}/components/${index}`
    const type = component.type
    if (type && !BUILTIN_COMPONENT_TYPES.has(type) && !has(options.componentTypeRegistry, type)) {
      add(issues, severity(mode, true), 'ANYO_COMPONENT_TYPE_NOT_REGISTERED', `${componentPath}/type`, `Component type "${type}" is not registered.`)
    }
    if (MARKER_COMPONENTS.has(type) && !options.handledComponents?.has(type)) {
      add(
        issues,
        'warning',
        'ANYO_COMPONENT_SYSTEM_MISSING',
        `${componentPath}/type`,
        `Component "${type}" is declarative marker data and has no registered handling system.`,
      )
    }
    if (type === 'anyo.interactable') {
      inspectAction(component as unknown as ActionDefinition, componentPath, options, mode, issues)
      const events = component.events
      if (events && typeof events === 'object' && !Array.isArray(events)) {
        const select = (events as Record<string, unknown>).select
        if (select && typeof select === 'object' && !Array.isArray(select)) {
          inspectAction(select as ActionDefinition, `${componentPath}/events/select`, options, mode, issues)
        }
      }
    }
    if (type === 'anyo.trigger') {
      for (const [actionIndex, action] of ((component.onEnter as ActionDefinition[] | undefined) ?? []).entries()) {
        inspectAction(action, `${componentPath}/onEnter/${actionIndex}`, options, mode, issues)
      }
      for (const [actionIndex, action] of ((component.onLeave as ActionDefinition[] | undefined) ?? []).entries()) {
        inspectAction(action, `${componentPath}/onLeave/${actionIndex}`, options, mode, issues)
      }
    }
  }
}

function inspectEntity(
  entity: EntityDefinition,
  path: string,
  document: WorldDocument,
  roomIds: ReadonlySet<string>,
  materialIds: ReadonlySet<string>,
  assetIds: ReadonlySet<string>,
  geometryIds: ReadonlySet<string>,
  options: WorldValidationOptions,
  mode: ValidationMode,
  issues: ValidationIssue[],
): void {
  inspectUnknownFields(entity, ENTITY_FIELDS, path, mode, issues)
  if (entity.room && !roomIds.has(entity.room)) {
    add(issues, severity(mode, true), 'ANYO_ENTITY_ROOM_NOT_FOUND', `${path}/room`, `Entity "${entity.id}" references missing room "${entity.room}".`)
  }
  if (entity.surface?.room && !roomIds.has(entity.surface.room)) {
    add(issues, severity(mode, true), 'ANYO_SURFACE_ROOM_NOT_FOUND', `${path}/surface/room`, `Surface references missing room "${entity.surface.room}".`)
  }
  if (entity.material && !materialIds.has(entity.material)) {
    add(issues, severity(mode, true), 'ANYO_MATERIAL_NOT_FOUND', `${path}/material`, `Material "${entity.material}" does not exist.`)
  }
  if (entity.type === 'geometry' && typeof entity.geometry === 'string' && !geometryIds.has(entity.geometry)) {
    add(issues, severity(mode, true), 'ANYO_GEOMETRY_NOT_FOUND', `${path}/geometry`, `Geometry "${entity.geometry}" does not exist.`)
  }
  for (const [binding, materialId] of Object.entries(entity.materialBindings ?? {})) {
    if (!materialIds.has(materialId)) add(issues, severity(mode, true), 'ANYO_MATERIAL_NOT_FOUND', `${path}/materialBindings/${binding}`, `Material "${materialId}" does not exist.`)
  }
  if (entity.asset && !assetIds.has(entity.asset)) {
    add(issues, severity(mode, true), 'ANYO_ASSET_NOT_FOUND', `${path}/asset`, `Asset "${entity.asset}" does not exist.`)
  }
  if (entity.type && !BUILTIN_ENTITY_TYPES.has(entity.type) && !has(options.entityTypeRegistry, entity.type)) {
    add(issues, severity(mode, true), 'ANYO_ENTITY_TYPE_NOT_REGISTERED', `${path}/type`, `Entity type "${entity.type}" is not registered.`)
  }
  if (entity.interaction) inspectAction(entity.interaction, `${path}/interaction`, options, mode, issues)
  for (const [event, actions] of Object.entries(entity.events ?? {})) actions.forEach((action, index) => inspectAction(action, `${path}/events/${event}/${index}`, options, mode, issues))
  for (const [index, action] of (entity.trigger?.onEnter ?? []).entries()) inspectAction(action, `${path}/trigger/onEnter/${index}`, options, mode, issues)
  for (const [index, action] of (entity.trigger?.onLeave ?? []).entries()) inspectAction(action, `${path}/trigger/onLeave/${index}`, options, mode, issues)
  if (entity.type === 'web-surface' && entity.webSurface?.source.type === 'app') {
    const app = entity.webSurface.source.app
    if (!has(options.webSurfaceRegistry, app)) {
      add(issues, severity(mode, true), 'ANYO_WEB_SURFACE_APP_NOT_REGISTERED', `${path}/webSurface/source/app`, `Web-surface app "${app}" is not registered.`)
    }
  }
  inspectComponents(entity, path, options, mode, issues)
  entity.children?.forEach((child, index) => inspectEntity(child, `${path}/children/${index}`, document, roomIds, materialIds, assetIds, geometryIds, options, mode, issues))
}

function inspectBindings(value: unknown, path: string, data: unknown, options: WorldValidationOptions, mode: ValidationMode, issues: ValidationIssue[], seen = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object') return
  if (seen.has(value as object)) return
  seen.add(value as object)
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectBindings(item, `${path}/${index}`, data, options, mode, issues, seen))
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record.$bind === 'string') {
    try {
      const resolved = getDataPath(data, record.$bind)
      if (resolved === undefined) {
        const withFallback = Object.prototype.hasOwnProperty.call(record, 'fallback')
        const fallbackSeverity = withFallback && options.missingBindingWithFallback !== 'error' ? 'warning' : severity(mode, true)
        add(issues, fallbackSeverity, 'ANYO_BINDING_PATH_NOT_FOUND', `${path}/$bind`, `Binding path "${record.$bind}" does not exist in initial world data.`)
      }
    } catch (error) {
      add(issues, 'error', 'ANYO_BINDING_PATH_UNSAFE', `${path}/$bind`, String(error))
    }
    return
  }
  for (const [key, child] of Object.entries(record)) inspectBindings(child, `${path}/${key}`, data, options, mode, issues, seen)
}

function inspectRenderer(document: WorldDocument, info: RendererInfo | undefined, mode: ValidationMode, issues: ValidationIssue[]): void {
  if (!info) return
  const caps = info.capabilities
  for (const [assetId, asset] of Object.entries(document.assets ?? {})) {
    if (!asset.format || !asset.type || !caps.assetFormats) continue
    const formats = caps.assetFormats[asset.type]
    if (!formats?.includes(asset.format.toLowerCase())) {
      add(issues, severity(mode, true), 'ANYO_ASSET_LOADER_NOT_REGISTERED', `/assets/${assetId}/format`, `Asset "${assetId}" format "${asset.format}" is not supported by renderer "${info.name}".`)
    }
  }
  const channels: Array<[keyof MaterialDefinition, string]> = [
    ['baseColorTexture', 'baseColor'], ['normalTexture', 'normal'], ['roughnessTexture', 'roughness'],
    ['metalnessTexture', 'metalness'], ['metallicRoughnessTexture', 'metallicRoughness'], ['emissiveTexture', 'emissive'], ['occlusionTexture', 'occlusion'],
  ]
  for (const [materialId, material] of Object.entries(document.materials ?? {})) {
    for (const [field, channel] of channels) {
      if (material[field] && !caps.materialTextureChannels?.includes(channel as never)) {
        add(issues, severity(mode, true), 'ANYO_MATERIAL_TEXTURE_UNSUPPORTED', `/materials/${materialId}/${field}`, `Renderer "${info.name}" does not support material texture channel "${channel}".`)
      }
    }
    const features: Array<[keyof MaterialDefinition, NonNullable<RendererInfo['capabilities']['materialFeatures']>[number]]> = [
      ['normalScale', 'normalScale'], ['occlusionStrength', 'occlusionStrength'], ['emissiveIntensity', 'emissiveIntensity'],
      ['transmission', 'transmission'], ['ior', 'ior'], ['thickness', 'thickness'], ['attenuationDistance', 'attenuation'], ['textureTransform', 'textureTransform'], ['textureWrap', 'textureWrap'], ['toon', 'toonShading'],
    ]
    for (const [field, feature] of features) {
      if (material[field] !== undefined && !caps.materialFeatures?.includes(feature)) {
        add(issues, severity(mode, true), 'ANYO_MATERIAL_FEATURE_UNSUPPORTED', `/materials/${materialId}/${field}`, `Renderer "${info.name}" does not support material feature "${feature}".`)
      }
    }
  }
  for (const [id, material] of Object.entries(document.materials ?? {})) {
    if (material.shadingModel === 'mtoon' && !caps.materialFeatures?.includes('mtoonShading')) {
      add(issues, severity(mode, true), 'ANYO_MTOON_UNSUPPORTED', `/materials/${id.replace(/~/g, '~0').replace(/\//g, '~1')}/shadingModel`, `Renderer "${info.name}" does not support MToon shading.`)
    }
  }

  if (document.environment?.visualStyle?.profile && !['standard', 'anime-rpg'].includes(document.environment.visualStyle.profile) && !caps.materialFeatures?.includes('toonShading')) add(issues, severity(mode, true), 'ANYO_VISUAL_STYLE_UNSUPPORTED', '/environment/visualStyle', `Renderer "${info.name}" does not support toon shading.`)
  if (document.environment?.colorManagement && caps.colorManagement === false) add(issues, severity(mode, true), 'ANYO_COLOR_MANAGEMENT_UNSUPPORTED', '/environment/colorManagement', `Renderer "${info.name}" does not support world color-management recommendations.`)
  if (document.environment?.lighting && caps.environmentLighting === false) add(issues, severity(mode, true), 'ANYO_ENVIRONMENT_LIGHTING_UNSUPPORTED', '/environment/lighting', `Renderer "${info.name}" does not support environment lighting.`)
  if (document.environment?.lighting?.environmentMap && !caps.environmentMaps) add(issues, 'warning', 'ANYO_ENVIRONMENT_MAP_UNSUPPORTED', '/environment/lighting/environmentMap', `Renderer "${info.name}" cannot use the requested environment map; a fallback environment should be provided.`)
  if (document.environment?.atmosphere?.enabled && caps.atmosphere === false) add(issues, severity(mode, true), 'ANYO_ATMOSPHERE_UNSUPPORTED', '/environment/atmosphere', `Renderer "${info.name}" does not support atmospheric depth.`)
  if (document.environment?.postProcessing?.colorGrading?.enabled && caps.colorGrading === false) add(issues, severity(mode, true), 'ANYO_COLOR_GRADING_UNSUPPORTED', '/environment/postProcessing/colorGrading', `Renderer "${info.name}" does not support color grading.`)
  if ((document.environment?.sun?.castShadow || document.environment?.sun?.shadows) && !caps.shadows) add(issues, 'warning', 'ANYO_SHADOWS_UNSUPPORTED', '/environment/sun/castShadow', `Renderer "${info.name}" cannot render the requested sun shadows.`)
}

export function inspectWorldSemantics(document: WorldDocument, options: WorldValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const mode = options.mode ?? 'permissive'
  inspectUnknownFields(document, TOP_LEVEL_FIELDS, '', mode, issues)
  for (const key of Object.keys(document.extensions ?? {})) {
    if (!key.includes('.')) add(issues, mode === 'generator' ? 'error' : 'warning', 'ANYO_EXTENSION_NAMESPACE_REQUIRED', `/extensions/${key}`, `Extension namespace "${key}" must be namespaced.`)
  }
  const floors = document.building?.floors ?? []
  const floorIds = new Set(floors.map((floor) => floor.id))
  const rooms = floors.flatMap((floor) => floor.rooms)
  const roomIds = new Set(rooms.map((room) => room.id))
  const materialIds = new Set(Object.keys(document.materials ?? {}))
  const assetIds = new Set(Object.keys(document.assets ?? {}))
  const geometryIds = new Set(Object.keys(document.geometries ?? {}))

  const environmentMap = document.environment?.lighting?.environmentMap
  if (environmentMap && !assetIds.has(environmentMap)) add(issues, severity(mode, true), 'ANYO_ENVIRONMENT_MAP_ASSET_NOT_FOUND', '/environment/lighting/environmentMap', `Environment-map asset "${environmentMap}" does not exist.`)

  for (const [floorIndex, floor] of floors.entries()) {
    for (const [roomIndex, room] of floor.rooms.entries()) {
      const roomPath = `/building/floors/${floorIndex}/rooms/${roomIndex}`
      for (const field of ['wall', 'floor', 'ceiling'] as const) {
        const material = room.materials?.[field]
        if (material && !materialIds.has(material)) add(issues, severity(mode, true), 'ANYO_MATERIAL_NOT_FOUND', `${roomPath}/materials/${field}`, `Material "${material}" does not exist.`)
      }
      for (const [openingIndex, opening] of (room.openings ?? []).entries()) {
        if (opening.material && !materialIds.has(opening.material)) add(issues, severity(mode, true), 'ANYO_MATERIAL_NOT_FOUND', `${roomPath}/openings/${openingIndex}/material`, `Material "${opening.material}" does not exist.`)
        if (opening.automatic) add(issues, 'warning', 'ANYO_AUTOMATIC_DOOR_SYSTEM_REQUIRED', `${roomPath}/openings/${openingIndex}/automatic`, 'Automatic door intent requires an installed trigger/action/animation system; it does not automatically open the door.')
      }
      room.entities?.forEach((entity, index) => inspectEntity(entity, `${roomPath}/entities/${index}`, document, roomIds, materialIds, assetIds, geometryIds, options, mode, issues))
    }
    for (const [stairIndex, stair] of (floor.stairs ?? []).entries()) {
      if (stair.material && !materialIds.has(stair.material)) add(issues, severity(mode, true), 'ANYO_MATERIAL_NOT_FOUND', `/building/floors/${floorIndex}/stairs/${stairIndex}/material`, `Material "${stair.material}" does not exist.`)
      if (!floorIds.has(stair.fromFloor) || !floorIds.has(stair.toFloor)) continue
    }
  }
  document.entities?.forEach((entity, index) => inspectEntity(entity, `/entities/${index}`, document, roomIds, materialIds, assetIds, geometryIds, options, mode, issues))
  for (const [name, prefab] of Object.entries(document.prefabs ?? {})) inspectEntity({ ...prefab, id: prefab.id ?? `@prefab:${name}` }, `/prefabs/${name}`, document, roomIds, materialIds, assetIds, geometryIds, options, mode, issues)
  for (const [name, composition] of Object.entries(document.compositions ?? {})) inspectEntity({ ...composition, id: composition.id ?? `@composition:${name}`, type: 'group' }, `/compositions/${name}`, document, roomIds, materialIds, assetIds, geometryIds, options, mode, issues)
  for (const [event, actions] of Object.entries(document.events ?? {})) actions.forEach((action, index) => inspectAction(action, `/events/${event}/${index}`, options, mode, issues))
  if (document.exploration?.spawn?.room && !roomIds.has(document.exploration.spawn.room)) add(issues, severity(mode, true), 'ANYO_SPAWN_ROOM_NOT_FOUND', '/exploration/spawn/room', `Spawn room "${document.exploration.spawn.room}" does not exist.`)
  inspectBindings(document, '', document.data ?? {}, options, mode, issues)
  inspectRenderer(document, options.rendererInfo, mode, issues)
  return issues
}
