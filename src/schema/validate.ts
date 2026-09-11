import type { EntityDefinition, Vec3, WorldDocument, WorldValidationOptions } from '../core/types.js'
import { AnyoValidationError, type ValidationIssue } from './errors.js'
import { inspectWorldSemantics } from './semantic.js'
import { inspectArchitectureDocument } from './architecture.js'

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

function issue(
  issues: ValidationIssue[],
  code: string,
  path: string,
  message: string,
  suggestion?: string,
  severity: 'error' | 'warning' = 'error',
): void {
  issues.push({ severity, code, path, message, suggestion })
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteVector(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}


function validateShadowDefinition(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    issue(issues, 'SHADOW_CONFIGURATION_INVALID', path, 'Shadow configuration must be an object.')
    return
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') issue(issues, 'SHADOW_ENABLED_INVALID', `${path}/enabled`, 'Shadow enabled must be boolean.')
  if (value.mapSize !== undefined && (!Number.isFinite(value.mapSize) || Number(value.mapSize) < 64 || Number(value.mapSize) > 4096)) issue(issues, 'SHADOW_MAP_SIZE_INVALID', `${path}/mapSize`, 'Shadow mapSize must be between 64 and 4096.')
  for (const field of ['bias', 'normalBias', 'softness', 'cameraPadding'] as const) {
    const raw = value[field]
    if (raw !== undefined && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)) issue(issues, 'SHADOW_VALUE_INVALID', `${path}/${field}`, `${field} must be a finite non-negative number.`)
  }
  if (typeof value.softness === 'number' && value.softness > 2) issue(issues, 'SHADOW_SOFTNESS_INVALID', `${path}/softness`, 'Shadow softness must not exceed 2.')
  if (value.filter !== undefined && !['hard', 'pcf3', 'pcf5', 'poisson'].includes(String(value.filter))) issue(issues, 'SHADOW_FILTER_INVALID', `${path}/filter`, 'Shadow filter must be hard, pcf3, pcf5, or poisson.')
  for (const field of ['cascadeBlend', 'distanceFade'] as const) {
    const raw = value[field]
    if (raw !== undefined && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1)) issue(issues, 'SHADOW_BLEND_INVALID', `${path}/${field}`, `${field} must be between 0 and 1.`)
  }
}

function validateEnvironment(document: WorldDocument, issues: ValidationIssue[]): void {
  const environment = document.environment
  if (!environment) return
  if (environment.ambientLight?.intensity !== undefined) {
    const value = environment.ambientLight.intensity
    if (!Number.isFinite(value) || value < 0) issue(issues, 'ENVIRONMENT_AMBIENT_INTENSITY_INVALID', '/environment/ambientLight/intensity', 'Ambient intensity must be finite and non-negative.')
    else if (value > 2) issue(issues, 'ENVIRONMENT_AMBIENT_INTENSITY_HIGH', '/environment/ambientLight/intensity', 'Ambient intensity above 2 commonly flattens material contrast.', 'Start between 0.15 and 0.6, then calibrate with exposure.', 'warning')
  }
  const lighting = environment.lighting
  if (lighting) {
    if (lighting.enabled !== undefined && typeof lighting.enabled !== 'boolean') issue(issues, 'ENVIRONMENT_LIGHTING_ENABLED_INVALID', '/environment/lighting/enabled', 'Environment lighting enabled must be boolean.')
    for (const field of ['diffuseIntensity', 'specularIntensity'] as const) {
      const value = lighting[field]
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) issue(issues, 'ENVIRONMENT_LIGHTING_VALUE_INVALID', `/environment/lighting/${field}`, `${field} must be finite and non-negative.`)
    }
    if (lighting.environmentMap !== undefined && (typeof lighting.environmentMap !== 'string' || !lighting.environmentMap.trim())) issue(issues, 'ENVIRONMENT_MAP_INVALID', '/environment/lighting/environmentMap', 'environmentMap must be a non-empty asset id.')
    if (lighting.environmentRotation !== undefined && !Number.isFinite(lighting.environmentRotation)) issue(issues, 'ENVIRONMENT_ROTATION_INVALID', '/environment/lighting/environmentRotation', 'environmentRotation must be finite radians.')
  }
  const color = environment.colorManagement
  if (color) {
    if (color.toneMapping !== undefined && !['none', 'reinhard', 'aces'].includes(color.toneMapping)) issue(issues, 'TONE_MAPPING_INVALID', '/environment/colorManagement/toneMapping', 'toneMapping must be none, reinhard, or aces.')
    if (color.outputColorSpace !== undefined && !['srgb', 'linear'].includes(color.outputColorSpace)) issue(issues, 'OUTPUT_COLOR_SPACE_INVALID', '/environment/colorManagement/outputColorSpace', 'outputColorSpace must be srgb or linear.')
    if (color.exposure !== undefined && (!Number.isFinite(color.exposure) || color.exposure < 0 || color.exposure > 8)) issue(issues, 'EXPOSURE_INVALID', '/environment/colorManagement/exposure', 'Exposure must be between 0 and 8.')
  }
  validateShadowDefinition(environment.shadows, '/environment/shadows', issues)
  validateShadowDefinition(environment.sun?.shadow, '/environment/sun/shadow', issues)
  if (environment.sky !== undefined) {
    const sky = environment.sky
    const path = '/environment/sky'
    if (!isRecord(sky)) issue(issues, 'PROCEDURAL_SKY_INVALID', path, 'Procedural sky configuration must be an object.')
    else {
      if (sky.enabled !== undefined && typeof sky.enabled !== 'boolean') issue(issues, 'PROCEDURAL_SKY_ENABLED_INVALID', `${path}/enabled`, 'enabled must be boolean.')
      for (const field of ['width', 'height'] as const) {
        const value = sky[field]
        if (value !== undefined && (!Number.isInteger(value) || Number(value) < 2 || Number(value) > 4096)) issue(issues, 'PROCEDURAL_SKY_DIMENSION_INVALID', `${path}/${field}`, `${field} must be an integer between 2 and 4096.`)
      }
      for (const field of ['sunSize', 'sunIntensity', 'haze', 'cloudCoverage', 'cloudDensity'] as const) {
        const value = sky[field]
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) issue(issues, 'PROCEDURAL_SKY_VALUE_INVALID', `${path}/${field}`, `${field} must be finite and non-negative.`)
      }
      for (const field of ['haze', 'cloudCoverage'] as const) {
        const value = sky[field]
        if (typeof value === 'number' && value > 1) issue(issues, 'PROCEDURAL_SKY_RATIO_INVALID', `${path}/${field}`, `${field} must not exceed 1.`)
      }
      if (sky.sunDirection !== undefined && !isFiniteVector(sky.sunDirection, 3)) issue(issues, 'PROCEDURAL_SKY_DIRECTION_INVALID', `${path}/sunDirection`, 'sunDirection must contain three finite numbers.')
      if (sky.seed !== undefined && (typeof sky.seed !== 'number' || !Number.isFinite(sky.seed))) issue(issues, 'PROCEDURAL_SKY_SEED_INVALID', `${path}/seed`, 'seed must be finite.')
    }
  }
  if (environment.sun?.intensity !== undefined) {
    const value = environment.sun.intensity
    if (!Number.isFinite(value) || value < 0) issue(issues, 'SUN_INTENSITY_INVALID', '/environment/sun/intensity', 'Sun intensity must be finite and non-negative.')
    else if (value > 8) issue(issues, 'SUN_INTENSITY_HIGH', '/environment/sun/intensity', 'Sun intensity above 8 is likely to clip after tone mapping.', 'Use exposure for global brightness and keep the sun near 0.5–3.', 'warning')
  }
  if (environment.imageQuality?.maxAnisotropy !== undefined && (!Number.isInteger(environment.imageQuality.maxAnisotropy) || environment.imageQuality.maxAnisotropy < 1 || environment.imageQuality.maxAnisotropy > 16)) issue(issues, 'ANISOTROPY_INVALID', '/environment/imageQuality/maxAnisotropy', 'maxAnisotropy must be an integer between 1 and 16.')
  if (environment.imageQuality?.dithering !== undefined && typeof environment.imageQuality.dithering !== 'boolean') issue(issues, 'DITHERING_INVALID', '/environment/imageQuality/dithering', 'dithering must be boolean.')
  if (environment.imageQuality?.antialiasing !== undefined && !['none', 'fxaa'].includes(environment.imageQuality.antialiasing)) issue(issues, 'ANTIALIASING_INVALID', '/environment/imageQuality/antialiasing', 'antialiasing must be none or fxaa.')
  if (environment.imageQuality?.sharpen !== undefined && (!Number.isFinite(environment.imageQuality.sharpen) || environment.imageQuality.sharpen < 0 || environment.imageQuality.sharpen > 1)) issue(issues, 'SHARPEN_INVALID', '/environment/imageQuality/sharpen', 'sharpen must be between 0 and 1.')
}

