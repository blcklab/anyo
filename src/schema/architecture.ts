import { inspectAssetManifest } from '../assets/manifest.js'
import { compileWorldChannels } from '../core/architecture.js'
import type { ActionDefinition, EntityDefinition, WorldDocument, WorldValidationOptions } from '../core/types.js'
import type { ValidationIssue } from './errors.js'

function push(issues: ValidationIssue[], value: ValidationIssue, maximum: number): void {
  if (issues.length < maximum) issues.push(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateAction(
  action: ActionDefinition,
  path: string,
  issues: ValidationIssue[],
  depth: number,
  maximumDepth: number,
  maximumDiagnostics: number,
  counter: { value: number; maximum: number },
  references?: { entityIds: ReadonlySet<string>; cameraIds: ReadonlySet<string> },
): void {
  counter.value += 1
  if (counter.value > counter.maximum) {
    push(issues, { severity: 'error', code: 'ACTION_LIMIT_EXCEEDED', path, message: `World action count exceeds ${counter.maximum}.` }, maximumDiagnostics)
    return
  }
  if (depth > maximumDepth) {
    push(issues, { severity: 'error', code: 'ACTION_DEPTH_EXCEEDED', path, message: `Action nesting exceeds ${maximumDepth}.` }, maximumDiagnostics)
    return
  }
  if (!isRecord(action)) {
    push(issues, { severity: 'error', code: 'ACTION_INVALID', path, message: 'Actions must be JSON objects.' }, maximumDiagnostics)
    return
  }
  if (!action.type && !('action' in action && typeof action.action === 'string') && !('event' in action && typeof action.event === 'string')) push(issues, { severity: 'error', code: 'ACTION_DISCRIMINATOR_REQUIRED', path, message: 'Action requires type, action, or event.' }, maximumDiagnostics)
  switch (action.type) {
    case 'invoke': if (typeof action.action !== 'string' || !action.action.trim()) push(issues, { severity: 'error', code: 'ACTION_INVOKE_NAME_REQUIRED', path: `${path}/action`, message: 'invoke requires action.' }, maximumDiagnostics); break
    case 'emit': if (typeof action.event !== 'string' || !action.event.trim()) push(issues, { severity: 'error', code: 'ACTION_EMIT_EVENT_REQUIRED', path: `${path}/event`, message: 'emit requires event.' }, maximumDiagnostics); break
    case 'setVariable':
    case 'toggleVariable':
    case 'incrementVariable': if (typeof action.path !== 'string' || !action.path.trim()) push(issues, { severity: 'error', code: 'ACTION_VARIABLE_PATH_REQUIRED', path: `${path}/path`, message: `${action.type} requires path.` }, maximumDiagnostics); break
    case 'setVisibility':
    case 'setTransform':
    case 'enableEntity':
    case 'disableEntity': {
      if (typeof action.target !== 'string' || !action.target.trim()) push(issues, { severity: 'error', code: 'ACTION_TARGET_REQUIRED', path: `${path}/target`, message: `${action.type} requires target.` }, maximumDiagnostics)
      else if (references && !action.target.startsWith('$') && !references.entityIds.has(action.target)) push(issues, { severity: 'error', code: 'ACTION_TARGET_UNKNOWN', path: `${path}/target`, message: `Unknown action target "${action.target}".` }, maximumDiagnostics)
      break
    }
    case 'activateCamera': {
      if (typeof action.camera !== 'string' || !action.camera.trim()) push(issues, { severity: 'error', code: 'ACTION_CAMERA_REQUIRED', path: `${path}/camera`, message: 'activateCamera requires camera.' }, maximumDiagnostics)
      else if (references && !references.cameraIds.has(action.camera)) push(issues, { severity: 'error', code: 'ACTION_CAMERA_UNKNOWN', path: `${path}/camera`, message: `Unknown camera "${action.camera}".` }, maximumDiagnostics)
      break
    }
    case 'sequence':
      if (!Array.isArray(action.actions) || action.actions.length === 0) push(issues, { severity: 'error', code: 'ACTION_SEQUENCE_REQUIRED', path: `${path}/actions`, message: 'sequence requires at least one action.' }, maximumDiagnostics)
      else action.actions.forEach((child, index) => validateAction(child, `${path}/actions/${index}`, issues, depth + 1, maximumDepth, maximumDiagnostics, counter, references))
      break
  }
}

function walkEntities(
  entities: readonly EntityDefinition[],
  path: string,
  visitor: (entity: EntityDefinition, path: string, depth: number) => void,
  depth = 0,
): void {
  entities.forEach((entity, index) => {
    const childPath = `${path}/${index}`
    visitor(entity, childPath, depth)
    walkEntities(entity.children ?? [], `${childPath}/children`, visitor, depth + 1)
  })
}

export function inspectArchitectureDocument(
  document: WorldDocument,
  options: WorldValidationOptions = {},
): ValidationIssue[] {
  const limits = {
    maxEntities: options.limits?.maxEntities ?? 100_000,
    maxHierarchyDepth: options.limits?.maxHierarchyDepth ?? 128,
    maxPrefabDepth: options.limits?.maxPrefabDepth ?? 32,
    maxActionDepth: options.limits?.maxActionDepth ?? 32,
    maxMetadataBytes: options.limits?.maxMetadataBytes ?? 1_000_000,
    maxDiagnostics: options.limits?.maxDiagnostics ?? 1_000,
    maxAssets: options.limits?.maxAssets ?? 25_000,
    maxActions: options.limits?.maxActions ?? 100_000,
    maxExtensionsBytes: options.limits?.maxExtensionsBytes ?? 4_000_000,
  }
  const issues: ValidationIssue[] = []
  const actionCounter = { value: 0, maximum: limits.maxActions }
  if (document.revision !== undefined && (!Number.isSafeInteger(document.revision) || document.revision < 0)) push(issues, { severity: 'error', code: 'REVISION_INVALID', path: '/revision', message: 'revision must be a non-negative safe integer.' }, limits.maxDiagnostics)
  if (document.extensions && JSON.stringify(document.extensions).length > limits.maxExtensionsBytes) push(issues, { severity: 'error', code: 'EXTENSIONS_LIMIT_EXCEEDED', path: '/extensions', message: `extensions exceeds ${limits.maxExtensionsBytes} serialized bytes.` }, limits.maxDiagnostics)
  if (document.metadata && JSON.stringify(document.metadata).length > limits.maxMetadataBytes) push(issues, { severity: 'error', code: 'METADATA_LIMIT_EXCEEDED', path: '/metadata', message: `metadata exceeds ${limits.maxMetadataBytes} serialized bytes.` }, limits.maxDiagnostics)

  let channels: ReturnType<typeof compileWorldChannels> | undefined
  try { channels = compileWorldChannels(document.channels) }
  catch (error) { push(issues, { severity: 'error', code: 'CHANNELS_INVALID', path: '/channels', message: String(error instanceof Error ? error.message : error) }, limits.maxDiagnostics) }

  const cameraIds = new Set(Object.keys(document.cameras ?? {}))
  if (document.activeCamera && !cameraIds.has(document.activeCamera)) push(issues, { severity: 'error', code: 'ACTIVE_CAMERA_UNKNOWN', path: '/activeCamera', message: `Unknown active camera "${document.activeCamera}".` }, limits.maxDiagnostics)
  for (const [id, camera] of Object.entries(document.cameras ?? {})) {
    const path = `/cameras/${id}`
    if (!id.trim()) push(issues, { severity: 'error', code: 'CAMERA_ID_REQUIRED', path, message: 'Camera ids must be non-empty.' }, limits.maxDiagnostics)
    if (!['perspective', 'orthographic'].includes(camera.type)) push(issues, { severity: 'error', code: 'CAMERA_TYPE_INVALID', path: `${path}/type`, message: 'Camera type must be perspective or orthographic.' }, limits.maxDiagnostics)
    if (camera.near !== undefined && (!Number.isFinite(camera.near) || camera.near <= 0)) push(issues, { severity: 'error', code: 'CAMERA_NEAR_INVALID', path: `${path}/near`, message: 'Camera near must be positive.' }, limits.maxDiagnostics)
    if (camera.far !== undefined && (!Number.isFinite(camera.far) || camera.far <= (camera.near ?? 0))) push(issues, { severity: 'error', code: 'CAMERA_FAR_INVALID', path: `${path}/far`, message: 'Camera far must exceed near.' }, limits.maxDiagnostics)
    if (camera.parent && !cameraIds.has(camera.parent)) push(issues, { severity: 'error', code: 'CAMERA_PARENT_UNKNOWN', path: `${path}/parent`, message: `Unknown parent camera "${camera.parent}".` }, limits.maxDiagnostics)
    if (camera.type === 'perspective' && camera.fov !== undefined && (camera.fov <= 0 || camera.fov >= 180)) push(issues, { severity: 'error', code: 'CAMERA_FOV_INVALID', path: `${path}/fov`, message: 'Perspective camera fov must be between 0 and 180.' }, limits.maxDiagnostics)
    if (camera.type === 'orthographic' && camera.size !== undefined && camera.size <= 0) push(issues, { severity: 'error', code: 'CAMERA_SIZE_INVALID', path: `${path}/size`, message: 'Orthographic camera size must be positive.' }, limits.maxDiagnostics)
    if (channels) for (const name of camera.layers ?? []) if (!(name in channels.render.names)) push(issues, { severity: 'error', code: 'CAMERA_CHANNEL_UNKNOWN', path: `${path}/layers`, message: `Unknown camera render channel "${name}".` }, limits.maxDiagnostics)
  }

  let entityCount = 0
  const entityIds = new Set<string>()
  const pendingActions: Array<{ action: ActionDefinition; path: string }> = []
  const instanceIds = new Set<string>()
  walkEntities(document.entities ?? [], '/entities', (entity, path, depth) => {
    entityCount += 1
    if (entity.id) entityIds.add(entity.id)
    if (entity.authoringId) entityIds.add(entity.authoringId)
    if (entity.instanceId) {
      if (instanceIds.has(entity.instanceId)) push(issues, { severity: 'error', code: 'PREFAB_INSTANCE_ID_DUPLICATE', path: `${path}/instanceId`, message: `Duplicate prefab instanceId "${entity.instanceId}".` }, limits.maxDiagnostics)
      instanceIds.add(entity.instanceId)
    }
    if (depth > limits.maxHierarchyDepth) push(issues, { severity: 'error', code: 'HIERARCHY_DEPTH_EXCEEDED', path, message: `Entity hierarchy exceeds ${limits.maxHierarchyDepth}.` }, limits.maxDiagnostics)
    if (channels) {
      for (const [field, map] of [['layers', channels.render], ['pickLayers', channels.picking], ['editorLayers', channels.editor]] as const) {
        for (const name of entity[field] ?? []) if (!(name in map.names)) push(issues, { severity: 'error', code: 'CHANNEL_REFERENCE_UNKNOWN', path: `${path}/${field}`, message: `Unknown ${field} channel "${name}".` }, limits.maxDiagnostics)
      }
    }
    for (const [event, actions] of Object.entries(entity.events ?? {})) actions.forEach((action, index) => pendingActions.push({ action, path: `${path}/events/${event}/${index}` }))
  })
  for (let floorIndex = 0; floorIndex < (document.building?.floors.length ?? 0); floorIndex += 1) {
    const floor = document.building?.floors[floorIndex]
    if (!floor) continue
    for (let roomIndex = 0; roomIndex < floor.rooms.length; roomIndex += 1) {
      const room = floor.rooms[roomIndex]
      if (!room) continue
      walkEntities(room.entities ?? [], `/building/floors/${floorIndex}/rooms/${roomIndex}/entities`, (entity, path, depth) => {
        entityCount += 1
        if (entity.id) entityIds.add(entity.id)
        if (entity.authoringId) entityIds.add(entity.authoringId)
        if (entity.instanceId) {
          if (instanceIds.has(entity.instanceId)) push(issues, { severity: 'error', code: 'PREFAB_INSTANCE_ID_DUPLICATE', path: `${path}/instanceId`, message: `Duplicate prefab instanceId "${entity.instanceId}".` }, limits.maxDiagnostics)
          instanceIds.add(entity.instanceId)
        }
        if (depth > limits.maxHierarchyDepth) push(issues, { severity: 'error', code: 'HIERARCHY_DEPTH_EXCEEDED', path, message: `Entity hierarchy exceeds ${limits.maxHierarchyDepth}.` }, limits.maxDiagnostics)
        if (channels) for (const [field, map] of [['layers', channels.render], ['pickLayers', channels.picking], ['editorLayers', channels.editor]] as const) for (const name of entity[field] ?? []) if (!(name in map.names)) push(issues, { severity: 'error', code: 'CHANNEL_REFERENCE_UNKNOWN', path: `${path}/${field}`, message: `Unknown ${field} channel "${name}".` }, limits.maxDiagnostics)
        for (const [event, actions] of Object.entries(entity.events ?? {})) actions.forEach((action, index) => pendingActions.push({ action, path: `${path}/events/${event}/${index}` }))
      })
    }
  }
  if (entityCount > limits.maxEntities) push(issues, { severity: 'error', code: 'ENTITY_LIMIT_EXCEEDED', path: '/entities', message: `World contains ${entityCount} entities; limit is ${limits.maxEntities}.` }, limits.maxDiagnostics)
  for (const [event, actions] of Object.entries(document.events ?? {})) actions.forEach((action, index) => pendingActions.push({ action, path: `/events/${event}/${index}` }))
  for (const entry of pendingActions) validateAction(entry.action, entry.path, issues, 0, limits.maxActionDepth, limits.maxDiagnostics, actionCounter, { entityIds, cameraIds })

  const prefabs = document.prefabs ?? {}
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visitPrefab = (id: string, depth: number): void => {
    if (depth > limits.maxPrefabDepth) { push(issues, { severity: 'error', code: 'PREFAB_DEPTH_EXCEEDED', path: `/prefabs/${id}`, message: `Prefab nesting exceeds ${limits.maxPrefabDepth}.` }, limits.maxDiagnostics); return }
    if (visited.has(id)) return
    if (visiting.has(id)) { push(issues, { severity: 'error', code: 'PREFAB_CYCLE', path: `/prefabs/${id}`, message: `Circular prefab reference includes "${id}".` }, limits.maxDiagnostics); return }
    const prefab = prefabs[id]
    if (!prefab) return
    if (!id.trim()) push(issues, { severity: 'error', code: 'PREFAB_ID_REQUIRED', path: `/prefabs/${id}`, message: 'Prefab ids must not be empty.' }, limits.maxDiagnostics)
    if (prefab.version !== undefined && !/^[0-9]+(?:\.[0-9]+){0,2}(?:-[A-Za-z0-9.-]+)?$/.test(prefab.version)) push(issues, { severity: 'error', code: 'PREFAB_VERSION_INVALID', path: `/prefabs/${id}/version`, message: 'Prefab version must be a semantic version.' }, limits.maxDiagnostics)
    visiting.add(id)
    if (prefab.extends) {
      if (!prefabs[prefab.extends]) push(issues, { severity: 'error', code: 'PREFAB_EXTENDS_UNKNOWN', path: `/prefabs/${id}/extends`, message: `Unknown base prefab "${prefab.extends}".` }, limits.maxDiagnostics)
      else visitPrefab(prefab.extends, depth + 1)
    }
    const scan = (entities: readonly EntityDefinition[]): void => walkEntities(entities, `/prefabs/${id}/children`, (entity) => { if (entity.use) visitPrefab(entity.use, depth + 1) })
    scan(prefab.children ?? [])
    visiting.delete(id); visited.add(id)
  }
  Object.keys(prefabs).forEach((id) => visitPrefab(id, 0))

  const assetEntries = Object.entries(document.assets ?? {})
  if (assetEntries.length > limits.maxAssets) push(issues, { severity: 'error', code: 'ASSET_LIMIT_EXCEEDED', path: '/assets', message: `World contains ${assetEntries.length} assets; limit is ${limits.maxAssets}.` }, limits.maxDiagnostics)
  if (options.assetUrlPolicy) for (const [assetId, asset] of assetEntries) if (typeof asset.src === 'string') {
    const decision = options.assetUrlPolicy(asset.src, assetId)
    if (decision !== true) push(issues, { severity: 'error', code: 'ASSET_URL_REJECTED', path: `/assets/${assetId}/src`, message: typeof decision === 'string' ? decision : `Asset URL for "${assetId}" was rejected by host policy.` }, limits.maxDiagnostics)
  }
  const manifest = inspectAssetManifest(document)
  manifest.issues.forEach((entry) => push(issues, entry, limits.maxDiagnostics))

  for (const diagnostic of options.extensionRegistry?.resolve(document.requires, document.version) ?? []) {
    push(issues, { severity: diagnostic.severity, code: diagnostic.code, path: `/requires/${diagnostic.extension}`, message: diagnostic.message }, limits.maxDiagnostics)
  }
  for (const diagnostic of options.extensionRegistry?.validate?.(document) ?? []) {
    push(issues, { severity: diagnostic.severity, code: diagnostic.code, path: diagnostic.path ?? '/extensions', message: diagnostic.message }, limits.maxDiagnostics)
  }
  return issues
}