function validateWebSurfaceTarget(target: NonNullable<EntityDefinition['webSurface']>['target'], path: string, issues: ValidationIssue[]): void {
  if (!target) return
  if (target.type === 'plane') {
    if (target.size !== undefined && (!isFiniteVector(target.size, 2) || !target.size.every((value) => value > 0))) {
      issue(issues, 'WEB_SURFACE_TARGET_SIZE_INVALID', `${path}/size`, 'Plane target size must contain two positive finite numbers.')
    }
    return
  }
  if (target.type === 'wall') {
    if (!target.room?.trim()) issue(issues, 'WEB_SURFACE_TARGET_ROOM_REQUIRED', `${path}/room`, 'Wall targets require a non-empty room id.')
    if (!target.wall?.trim()) issue(issues, 'WEB_SURFACE_TARGET_WALL_REQUIRED', `${path}/wall`, 'Wall targets require a non-empty wall name.')
    if (target.offset !== undefined && !isFiniteVector(target.offset, 2)) {
      issue(issues, 'WEB_SURFACE_TARGET_OFFSET_INVALID', `${path}/offset`, 'Wall target offset must contain two finite numbers.')
    }
    return
  }
  if (!target.entity?.trim()) issue(issues, 'WEB_SURFACE_TARGET_ENTITY_REQUIRED', `${path}/entity`, 'Entity-slot and mesh targets require a non-empty entity reference.')
  if (target.type === 'entity-slot') {
    if (!target.slot?.trim()) issue(issues, 'WEB_SURFACE_TARGET_SLOT_REQUIRED', `${path}/slot`, 'Entity-slot targets require a non-empty slot name.')
    return
  }
  if (target.mesh !== undefined && !target.mesh.trim()) issue(issues, 'WEB_SURFACE_TARGET_MESH_INVALID', `${path}/mesh`, 'Mesh target names must be non-empty when provided.')
  if (target.materialSlot !== undefined && (!Number.isInteger(target.materialSlot) || target.materialSlot < 0)) {
    issue(issues, 'WEB_SURFACE_TARGET_MATERIAL_SLOT_INVALID', `${path}/materialSlot`, 'Material-slot indices must be non-negative integers.')
  }
  if (target.uvSet !== undefined && (!Number.isInteger(target.uvSet) || target.uvSet < 0)) {
    issue(issues, 'WEB_SURFACE_TARGET_UV_SET_INVALID', `${path}/uvSet`, 'UV-set indices must be non-negative integers.')
  }
}

function validateSurfaceHostComponent(component: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  if (component.enabled === false) return
  if (!isRecord(component.slots) || Object.keys(component.slots).length === 0) {
    issue(issues, 'SURFACE_HOST_SLOTS_REQUIRED', `${path}/slots`, 'Enabled anyo.surface-host components require at least one named slot.')
    return
  }
  for (const [slotName, rawSlot] of Object.entries(component.slots)) {
    const slotPath = `${path}/slots/${slotName}`
    if (!slotName.trim()) issue(issues, 'SURFACE_HOST_SLOT_NAME_INVALID', `${path}/slots`, 'Surface-host slot names must be non-empty.')
    if (!isRecord(rawSlot)) {
      issue(issues, 'SURFACE_HOST_SLOT_INVALID', slotPath, 'Surface-host slots must be objects.')
      continue
    }
    if (typeof rawSlot.mesh !== 'string' || !rawSlot.mesh.trim()) issue(issues, 'SURFACE_HOST_SLOT_MESH_REQUIRED', `${slotPath}/mesh`, 'Surface-host slots require a non-empty mesh name.')
    if (!Number.isInteger(rawSlot.materialSlot) || Number(rawSlot.materialSlot) < 0) issue(issues, 'SURFACE_HOST_MATERIAL_SLOT_INVALID', `${slotPath}/materialSlot`, 'Surface-host materialSlot must be a non-negative integer.')
    if (rawSlot.uvSet !== undefined && (!Number.isInteger(rawSlot.uvSet) || Number(rawSlot.uvSet) < 0)) issue(issues, 'SURFACE_HOST_UV_SET_INVALID', `${slotPath}/uvSet`, 'Surface-host uvSet must be a non-negative integer.')
  }
}


function validateGeoCoordinate(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) { issue(issues, 'MAP_ORIGIN_INVALID', path, 'Map origin must be an object containing latitude and longitude.'); return }
  if (typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90) issue(issues, 'MAP_LATITUDE_INVALID', `${path}/latitude`, 'Latitude must be between -90 and 90.')
  if (typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180) issue(issues, 'MAP_LONGITUDE_INVALID', `${path}/longitude`, 'Longitude must be between -180 and 180.')
  if (value.altitude !== undefined && (typeof value.altitude !== 'number' || !Number.isFinite(value.altitude))) issue(issues, 'MAP_ALTITUDE_INVALID', `${path}/altitude`, 'Altitude must be finite when provided.')
}

function validateMapComponent(component: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  if ((component.enabled ?? true) === false) return
  validateGeoCoordinate(component.origin, `${path}/origin`, issues)
  if (component.provider !== undefined && (typeof component.provider !== 'string' || !component.provider.trim())) issue(issues, 'MAP_PROVIDER_INVALID', `${path}/provider`, 'Map provider must be a non-empty string.')
  if (component.attribution !== undefined && (typeof component.attribution !== 'string' || !component.attribution.trim())) issue(issues, 'MAP_ATTRIBUTION_INVALID', `${path}/attribution`, 'Map attribution must be a non-empty string.')
  if (isRecord(component.cell)) {
    if (!Number.isInteger(component.cell.zoom) || Number(component.cell.zoom) < 0 || Number(component.cell.zoom) > 22) issue(issues, 'MAP_CELL_ZOOM_INVALID', `${path}/cell/zoom`, 'Map cell zoom must be an integer between 0 and 22.')
    for (const key of ['x', 'y'] as const) if (!Number.isInteger(component.cell[key]) || Number(component.cell[key]) < 0) issue(issues, 'MAP_CELL_COORDINATE_INVALID', `${path}/cell/${key}`, `Map cell ${key} must be a non-negative integer.`)
  }
}

function validateMapRing(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value) || value.length < 3) { issue(issues, 'MAP_FOOTPRINT_INVALID', path, 'Building footprints require at least three points.'); return }
  value.forEach((point, index) => { if (!isFiniteVector(point, 2)) issue(issues, 'MAP_FOOTPRINT_POINT_INVALID', `${path}/${index}`, 'Map footprint points must contain two finite numbers.') })
}

function validateMapFeatureComponent(component: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  if ((component.enabled ?? true) === false) return
  if (typeof component.featureType !== 'string' || !component.featureType.trim()) issue(issues, 'MAP_FEATURE_TYPE_REQUIRED', `${path}/featureType`, 'Map features require a non-empty featureType.')
  if (component.featureType === 'building') {
    validateMapRing(component.footprint, `${path}/footprint`, issues)
    if (component.holes !== undefined) {
      if (!Array.isArray(component.holes)) issue(issues, 'MAP_HOLES_INVALID', `${path}/holes`, 'Map building holes must be an array of rings.')
      else component.holes.forEach((ring, index) => validateMapRing(ring, `${path}/holes/${index}`, issues))
    }
    if (typeof component.height !== 'number' || !Number.isFinite(component.height) || component.height <= 0) issue(issues, 'MAP_HEIGHT_INVALID', `${path}/height`, 'Map building height must be positive.')
    if (component.minHeight !== undefined && (typeof component.minHeight !== 'number' || !Number.isFinite(component.minHeight) || component.minHeight < 0)) issue(issues, 'MAP_MIN_HEIGHT_INVALID', `${path}/minHeight`, 'Map building minHeight must be non-negative.')
    if (typeof component.height === 'number' && typeof component.minHeight === 'number' && component.height <= component.minHeight) issue(issues, 'MAP_HEIGHT_ORDER_INVALID', path, 'Map building height must be greater than minHeight.')
  }
  if (component.generated !== undefined && typeof component.generated !== 'boolean') issue(issues, 'MAP_GENERATED_INVALID', `${path}/generated`, 'generated must be boolean.')
  if (component.layer !== undefined && !['base', 'official', 'community', 'private'].includes(String(component.layer))) issue(issues, 'MAP_LAYER_INVALID', `${path}/layer`, 'Map layer must be base, official, community, or private.')
}

function validateVfxComponent(component: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  if ((component.enabled ?? true) === false) return
  if (component.effect !== undefined && component.effect !== 'sprite-particles') {
    issue(issues, 'VFX_EFFECT_UNSUPPORTED', `${path}/effect`, 'Anyo VFX 0.1 supports only sprite-particles.')
  }
  if (component.preset !== undefined && !['smoke', 'sparks', 'dust', 'custom'].includes(String(component.preset))) {
    issue(issues, 'VFX_PRESET_UNSUPPORTED', `${path}/preset`, 'VFX preset must be smoke, sparks, dust, or custom.')
  }
  if (component.maxParticles !== undefined && (!Number.isInteger(component.maxParticles) || Number(component.maxParticles) < 1 || Number(component.maxParticles) > 4096)) {
    issue(issues, 'VFX_MAX_PARTICLES_INVALID', `${path}/maxParticles`, 'VFX maxParticles must be an integer between 1 and 4096.')
  }
  for (const key of ['autoplay', 'playOnStart', 'loop'] as const) {
    if (component[key] !== undefined && typeof component[key] !== 'boolean') issue(issues, 'VFX_BOOLEAN_INVALID', `${path}/${key}`, `${key} must be boolean.`)
  }
  if (component.space !== undefined && component.space !== 'local' && component.space !== 'world') issue(issues, 'VFX_SPACE_INVALID', `${path}/space`, 'VFX space must be local or world.')
  if (component.texture !== undefined && typeof component.texture !== 'string') issue(issues, 'VFX_TEXTURE_INVALID', `${path}/texture`, 'VFX texture must be a string URL.')
  const validateRange = (key: 'lifetime' | 'speed'): void => {
    const value = component[key]
    if (value === undefined) return
    if (!value || typeof value !== 'object' || Array.isArray(value)) { issue(issues, 'VFX_RANGE_INVALID', `${path}/${key}`, `${key} must be an object.`); return }
    const range = value as Record<string, unknown>
    for (const field of ['min', 'max']) if (range[field] !== undefined && (typeof range[field] !== 'number' || !Number.isFinite(range[field]) || Number(range[field]) < 0)) issue(issues, 'VFX_RANGE_VALUE_INVALID', `${path}/${key}/${field}`, `${key}.${field} must be a non-negative finite number.`)
    if (typeof range.min === 'number' && typeof range.max === 'number' && range.max < range.min) issue(issues, 'VFX_RANGE_ORDER_INVALID', `${path}/${key}`, `${key}.max must be greater than or equal to ${key}.min.`)
  }
  validateRange('lifetime'); validateRange('speed')
  const emission = component.emission
  if (emission !== undefined) {
    if (!emission || typeof emission !== 'object' || Array.isArray(emission)) issue(issues, 'VFX_EMISSION_INVALID', `${path}/emission`, 'VFX emission must be an object.')
    else for (const field of ['rate', 'burst']) { const value=(emission as Record<string,unknown>)[field]; if(value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||value<0)) issue(issues,'VFX_EMISSION_VALUE_INVALID',`${path}/emission/${field}`,`emission.${field} must be a non-negative finite number.`) }
  }
  const shape = component.spawnShape
  if (shape !== undefined) {
    if (!shape || typeof shape !== 'object' || Array.isArray(shape)) issue(issues, 'VFX_SPAWN_SHAPE_INVALID', `${path}/spawnShape`, 'VFX spawnShape must be an object.')
    else { const data=shape as Record<string,unknown>; if(!['point','sphere','box'].includes(String(data.type))) issue(issues,'VFX_SPAWN_SHAPE_TYPE_INVALID',`${path}/spawnShape/type`,'Spawn shape type must be point, sphere, or box.'); if(data.type==='sphere'&&(typeof data.radius!=='number'||!Number.isFinite(data.radius)||data.radius<=0)) issue(issues,'VFX_SPAWN_RADIUS_INVALID',`${path}/spawnShape/radius`,'Sphere spawn radius must be positive.'); if(data.type==='box'&&(!isFiniteVector(data.size,3)||(data.size as number[]).some(value=>value<=0))) issue(issues,'VFX_SPAWN_SIZE_INVALID',`${path}/spawnShape/size`,'Box spawn size must contain three positive finite values.') }
  }
}

function validateEntity(
  entity: EntityDefinition,
  path: string,
  issues: ValidationIssue[],
  prefabs: WorldDocument['prefabs'],
  entityIds: Set<string>,
  namespace = '',
  allowMissingType = false,
): void {
  const effectiveId = namespace && entity.id ? `${namespace}/${entity.id}` : entity.id
  if (!entity.id?.trim()) issue(issues, 'ENTITY_ID_REQUIRED', `${path}/id`, 'Entity id must be a non-empty string.')
  else if (entityIds.has(effectiveId)) issue(issues, 'ENTITY_ID_DUPLICATE', `${path}/id`, `Entity id "${effectiveId}" is duplicated.`)
  else entityIds.add(effectiveId)

  if (!allowMissingType && !entity.type?.trim() && !entity.use?.trim()) {
    issue(issues, 'ENTITY_TYPE_REQUIRED', path, 'Entity must provide either type or use.')
  }
  if (entity.use && !prefabs?.[entity.use]) {
    issue(issues, 'PREFAB_NOT_FOUND', `${path}/use`, `Prefab "${entity.use}" does not exist.`)
  }
  if (entity.position !== undefined && !isFiniteVector(entity.position, 3)) {
    issue(issues, 'ENTITY_POSITION_INVALID', `${path}/position`, 'Position must contain three finite numbers.')
  }
  if (entity.rotation !== undefined && !isFiniteVector(entity.rotation, 3)) {
    issue(issues, 'ENTITY_ROTATION_INVALID', `${path}/rotation`, 'Rotation must contain three finite numbers.')
  }
  if (Array.isArray(entity.scale) && !isFiniteVector(entity.scale, 3)) {
    issue(issues, 'ENTITY_SCALE_INVALID', `${path}/scale`, 'Scale must be a finite number or three finite numbers.')
  } else if (typeof entity.scale === 'number' && !Number.isFinite(entity.scale)) {
    issue(issues, 'ENTITY_SCALE_INVALID', `${path}/scale`, 'Scale must be finite.')
  }
  if (entity.repeat) {
    if (!Number.isInteger(entity.repeat.count) || entity.repeat.count < 1) {
      issue(issues, 'REPEAT_COUNT_INVALID', `${path}/repeat/count`, 'Repeat count must be a positive integer.')
    }
    if (!Number.isFinite(entity.repeat.spacing)) {
      issue(issues, 'REPEAT_SPACING_INVALID', `${path}/repeat/spacing`, 'Repeat spacing must be finite.')
    }
  }
  if (entity.type === 'light') {
    if (entity.intensity !== undefined && typeof entity.intensity === 'number') {
      if (!Number.isFinite(entity.intensity) || entity.intensity < 0) issue(issues, 'LIGHT_INTENSITY_INVALID', `${path}/intensity`, 'Light intensity must be finite and non-negative.')
      else if (entity.intensity > 100) issue(issues, 'LIGHT_INTENSITY_HIGH', `${path}/intensity`, 'Light intensity above 100 is likely to overexpose nearby surfaces.', 'Start between 1 and 20 and use range plus decay to shape local light.', 'warning')
    }
    if (entity.range !== undefined && typeof entity.range === 'number' && (!Number.isFinite(entity.range) || entity.range <= 0)) issue(issues, 'LIGHT_RANGE_INVALID', `${path}/range`, 'Point-light range must be a positive finite number.')
    if (entity.decay !== undefined && typeof entity.decay === 'number' && (!Number.isFinite(entity.decay) || entity.decay <= 0 || entity.decay > 4)) issue(issues, 'LIGHT_DECAY_INVALID', `${path}/decay`, 'Point-light decay must be greater than 0 and no more than 4.')
    if (entity.castShadow !== undefined && typeof entity.castShadow !== 'boolean' && !(isRecord(entity.castShadow) && typeof entity.castShadow.$bind === 'string')) issue(issues, 'LIGHT_CAST_SHADOW_INVALID', `${path}/castShadow`, 'castShadow must be boolean or a binding.')
    validateShadowDefinition(entity.shadow, `${path}/shadow`, issues)
  }
  const componentTypes = new Set((entity.components ?? []).map((component) => component?.type))
  if (entity.type === 'trigger' && !entity.trigger && !componentTypes.has('anyo.trigger')) {
    issue(issues, 'TRIGGER_DEFINITION_REQUIRED', `${path}/trigger`, 'Trigger definition or anyo.trigger component is required for trigger entities.')
  }
  if (entity.type === 'audio' && !entity.audio?.src && !entity.audio?.source && !componentTypes.has('anyo.audio')) {
    issue(issues, 'AUDIO_SOURCE_REQUIRED', `${path}/audio/src`, 'Audio source or anyo.audio component is required for audio entities.')
  }
  if (entity.type === 'web-surface') {
    const web = entity.webSurface
    if (!web || !web.source) {
      issue(issues, 'WEB_SURFACE_SOURCE_REQUIRED', `${path}/webSurface/source`, 'Web-surface entities require a source definition.')
    } else {
      if (web.source.type === 'app' && !web.source.app?.trim()) {
        issue(issues, 'WEB_SURFACE_APP_REQUIRED', `${path}/webSurface/source/app`, 'Registered app sources require a non-empty app id.')
      }
      if (web.source.type === 'url' && !web.source.url?.trim()) {
        issue(issues, 'WEB_SURFACE_URL_REQUIRED', `${path}/webSurface/source/url`, 'URL sources require a non-empty URL.')
      }
      if (web.source.type === 'snapshot' && !web.source.image?.trim()) {
        issue(issues, 'WEB_SURFACE_SNAPSHOT_REQUIRED', `${path}/webSurface/source/image`, 'Snapshot sources require an image URL.')
      }
      validateWebSurfaceTarget(web.target, `${path}/webSurface/target`, issues)
      if ((web.source.type === 'app' || web.source.type === 'url') && !web.fallback) {
        issue(issues, 'WEB_SURFACE_FALLBACK_RECOMMENDED', `${path}/webSurface/fallback`, 'Live web surfaces should provide a snapshot fallback for XR and unsupported environments.', 'Add a snapshot fallback.', 'warning')
      }
      if (web.renderMode === 'snapshot' && web.source.type !== 'snapshot' && !web.fallback) {
        issue(issues, 'WEB_SURFACE_SNAPSHOT_FALLBACK_REQUIRED', `${path}/webSurface/fallback`, 'Snapshot render mode requires a snapshot source or fallback.')
      }
      if (web.renderMode === 'external' && web.source.type !== 'url') {
        issue(issues, 'WEB_SURFACE_EXTERNAL_SOURCE_INVALID', `${path}/webSurface/renderMode`, 'External render mode requires a URL source.')
      }
      if (web.framePolicy?.maxFps !== undefined && (!Number.isFinite(web.framePolicy.maxFps) || web.framePolicy.maxFps <= 0 || web.framePolicy.maxFps > 60)) {
        issue(issues, 'WEB_SURFACE_MAX_FPS_INVALID', `${path}/webSurface/framePolicy/maxFps`, 'Web-surface maxFps must be greater than 0 and no more than 60.')
      }
      const presentation = web.presentation
      if (presentation) {
        if (presentation.type !== 'texture') {
          issue(issues, 'WEB_SURFACE_PRESENTATION_TYPE_INVALID', `${path}/webSurface/presentation/type`, 'Web-surface presentation type must be "texture".')
        }
        if (presentation.resolution && (!isPositiveFinitePair(presentation.resolution))) {
          issue(issues, 'WEB_SURFACE_PRESENTATION_RESOLUTION_INVALID', `${path}/webSurface/presentation/resolution`, 'Texture presentation resolution must contain two positive finite values.')
        }
        if (presentation.transform?.offset && !isFinitePair(presentation.transform.offset)) {
          issue(issues, 'WEB_SURFACE_PRESENTATION_OFFSET_INVALID', `${path}/webSurface/presentation/transform/offset`, 'Texture presentation offset must contain two finite values.')
        }
        if (presentation.transform?.scale && !isPositiveFinitePair(presentation.transform.scale)) {
          issue(issues, 'WEB_SURFACE_PRESENTATION_SCALE_INVALID', `${path}/webSurface/presentation/transform/scale`, 'Texture presentation scale must contain two positive finite values.')
        }
        if (presentation.transform?.rotation !== undefined && !Number.isFinite(presentation.transform.rotation)) {
          issue(issues, 'WEB_SURFACE_PRESENTATION_ROTATION_INVALID', `${path}/webSurface/presentation/transform/rotation`, 'Texture presentation rotation must be finite.')
        }
        if (presentation.emissive?.intensity !== undefined && (!Number.isFinite(presentation.emissive.intensity) || presentation.emissive.intensity < 0 || presentation.emissive.intensity > 100)) {
          issue(issues, 'WEB_SURFACE_PRESENTATION_EMISSIVE_INVALID', `${path}/webSurface/presentation/emissive/intensity`, 'Texture presentation emissive intensity must be between 0 and 100.')
        }
        if (presentation.opacity !== undefined && (!Number.isFinite(presentation.opacity) || presentation.opacity < 0 || presentation.opacity > 1)) {
          issue(issues, 'WEB_SURFACE_PRESENTATION_OPACITY_INVALID', `${path}/webSurface/presentation/opacity`, 'Texture presentation opacity must be between 0 and 1.')
        }
        if (presentation.glass) {
          if (!presentation.glass.mesh?.trim()) {
            issue(issues, 'WEB_SURFACE_PRESENTATION_GLASS_MESH_REQUIRED', `${path}/webSurface/presentation/glass/mesh`, 'Glass overlay mesh must be a non-empty name.')
          }
          if (presentation.glass.materialSlot !== undefined && (!Number.isInteger(presentation.glass.materialSlot) || presentation.glass.materialSlot < 0)) {
            issue(issues, 'WEB_SURFACE_PRESENTATION_GLASS_SLOT_INVALID', `${path}/webSurface/presentation/glass/materialSlot`, 'Glass overlay materialSlot must be a non-negative integer.')
          }
          if (presentation.glass.opacity !== undefined && (!Number.isFinite(presentation.glass.opacity) || presentation.glass.opacity < 0 || presentation.glass.opacity > 1)) {
            issue(issues, 'WEB_SURFACE_PRESENTATION_GLASS_OPACITY_INVALID', `${path}/webSurface/presentation/glass/opacity`, 'Glass overlay opacity must be between 0 and 1.')
          }
        }
      }
      for (const [animationIndex, animation] of (web.animations ?? []).entries()) {
        if (animation.duration !== undefined && (!Number.isFinite(animation.duration) || animation.duration < 0 || animation.duration > 60000)) {
          issue(issues, 'WEB_SURFACE_ANIMATION_DURATION_INVALID', `${path}/webSurface/animations/${animationIndex}/duration`, 'Animation duration must be between 0 and 60000 milliseconds.')
        }
      }
    }
  }
  if (entity.components !== undefined && !Array.isArray(entity.components)) {
    issue(issues, 'ENTITY_COMPONENTS_INVALID', `${path}/components`, 'Components must be an array.')
  } else {
    for (const [componentIndex, component] of (entity.components ?? []).entries()) {
      const componentPath = `${path}/components/${componentIndex}`
      if (!component || typeof component !== 'object' || Array.isArray(component)) {
        issue(issues, 'COMPONENT_INVALID', componentPath, 'Component definitions must be objects.')
        continue
      }
      if (typeof component.type !== 'string' || !component.type.trim()) {
        issue(issues, 'COMPONENT_TYPE_REQUIRED', `${componentPath}/type`, 'Component type must be a non-empty string.')
      } else if (!component.type.includes('.')) {
        issue(issues, 'COMPONENT_TYPE_NAMESPACE_REQUIRED', `${componentPath}/type`, 'Component types must be namespaced, for example "anyo.interactable".')
      }
      if (component.enabled !== undefined && typeof component.enabled !== 'boolean') {
        issue(issues, 'COMPONENT_ENABLED_INVALID', `${componentPath}/enabled`, 'Component enabled must be boolean when provided.')
      }
      if (component.type === 'anyo.map') validateMapComponent(component as Record<string, unknown>, componentPath, issues)
      if (component.type === 'anyo.mapFeature') validateMapFeatureComponent(component as Record<string, unknown>, componentPath, issues)
      if (component.type === 'anyo.vfx') validateVfxComponent(component as Record<string, unknown>, componentPath, issues)
      if (component.type === 'anyo.audio' && (component.enabled ?? true) && typeof component.src !== 'string' && typeof component.source !== 'string') {
        issue(issues, 'AUDIO_COMPONENT_SOURCE_REQUIRED', `${componentPath}/src`, 'Enabled anyo.audio components require a string source or src.')
      }
      if (component.type === 'anyo.trigger' && (component.enabled ?? true) && (!isFiniteVector(component.size, 3) || !(component.size as number[]).every((value) => value > 0))) {
        issue(issues, 'TRIGGER_COMPONENT_SIZE_REQUIRED', `${componentPath}/size`, 'Enabled anyo.trigger components require three positive finite size values.')
      }
      if (component.type === 'anyo.surface-host') validateSurfaceHostComponent(component as Record<string, unknown>, componentPath, issues)
      if (component.type === 'anyo.visibility' && component.visible !== undefined && typeof component.visible !== 'boolean') {
        issue(issues, 'VISIBILITY_COMPONENT_VALUE_INVALID', `${componentPath}/visible`, 'anyo.visibility visible must be boolean when provided.')
      }
    }
  }

  entity.children?.forEach((child, index) => {
    validateEntity(child, `${path}/children/${index}`, issues, prefabs, entityIds, effectiveId)
  })
}

export function inspectWorldDocument(document: WorldDocument, options: WorldValidationOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = []

  if (!document || typeof document !== 'object') {
    issue(issues, 'DOCUMENT_REQUIRED', '/', 'The document must be an object.')
    return { valid: false, issues, errors: issues, warnings: [] }
  }

  const version = String(document.version ?? '')
  if (!version.startsWith('0.2') && !version.startsWith('0.3') && !version.startsWith('0.4') && !version.startsWith('0.5') && !version.startsWith('0.6') && !version.startsWith('0.7')) {
    issue(
      issues,
      'VERSION_UNSUPPORTED',
      '/version',
      `Unsupported document version "${version}".`,
      'Use version "0.7", or migrate a version "0.2" through "0.6" document.',
    )
  } else if (!version.startsWith('0.7')) {
    issue(issues, 'VERSION_LEGACY', '/version', `Version ${version} is supported through automatic migration.`, 'Save the document again to upgrade it to 0.7.', 'warning')
  }

  validateEnvironment(document, issues)

  if (document.building && !Array.isArray(document.building.floors)) {
    issue(issues, 'FLOORS_REQUIRED', '/building/floors', 'building.floors must be an array when a building is provided.')
  }

  for (const [assetId, asset] of Object.entries(document.assets ?? {})) {
    const path = `/assets/${assetId}`
    if (!assetId.trim()) issue(issues, 'ASSET_ID_REQUIRED', path, 'Asset ids must be non-empty strings.')
    if (!asset || typeof asset !== 'object') {
      issue(issues, 'ASSET_INVALID', path, 'Asset definitions must be objects.')
      continue
    }
    if (typeof asset.src !== 'string' && !(asset.src && typeof asset.src === 'object' && '$bind' in asset.src)) {
      issue(issues, 'ASSET_SOURCE_REQUIRED', `${path}/src`, 'Asset src must be a string or binding.')
    }
    if ((version.startsWith('0.4') || version.startsWith('0.5') || version.startsWith('0.6') || version.startsWith('0.7')) && (typeof asset.type !== 'string' || !asset.type.trim())) {
      issue(issues, 'ASSET_TYPE_REQUIRED', `${path}/type`, 'Anyo 0.4, 0.5, and 0.6 assets must provide a non-empty type.')
    } else if (asset.type !== undefined && (typeof asset.type !== 'string' || !asset.type.trim())) {
      issue(issues, 'ASSET_TYPE_INVALID', `${path}/type`, 'Asset type must be a non-empty string when provided.')
    }
    if (asset.format !== undefined && (typeof asset.format !== 'string' || !asset.format.trim())) {
      issue(issues, 'ASSET_FORMAT_INVALID', `${path}/format`, 'Asset format must be a non-empty string when provided.')
    }
  }

  for (const [materialId, material] of Object.entries(document.materials ?? {})) {
    const path = `/materials/${materialId}`
    if (!materialId.trim()) issue(issues, 'MATERIAL_ID_REQUIRED', path, 'Material ids must be non-empty strings.')
    if (!material || typeof material !== 'object') {
      issue(issues, 'MATERIAL_INVALID', path, 'Material definitions must be objects.')
      continue
    }
    for (const field of ['roughness', 'metalness', 'opacity', 'alphaCutoff', 'occlusionStrength', 'transmission', 'lightMapIntensity', 'specularFactor', 'clearcoat', 'clearcoatRoughness', 'sheenIntensity', 'sheenRoughness'] as const) {
      const value = material[field]
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
        issue(issues, 'MATERIAL_VALUE_INVALID', `${path}/${field}`, `${field} must be a finite number from 0 to 1.`)
      }
    }
    if (material.normalScale !== undefined && (!Number.isFinite(material.normalScale) || material.normalScale < 0 || material.normalScale > 10)) issue(issues, 'MATERIAL_NORMAL_SCALE_INVALID', `${path}/normalScale`, 'normalScale must be between 0 and 10.')
    if (material.emissiveIntensity !== undefined && (!Number.isFinite(material.emissiveIntensity) || material.emissiveIntensity < 0 || material.emissiveIntensity > 100)) issue(issues, 'MATERIAL_EMISSIVE_INTENSITY_INVALID', `${path}/emissiveIntensity`, 'emissiveIntensity must be between 0 and 100.')
    if (material.ior !== undefined && (!Number.isFinite(material.ior) || material.ior < 1 || material.ior > 2.5)) issue(issues, 'MATERIAL_IOR_INVALID', `${path}/ior`, 'ior must be between 1 and 2.5.')
    if (material.thickness !== undefined && (!Number.isFinite(material.thickness) || material.thickness < 0)) issue(issues, 'MATERIAL_THICKNESS_INVALID', `${path}/thickness`, 'thickness must be finite and non-negative.')
    if (material.attenuationDistance !== undefined && (!Number.isFinite(material.attenuationDistance) || material.attenuationDistance <= 0)) issue(issues, 'MATERIAL_ATTENUATION_DISTANCE_INVALID', `${path}/attenuationDistance`, 'attenuationDistance must be a positive finite number.')
    for (const field of ['castShadow', 'receiveShadow', 'doubleSided', 'transparent', 'alphaDither'] as const) if (material[field] !== undefined && typeof material[field] !== 'boolean') issue(issues, 'MATERIAL_BOOLEAN_INVALID', `${path}/${field}`, `${field} must be boolean.`)
    if (material.alphaMode !== undefined && !['opaque', 'mask', 'blend'].includes(material.alphaMode)) {
      issue(issues, 'MATERIAL_ALPHA_MODE_INVALID', `${path}/alphaMode`, 'alphaMode must be opaque, mask, or blend.')
    }
    if (material.shadingModel !== undefined && !['pbr', 'toon', 'mtoon', 'water'].includes(material.shadingModel)) issue(issues, 'MATERIAL_SHADING_MODEL_INVALID', `${path}/shadingModel`, 'shadingModel must be pbr, toon, mtoon, or water.')
    if (material.role !== undefined && !['environment', 'character', 'foliage', 'effects', 'ui'].includes(material.role)) issue(issues, 'MATERIAL_ROLE_INVALID', `${path}/role`, 'role must be environment, character, foliage, effects, or ui.')
    if (material.mtoon !== undefined) {
      if (!material.mtoon || typeof material.mtoon !== 'object' || Array.isArray(material.mtoon)) issue(issues, 'MATERIAL_MTOON_INVALID', `${path}/mtoon`, 'mtoon must be an object.')
      else {
        for (const field of ['shadingToony', 'giEqualization', 'rimLightingMix', 'outlineLightingMix', 'faceShadowStrength', 'environmentMix', 'faceShadowSoftness'] as const) {
          const value = material.mtoon[field]
          if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) issue(issues, 'MATERIAL_MTOON_VALUE_INVALID', `${path}/mtoon/${field}`, `${field} must be between 0 and 1.`)
        }
        if (material.mtoon.shadingShift !== undefined && (!Number.isFinite(material.mtoon.shadingShift) || material.mtoon.shadingShift < -1 || material.mtoon.shadingShift > 1)) issue(issues, 'MATERIAL_MTOON_SHIFT_INVALID', `${path}/mtoon/shadingShift`, 'shadingShift must be between -1 and 1.')
      }
    }
    if (material.toon !== undefined) {
      if (!material.toon || typeof material.toon !== 'object' || Array.isArray(material.toon)) issue(issues, 'MATERIAL_TOON_INVALID', `${path}/toon`, 'toon must be an object.')
      else {
        if (material.toon.shadeSteps !== undefined && (!Number.isFinite(material.toon.shadeSteps) || material.toon.shadeSteps < 2 || material.toon.shadeSteps > 8)) issue(issues, 'MATERIAL_TOON_STEPS_INVALID', `${path}/toon/shadeSteps`, 'shadeSteps must be between 2 and 8.')
        for (const field of ['shadowStrength', 'highlightStrength', 'rimStrength', 'outlineStrength', 'bandSmoothness', 'environmentMix'] as const) { const value = material.toon[field]; if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) issue(issues, 'MATERIAL_TOON_STRENGTH_INVALID', `${path}/toon/${field}`, `${field} must be between 0 and 1.`) }
        if (material.toon.shadowOffset !== undefined && (!Number.isFinite(material.toon.shadowOffset) || material.toon.shadowOffset < -1 || material.toon.shadowOffset > 1)) issue(issues, 'MATERIAL_TOON_OFFSET_INVALID', `${path}/toon/shadowOffset`, 'shadowOffset must be between -1 and 1.')
        for (const field of ['rimPower', 'outlinePower'] as const) { const value = material.toon[field]; if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 16)) issue(issues, 'MATERIAL_TOON_POWER_INVALID', `${path}/toon/${field}`, `${field} must be greater than 0 and at most 16.`) }
      }
    }
    if (material.water !== undefined) {
      if (!material.water || typeof material.water !== 'object' || Array.isArray(material.water)) issue(issues, 'MATERIAL_WATER_INVALID', `${path}/water`, 'water must be an object.')
      else {
        for (const field of ['reflectionStrength', 'absorptionStrength'] as const) {
          const value = material.water[field]
          if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) issue(issues, 'MATERIAL_WATER_VALUE_INVALID', `${path}/water/${field}`, `${field} must be between 0 and 1.`)
        }
        if (material.water.fresnelPower !== undefined && (!Number.isFinite(material.water.fresnelPower) || material.water.fresnelPower <= 0 || material.water.fresnelPower > 16)) issue(issues, 'MATERIAL_WATER_FRESNEL_INVALID', `${path}/water/fresnelPower`, 'fresnelPower must be greater than 0 and at most 16.')
      }
    }
    if ((material.transparent || (material.opacity ?? 1) < 1 || (material.transmission ?? 0) > 0) && material.castShadow === true) {
      issue(issues, 'MATERIAL_TRANSPARENT_SHADOW_WARNING', `${path}/castShadow`, 'Transparent or transmissive materials usually should not cast opaque shadows.', 'Set castShadow to false unless the renderer provides transparent shadowing.', 'warning')
    }
  }

  const visualStyle = document.environment?.visualStyle
  if (visualStyle !== undefined) {
    const path = '/environment/visualStyle'
    if (!visualStyle || typeof visualStyle !== 'object' || Array.isArray(visualStyle)) issue(issues, 'VISUAL_STYLE_INVALID', path, 'visualStyle must be an object.')
    else {
      if (visualStyle.profile !== undefined && !['standard', 'anime', 'anime-soft', 'anime-cinematic', 'anime-rpg'].includes(visualStyle.profile)) issue(issues, 'VISUAL_STYLE_PROFILE_INVALID', `${path}/profile`, 'Unknown visual style profile.')
      if (visualStyle.defaultMaterialRole !== undefined && !['environment', 'character', 'foliage', 'effects', 'ui'].includes(visualStyle.defaultMaterialRole)) issue(issues, 'VISUAL_STYLE_ROLE_INVALID', `${path}/defaultMaterialRole`, 'Unknown default material role.')
      if (visualStyle.shadeSteps !== undefined && (!Number.isFinite(visualStyle.shadeSteps) || visualStyle.shadeSteps < 2 || visualStyle.shadeSteps > 8)) issue(issues, 'VISUAL_STYLE_STEPS_INVALID', `${path}/shadeSteps`, 'shadeSteps must be between 2 and 8.')
    }
  }

  const atmosphere = document.environment?.atmosphere
  if (atmosphere !== undefined) {
    const path = '/environment/atmosphere'
    if (!atmosphere || typeof atmosphere !== 'object' || Array.isArray(atmosphere)) issue(issues, 'ATMOSPHERE_INVALID', path, 'atmosphere must be an object.')
    else {
      if (atmosphere.enabled !== undefined && typeof atmosphere.enabled !== 'boolean') issue(issues, 'ATMOSPHERE_ENABLED_INVALID', `${path}/enabled`, 'enabled must be boolean.')
      if (atmosphere.mode !== undefined && !['none', 'linear', 'exp2'].includes(atmosphere.mode)) issue(issues, 'ATMOSPHERE_MODE_INVALID', `${path}/mode`, 'mode must be none, linear, or exp2.')
      for (const field of ['near', 'far', 'density', 'heightFalloff'] as const) {
        const value = atmosphere[field]
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) issue(issues, 'ATMOSPHERE_VALUE_INVALID', `${path}/${field}`, `${field} must be finite and non-negative.`)
      }
      if (atmosphere.baseHeight !== undefined && !Number.isFinite(atmosphere.baseHeight)) issue(issues, 'ATMOSPHERE_BASE_HEIGHT_INVALID', `${path}/baseHeight`, 'baseHeight must be finite.')
      if (atmosphere.maxOpacity !== undefined && (!Number.isFinite(atmosphere.maxOpacity) || atmosphere.maxOpacity < 0 || atmosphere.maxOpacity > 1)) issue(issues, 'ATMOSPHERE_OPACITY_INVALID', `${path}/maxOpacity`, 'maxOpacity must be between 0 and 1.')
      if (atmosphere.near !== undefined && atmosphere.far !== undefined && atmosphere.far <= atmosphere.near) issue(issues, 'ATMOSPHERE_RANGE_INVALID', `${path}/far`, 'far must be greater than near for linear atmosphere.')
    }
  }

  const grading = document.environment?.postProcessing?.colorGrading
  if (grading !== undefined) {
    const path = '/environment/postProcessing/colorGrading'
    if (!grading || typeof grading !== 'object' || Array.isArray(grading)) issue(issues, 'COLOR_GRADING_INVALID', path, 'colorGrading must be an object.')
    else {
      if (grading.enabled !== undefined && typeof grading.enabled !== 'boolean') issue(issues, 'COLOR_GRADING_ENABLED_INVALID', `${path}/enabled`, 'enabled must be boolean.')
      const ranges = {
        saturation: [0, 2], contrast: [0, 2], brightness: [-1, 1], temperature: [-1, 1], tint: [-1, 1],
        vignette: [0, 1], vignetteSoftness: [0.05, 1], highlightGlow: [0, 2], highlightThreshold: [0, 1], lutIntensity: [0, 1],
      } as const
      for (const [field, range] of Object.entries(ranges)) {
        const value = grading[field as keyof typeof ranges]
        if (value !== undefined && (!Number.isFinite(value) || value < range[0] || value > range[1])) issue(issues, 'COLOR_GRADING_VALUE_INVALID', `${path}/${field}`, `${field} must be between ${range[0]} and ${range[1]}.`)
      }
      if (grading.lut !== undefined && (typeof grading.lut !== 'string' || !grading.lut.trim())) issue(issues, 'COLOR_GRADING_LUT_INVALID', `${path}/lut`, 'lut must reference a non-empty asset id.')
    }
  }

  const postProcessing = document.environment?.postProcessing
  if (postProcessing !== undefined) {
    const path = '/environment/postProcessing'
    if (postProcessing.enabled !== undefined && typeof postProcessing.enabled !== 'boolean') issue(issues, 'POST_PROCESSING_ENABLED_INVALID', `${path}/enabled`, 'enabled must be boolean.')
    for (const [name, value] of Object.entries({ ssao: postProcessing.ssao, bloom: postProcessing.bloom, outlines: postProcessing.outlines })) {
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) issue(issues, 'POST_PROCESSING_STAGE_INVALID', `${path}/${name}`, `${name} must be an object.`)
    }
    if (postProcessing.ssao?.mode !== undefined && !['contact', 'gtao'].includes(postProcessing.ssao.mode)) issue(issues, 'SSAO_MODE_INVALID', `${path}/ssao/mode`, 'SSAO mode must be contact or gtao.')
    if (postProcessing.ssao?.directions !== undefined && (!Number.isInteger(postProcessing.ssao.directions) || postProcessing.ssao.directions < 2 || postProcessing.ssao.directions > 16)) issue(issues, 'SSAO_DIRECTIONS_INVALID', `${path}/ssao/directions`, 'GTAO directions must be an integer between 2 and 16.')
    if (postProcessing.bloom?.levels !== undefined && (!Number.isInteger(postProcessing.bloom.levels) || postProcessing.bloom.levels < 1 || postProcessing.bloom.levels > 8)) issue(issues, 'BLOOM_LEVELS_INVALID', `${path}/bloom/levels`, 'Bloom levels must be an integer between 1 and 8.')
    if (postProcessing.outlines?.mode !== undefined && !['screen-space', 'inverted-hull', 'hybrid'].includes(postProcessing.outlines.mode)) issue(issues, 'OUTLINE_MODE_INVALID', `${path}/outlines/mode`, 'Outline mode must be screen-space, inverted-hull, or hybrid.')
  }

  const optimization = document.environment?.optimization
  if (optimization !== undefined && (!optimization || typeof optimization !== 'object' || Array.isArray(optimization))) issue(issues, 'RENDER_OPTIMIZATION_INVALID', '/environment/optimization', 'optimization must be an object.')
  else if (optimization) {
    if (optimization.clusterDimensions !== undefined && (!Array.isArray(optimization.clusterDimensions) || optimization.clusterDimensions.length !== 3 || optimization.clusterDimensions.some((value) => !Number.isInteger(value) || value < 1 || value > 128))) issue(issues, 'CLUSTER_DIMENSIONS_INVALID', '/environment/optimization/clusterDimensions', 'clusterDimensions must contain three integers between 1 and 128.')
    if (optimization.occlusionHistoryFrames !== undefined && (!Number.isInteger(optimization.occlusionHistoryFrames) || optimization.occlusionHistoryFrames < 1 || optimization.occlusionHistoryFrames > 8)) issue(issues, 'OCCLUSION_HISTORY_INVALID', '/environment/optimization/occlusionHistoryFrames', 'occlusionHistoryFrames must be an integer between 1 and 8.')
    if (optimization.occlusionMinimumPixels !== undefined && (!Number.isInteger(optimization.occlusionMinimumPixels) || optimization.occlusionMinimumPixels < 1 || optimization.occlusionMinimumPixels > 32)) issue(issues, 'OCCLUSION_MINIMUM_PIXELS_INVALID', '/environment/optimization/occlusionMinimumPixels', 'occlusionMinimumPixels must be an integer between 1 and 32.')
    if (optimization.maxClusteredLights !== undefined && (!Number.isInteger(optimization.maxClusteredLights) || optimization.maxClusteredLights < 1 || optimization.maxClusteredLights > 4096)) issue(issues, 'MAX_CLUSTERED_LIGHTS_INVALID', '/environment/optimization/maxClusteredLights', 'maxClusteredLights must be an integer between 1 and 4096.')
    if (optimization.textureMemoryBudgetMB !== undefined && (!Number.isFinite(optimization.textureMemoryBudgetMB) || optimization.textureMemoryBudgetMB < 0)) issue(issues, 'TEXTURE_BUDGET_INVALID', '/environment/optimization/textureMemoryBudgetMB', 'textureMemoryBudgetMB must be finite and non-negative.')
    if (optimization.geometryMemoryBudgetMB !== undefined && (!Number.isFinite(optimization.geometryMemoryBudgetMB) || optimization.geometryMemoryBudgetMB < 0)) issue(issues, 'GEOMETRY_BUDGET_INVALID', '/environment/optimization/geometryMemoryBudgetMB', 'geometryMemoryBudgetMB must be finite and non-negative.')
    if (optimization.streamingLoadDistance !== undefined && (!Number.isFinite(optimization.streamingLoadDistance) || optimization.streamingLoadDistance < 0)) issue(issues, 'STREAMING_LOAD_DISTANCE_INVALID', '/environment/optimization/streamingLoadDistance', 'streamingLoadDistance must be finite and non-negative.')
    if (optimization.streamingUnloadDistance !== undefined && (!Number.isFinite(optimization.streamingUnloadDistance) || optimization.streamingUnloadDistance < 0 || (optimization.streamingLoadDistance !== undefined && optimization.streamingUnloadDistance < optimization.streamingLoadDistance))) issue(issues, 'STREAMING_UNLOAD_DISTANCE_INVALID', '/environment/optimization/streamingUnloadDistance', 'streamingUnloadDistance must be finite, non-negative, and at least streamingLoadDistance.')
    if (optimization.streamingConcurrency !== undefined && (!Number.isInteger(optimization.streamingConcurrency) || optimization.streamingConcurrency < 1 || optimization.streamingConcurrency > 32)) issue(issues, 'STREAMING_CONCURRENCY_INVALID', '/environment/optimization/streamingConcurrency', 'streamingConcurrency must be an integer between 1 and 32.')
    if (optimization.worldOriginThreshold !== undefined && (!Number.isFinite(optimization.worldOriginThreshold) || optimization.worldOriginThreshold <= 0)) issue(issues, 'WORLD_ORIGIN_THRESHOLD_INVALID', '/environment/optimization/worldOriginThreshold', 'worldOriginThreshold must be a positive finite number.')
    if (optimization.worldOriginGridSize !== undefined && (!Number.isFinite(optimization.worldOriginGridSize) || optimization.worldOriginGridSize <= 0)) issue(issues, 'WORLD_ORIGIN_GRID_INVALID', '/environment/optimization/worldOriginGridSize', 'worldOriginGridSize must be a positive finite number.')
  }

  const xr = document.exploration?.xr
  if (xr !== undefined) {
    const path = '/exploration/xr'
    if (!xr || typeof xr !== 'object' || Array.isArray(xr)) {
      issue(issues, 'XR_CONFIGURATION_INVALID', path, 'exploration.xr must be an object.')
    } else {
      if (xr.enabled !== undefined && typeof xr.enabled !== 'boolean') issue(issues, 'XR_ENABLED_INVALID', `${path}/enabled`, 'XR enabled must be boolean.')
      if (xr.mode !== undefined && !['immersive-vr', 'immersive-ar', 'inline'].includes(xr.mode)) issue(issues, 'XR_MODE_INVALID', `${path}/mode`, 'XR mode must be immersive-vr, immersive-ar, or inline.')
      if (xr.referenceSpace !== undefined && !['local-floor', 'bounded-floor', 'local', 'viewer', 'unbounded'].includes(xr.referenceSpace)) issue(issues, 'XR_REFERENCE_SPACE_INVALID', `${path}/referenceSpace`, 'XR referenceSpace is not supported.')
      if (xr.locomotion !== undefined && !['teleport', 'smooth', 'room-scale', 'disabled'].includes(xr.locomotion)) issue(issues, 'XR_LOCOMOTION_INVALID', `${path}/locomotion`, 'XR locomotion must be teleport, smooth, room-scale, or disabled.')
      if (xr.turning !== undefined && !['snap', 'smooth', 'physical', 'disabled'].includes(xr.turning)) issue(issues, 'XR_TURNING_INVALID', `${path}/turning`, 'XR turning must be snap, smooth, physical, or disabled.')
      if (xr.snapAngle !== undefined && (!Number.isFinite(xr.snapAngle) || xr.snapAngle <= 0 || xr.snapAngle > 180)) issue(issues, 'XR_SNAP_ANGLE_INVALID', `${path}/snapAngle`, 'XR snapAngle must be greater than 0 and at most 180 degrees.')
      if (xr.movementSpeed !== undefined && (!Number.isFinite(xr.movementSpeed) || xr.movementSpeed < 0)) issue(issues, 'XR_MOVEMENT_SPEED_INVALID', `${path}/movementSpeed`, 'XR movementSpeed must be finite and non-negative.')
      if (xr.turnSpeed !== undefined && (!Number.isFinite(xr.turnSpeed) || xr.turnSpeed < 0)) issue(issues, 'XR_TURN_SPEED_INVALID', `${path}/turnSpeed`, 'XR turnSpeed must be finite and non-negative.')
      if (xr.interactionDistance !== undefined && (!Number.isFinite(xr.interactionDistance) || xr.interactionDistance <= 0)) issue(issues, 'XR_INTERACTION_DISTANCE_INVALID', `${path}/interactionDistance`, 'XR interactionDistance must be a positive finite number.')
      if (xr.dominantHand !== undefined && !['left', 'right', 'auto'].includes(xr.dominantHand)) issue(issues, 'XR_DOMINANT_HAND_INVALID', `${path}/dominantHand`, 'XR dominantHand must be left, right, or auto.')
      if (xr.playerHeight !== undefined && typeof xr.playerHeight !== 'number' && !['device', 'standing', 'seated'].includes(xr.playerHeight)) issue(issues, 'XR_PLAYER_HEIGHT_INVALID', `${path}/playerHeight`, 'XR playerHeight must be device, standing, seated, or a positive number.')
      if (typeof xr.playerHeight === 'number' && (!Number.isFinite(xr.playerHeight) || xr.playerHeight <= 0)) issue(issues, 'XR_PLAYER_HEIGHT_INVALID', `${path}/playerHeight`, 'Numeric XR playerHeight must be positive and finite.')
      if (xr.collision !== undefined && typeof xr.collision !== 'boolean') issue(issues, 'XR_COLLISION_INVALID', `${path}/collision`, 'XR collision must be boolean.')
      if (xr.vignette !== undefined && typeof xr.vignette !== 'boolean') issue(issues, 'XR_VIGNETTE_INVALID', `${path}/vignette`, 'XR vignette must be boolean.')
    }
  }

  const floorIds = new Set<string>()
  const roomIds = new Set<string>()
  const entityIds = new Set<string>()
  const roomById = new Map<string, { width: number; depth: number; height: number }>()

  for (const [floorIndex, floor] of (document.building?.floors ?? []).entries()) {
    const floorPath = `/building/floors/${floorIndex}`
    if (!floor.id?.trim()) issue(issues, 'FLOOR_ID_REQUIRED', `${floorPath}/id`, 'Floor id must be a non-empty string.')
    else if (floorIds.has(floor.id)) issue(issues, 'FLOOR_ID_DUPLICATE', `${floorPath}/id`, `Floor id "${floor.id}" is duplicated.`)
    else floorIds.add(floor.id)

    if (!Number.isFinite(floor.elevation)) issue(issues, 'FLOOR_ELEVATION_INVALID', `${floorPath}/elevation`, 'Floor elevation must be finite.')
    if (!Array.isArray(floor.rooms) || floor.rooms.length === 0) {
      issue(issues, 'ROOMS_EMPTY', `${floorPath}/rooms`, 'Each floor must contain at least one room.')
      continue
    }

    for (const [roomIndex, room] of floor.rooms.entries()) {
      const roomPath = `${floorPath}/rooms/${roomIndex}`
      if (!room.id?.trim()) issue(issues, 'ROOM_ID_REQUIRED', `${roomPath}/id`, 'Room id must be a non-empty string.')
      else if (roomIds.has(room.id)) issue(issues, 'ROOM_ID_DUPLICATE', `${roomPath}/id`, `Room id "${room.id}" is duplicated.`)
      else roomIds.add(room.id)

      if (!Array.isArray(room.size) || room.size.length !== 2 || !room.size.every(isPositive)) {
        issue(issues, 'ROOM_SIZE_INVALID', `${roomPath}/size`, 'Room size must be [positiveWidth, positiveDepth].')
      } else {
        roomById.set(room.id, { width: room.size[0], depth: room.size[1], height: room.height ?? document.building?.defaults?.roomHeight ?? 3.2 })
      }
      if (room.position !== undefined && !isFiniteVector(room.position, 2)) {
        issue(issues, 'ROOM_POSITION_INVALID', `${roomPath}/position`, 'Room position must contain two finite numbers.')
      }
      if (room.height !== undefined && !isPositive(room.height)) issue(issues, 'ROOM_HEIGHT_INVALID', `${roomPath}/height`, 'Room height must be positive.')
      if (room.wallThickness !== undefined && !isPositive(room.wallThickness)) issue(issues, 'WALL_THICKNESS_INVALID', `${roomPath}/wallThickness`, 'Wall thickness must be positive.')

      for (const [openingIndex, opening] of (room.openings ?? []).entries()) {
        const openingPath = `${roomPath}/openings/${openingIndex}`
        if (!isPositive(opening.width)) issue(issues, 'OPENING_WIDTH_INVALID', `${openingPath}/width`, 'Opening width must be positive.')
        if (!isPositive(opening.height)) issue(issues, 'OPENING_HEIGHT_INVALID', `${openingPath}/height`, 'Opening height must be positive.')
        if (opening.elevation !== undefined && (!Number.isFinite(opening.elevation) || opening.elevation < 0)) {
          issue(issues, 'OPENING_ELEVATION_INVALID', `${openingPath}/elevation`, 'Opening elevation must be finite and non-negative.')
        }
        if (typeof opening.offset === 'number' && !Number.isFinite(opening.offset)) {
          issue(issues, 'OPENING_OFFSET_INVALID', `${openingPath}/offset`, 'Opening offset must be finite or "center".')
        }
        const roomInfo = roomById.get(room.id)
        if (roomInfo) {
          const wallLength = opening.wall === 'north' || opening.wall === 'south' ? roomInfo.width : roomInfo.depth
          if (opening.width >= wallLength) {
            issue(issues, 'OPENING_TOO_WIDE', `${openingPath}/width`, `Opening width must be smaller than the ${wallLength}m wall.`)
          }
          const elevation = opening.elevation ?? (opening.type === 'window' ? 0.9 : 0)
          if (elevation + opening.height > roomInfo.height + 1e-6) {
            issue(issues, 'OPENING_TOO_TALL', openingPath, 'Opening elevation plus height exceeds the room height.')
          }
        }
      }

      for (const [entityIndex, entity] of (room.entities ?? []).entries()) {
        validateEntity(entity, `${roomPath}/entities/${entityIndex}`, issues, document.prefabs, entityIds)
      }
    }
  }

  for (const [entityIndex, entity] of (document.entities ?? []).entries()) {
    validateEntity(entity, `/entities/${entityIndex}`, issues, document.prefabs, entityIds)
  }

  const prefabIds = new Set<string>()
  for (const [name, prefab] of Object.entries(document.prefabs ?? {})) {
    validateEntity({ ...prefab, id: prefab.id ?? `@prefab:${name}` }, `/prefabs/${name}`, issues, document.prefabs, prefabIds, '', Boolean(prefab.extends))
  }

  for (const [floorIndex, floor] of (document.building?.floors ?? []).entries()) {
    for (const [roomIndex, room] of floor.rooms.entries()) {
      const roomPath = `/building/floors/${floorIndex}/rooms/${roomIndex}`
      if (room.attachTo && !roomIds.has(room.attachTo.room)) {
        issue(issues, 'ATTACHED_ROOM_NOT_FOUND', `${roomPath}/attachTo/room`, `Attached room "${room.attachTo.room}" does not exist.`)
      }
      for (const [openingIndex, opening] of (room.openings ?? []).entries()) {
        if (opening.targetRoom && !roomIds.has(opening.targetRoom)) {
          issue(issues, 'OPENING_TARGET_NOT_FOUND', `${roomPath}/openings/${openingIndex}/targetRoom`, `Target room "${opening.targetRoom}" does not exist.`)
        }
      }
    }
    for (const [stairIndex, stair] of (floor.stairs ?? []).entries()) {
      const stairPath = `/building/floors/${floorIndex}/stairs/${stairIndex}`
      if (!floorIds.has(stair.fromFloor)) issue(issues, 'STAIR_FLOOR_NOT_FOUND', `${stairPath}/fromFloor`, `Floor "${stair.fromFloor}" does not exist.`)
      if (!floorIds.has(stair.toFloor)) issue(issues, 'STAIR_FLOOR_NOT_FOUND', `${stairPath}/toFloor`, `Floor "${stair.toFloor}" does not exist.`)
      if (!isFiniteVector(stair.position, 2)) issue(issues, 'STAIR_POSITION_INVALID', `${stairPath}/position`, 'Stair position must contain two finite numbers.')
      if (stair.steps !== undefined && (!Number.isInteger(stair.steps) || stair.steps < 1)) issue(issues, 'STAIR_STEPS_INVALID', `${stairPath}/steps`, 'Stair steps must be a positive integer.')
    }
  }

  issues.push(...inspectArchitectureDocument(document, options))
  issues.push(...inspectWorldSemantics(document, options))

  const errors = issues.filter((item) => item.severity === 'error')
  const warnings = issues.filter((item) => item.severity === 'warning')
  return { valid: errors.length === 0, issues, errors, warnings }
}

export function validateWorldDocument(document: WorldDocument, options: WorldValidationOptions = {}): void {
  const result = inspectWorldDocument(document, options)
  if (!result.valid) throw new AnyoValidationError(result.errors)
}

function isFinitePair(value: readonly number[]): boolean {
  return value.length === 2 && value.every(Number.isFinite)
}

function isPositiveFinitePair(value: readonly number[]): boolean {
  return isFinitePair(value) && value.every(component => component > 0)
}
