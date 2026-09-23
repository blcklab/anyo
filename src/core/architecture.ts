import type {
  CameraDefinition,
  CompiledCamera,
  CompiledChannelMap,
  CompiledWorldChannels,
  CompilerDependencyGraph,
  EntityDefinition,
  ExtensionManifest,
  ExtensionRequirementDefinition,
  ExtensionResolutionDiagnostic,
  ExtensionValidationDiagnostic,
  NormalizedWorldDocument,
  RenderingHostPolicy,
  RenderingIntentDefinition,
  ResolvedRenderingConfiguration,
  RuntimeRenderingCapabilities,
  ToneMappingMode,
  TransformDefinition,
  WorldChannelsDefinition,
  WorldDocument,
  WorldQualityIntent,
} from './types.js'

const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'] as const
const DEFAULT_CHANNELS: Required<WorldChannelsDefinition> = {
  render: { world: 1, characters: 2, effects: 4, ui: 8 },
  picking: { interactive: 1, editorOnly: 2 },
  editor: { default: 1, hidden: 2 },
}

function channelBit(value: number | { bit: number }): number {
  return typeof value === 'number' ? value : value.bit
}

function compileChannelMap(
  value: WorldChannelsDefinition[keyof WorldChannelsDefinition] | undefined,
  defaults: NonNullable<WorldChannelsDefinition[keyof WorldChannelsDefinition]>,
): CompiledChannelMap {
  const names: Record<string, number> = {}
  let allMask = 0
  for (const [name, raw] of Object.entries(value ?? defaults).sort(([a], [b]) => a.localeCompare(b))) {
    const bit = channelBit(raw)
    if (!Number.isInteger(bit) || bit <= 0 || bit > 0x40000000 || (bit & (bit - 1)) !== 0) {
      throw new Error(`Channel "${name}" must use a positive single-bit mask.`)
    }
    if (Object.values(names).includes(bit)) throw new Error(`Channel bit ${bit} is assigned more than once.`)
    names[name] = bit
    allMask |= bit
  }
  return { names: Object.freeze(names), allMask }
}

export function compileWorldChannels(definition: WorldChannelsDefinition = {}): CompiledWorldChannels {
  return {
    render: compileChannelMap(definition.render, DEFAULT_CHANNELS.render),
    picking: compileChannelMap(definition.picking, DEFAULT_CHANNELS.picking),
    editor: compileChannelMap(definition.editor, DEFAULT_CHANNELS.editor),
  }
}

export function resolveChannelMask(
  names: readonly string[] | undefined,
  map: CompiledChannelMap,
  fallback: number = map.allMask,
): number {
  if (!names) return fallback
  let mask = 0
  for (const name of names) {
    const bit = map.names[name]
    if (bit === undefined) throw new Error(`Unknown channel "${name}".`)
    mask |= bit
  }
  return mask
}

function cameraTransform(definition: CameraDefinition): TransformDefinition {
  return {
    position: definition.position ?? [0, 1.6, 5],
    rotation: definition.rotation ?? [0, 0, 0],
    scale: definition.scale ?? [1, 1, 1],
  }
}

export function compileCameras(
  cameras: Readonly<Record<string, CameraDefinition>> = {},
  activeCamera?: string,
  channels: CompiledWorldChannels = compileWorldChannels(),
): { cameras: CompiledCamera[]; activeCameraId?: string } {
  const output = Object.entries(cameras).sort(([a], [b]) => a.localeCompare(b)).map(([id, definition]): CompiledCamera => ({
    id,
    type: definition.type,
    transform: cameraTransform(definition),
    parentId: definition.parent,
    fov: definition.type === 'perspective' ? (definition.fov ?? 55) : undefined,
    near: definition.near ?? 0.1,
    far: definition.far ?? 2000,
    size: definition.type === 'orthographic' ? (definition.size ?? 20) : undefined,
    bounds: definition.bounds,
    lookAt: definition.lookAt,
    follow: definition.follow,
    priority: definition.priority ?? 0,
    enabled: definition.enabled ?? true,
    metadata: definition.metadata ? structuredClone(definition.metadata) : undefined,
    transition: {
      duration: Math.max(0, definition.transition?.duration ?? 0),
      easing: definition.transition?.easing ?? 'ease-in-out',
    },
    renderMask: resolveChannelMask(definition.layers, channels.render),
  }))
  const ids = new Set(output.map((camera) => camera.id))
  for (const camera of output) {
    if (camera.parentId && !ids.has(camera.parentId)) throw new Error(`Camera "${camera.id}" references unknown parent camera "${camera.parentId}".`)
  }
  const enabled = output.filter((camera) => camera.enabled)
  const selected = activeCamera
    ? output.find((camera) => camera.id === activeCamera)
    : enabled.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0]
  if (activeCamera && !selected) throw new Error(`activeCamera references unknown camera "${activeCamera}".`)
  if (selected && !selected.enabled) throw new Error(`activeCamera "${selected.id}" is disabled.`)
  return { cameras: output, activeCameraId: selected?.id }
}

function qualityIndex(value: Exclude<WorldQualityIntent, 'auto'>): number {
  return QUALITY_ORDER.indexOf(value)
}

function clampQuality(
  requested: Exclude<WorldQualityIntent, 'auto'>,
  maximum?: Exclude<WorldQualityIntent, 'auto'>,
  supported?: readonly Exclude<WorldQualityIntent, 'auto'>[],
): Exclude<WorldQualityIntent, 'auto'> {
  let result = requested
  if (maximum && qualityIndex(result) > qualityIndex(maximum)) result = maximum
  if (supported?.length && !supported.includes(result)) {
    const candidates = supported.filter((quality) => qualityIndex(quality) <= qualityIndex(result))
    result = candidates.sort((a, b) => qualityIndex(b) - qualityIndex(a))[0] ?? supported[0] ?? 'low'
  }
  return result
}

function capabilityMatches(actual: unknown, expected: boolean | number | string | readonly string[]): boolean {
  if (expected === false) return true
  if (expected === true) return actual === true
  if (typeof expected === 'number') return typeof actual === 'number' && actual >= expected
  if (typeof expected === 'string') return actual === expected
  return Array.isArray(actual) && expected.every((item) => actual.includes(item))
}

export function resolveRenderingConfiguration(
  intent: RenderingIntentDefinition = {},
  host: RenderingHostPolicy = {},
  capabilities: RuntimeRenderingCapabilities = {},
): ResolvedRenderingConfiguration {
  const diagnostics: ResolvedRenderingConfiguration['diagnostics'][number][] = []
  const requested = intent.quality === 'auto' || !intent.quality
    ? (host.batterySaving ? 'low' : 'high')
    : intent.quality
  const quality = clampQuality(requested, host.maximumQuality, capabilities.supportedQuality)
  if (quality !== requested) diagnostics.push({ severity: 'info', code: 'RENDER_QUALITY_CLAMPED', message: `World quality ${requested} was resolved to ${quality}.` })
  const maximumPixelRatio = Math.max(0.5, Math.min(
    intent.pixelRatio?.maximum ?? 2,
    host.maximumPixelRatio ?? Number.POSITIVE_INFINITY,
    capabilities.maximumPixelRatio ?? Number.POSITIVE_INFINITY,
  ))
  const antialiasing = intent.antialiasing === 'auto' || !intent.antialiasing
    ? (quality === 'low' ? 'none' : 'fxaa')
    : intent.antialiasing
  const toneMapping: ToneMappingMode = intent.toneMapping ?? 'aces'
  for (const [feature, expected] of Object.entries(intent.capabilityRequirements ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const actual = capabilities.features?.[feature]
    if (!capabilityMatches(actual, expected)) diagnostics.push({
      severity: 'error',
      code: 'RENDER_CAPABILITY_UNAVAILABLE',
      message: `Required rendering capability "${feature}" is unavailable.`,
      details: { feature, expected, actual },
    })
  }
  return {
    backend: host.forcedBackend ?? capabilities.backend,
    quality,
    toneMapping,
    exposure: Math.max(0, Math.min(8, intent.exposure ?? 1)),
    shadows: {
      enabled: intent.shadows?.enabled ?? quality !== 'low',
      quality: intent.shadows?.quality ?? (quality === 'ultra' ? 'ultra' : quality === 'high' ? 'high' : quality === 'medium' ? 'medium' : 'low'),
    },
    antialiasing,
    pixelRatio: {
      mode: intent.pixelRatio?.mode ?? 'adaptive',
      maximum: maximumPixelRatio,
    },
    adaptiveQuality: intent.adaptiveQuality ?? true,
    memoryBudgetMB: host.memoryBudgetMB === undefined ? undefined : Math.max(16, host.memoryBudgetMB),
    accessibility: {
      reducedMotion: host.accessibility?.reducedMotion ?? false,
      highContrast: host.accessibility?.highContrast ?? false,
    },
    postProcessingProfile: intent.postProcessingProfile,
    diagnostics,
  }
}

function parseVersion(value: string): [number, number, number] {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim().replace(/^[~^]/, ''))
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : [0, 0, 0]
}

function compareVersion(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0)
  }
  return 0
}

function versionSatisfies(actual: string, requested: string): boolean {
  if (requested === '*' || requested === 'latest') return true
  const a = parseVersion(actual)
  const r = parseVersion(requested)
  if (compareVersion(a, r) < 0) return false
  if (requested.startsWith('^')) {
    if (r[0] > 0) return a[0] === r[0]
    if (r[1] > 0) return a[0] === 0 && a[1] === r[1]
    return a[0] === 0 && a[1] === 0 && a[2] === r[2]
  }
  if (requested.startsWith('~')) return a[0] === r[0] && a[1] === r[1]
  return compareVersion(a, r) === 0
}

function cloneManifest(manifest: ExtensionManifest): ExtensionManifest {
  return {
    ...manifest,
    capabilities: manifest.capabilities ? [...manifest.capabilities] : undefined,
    schemaVersions: manifest.schemaVersions ? [...manifest.schemaVersions] : undefined,
    componentTypes: manifest.componentTypes ? [...manifest.componentTypes] : undefined,
    entityTypes: manifest.entityTypes ? [...manifest.entityTypes] : undefined,
    actions: manifest.actions ? [...manifest.actions] : undefined,
    assetTypes: manifest.assetTypes ? [...manifest.assetTypes] : undefined,
    schema: manifest.schema ? structuredClone(manifest.schema) : undefined,
    validate: manifest.validate,
    migrate: manifest.migrate,
    snapshot: manifest.snapshot,
  }
}

export class ExtensionRegistry {
  private readonly manifests = new Map<string, ExtensionManifest>()
  private readonly ownership = new Map<string, string>()

  register(manifest: ExtensionManifest): () => void {
    if (!manifest.id.trim()) throw new Error('Extension manifest id must not be empty.')
    if (!manifest.version.trim()) throw new Error(`Extension "${manifest.id}" must declare a version.`)
    if (this.manifests.has(manifest.id)) throw new Error(`Extension "${manifest.id}" is already registered.`)
    const claims = [
      ...(manifest.componentTypes ?? []).map((name) => `component:${name}`),
      ...(manifest.entityTypes ?? []).map((name) => `entity:${name}`),
      ...(manifest.actions ?? []).map((name) => `action:${name}`),
      ...(manifest.assetTypes ?? []).map((name) => `asset:${name}`),
    ]
    for (const claim of claims) {
      const owner = this.ownership.get(claim)
      if (owner) throw new Error(`Extension namespace collision: ${claim} is already owned by "${owner}".`)
    }
    const stored = cloneManifest(manifest)
    this.manifests.set(manifest.id, stored)
    for (const claim of claims) this.ownership.set(claim, manifest.id)
    return () => {
      this.manifests.delete(manifest.id)
      for (const claim of claims) if (this.ownership.get(claim) === manifest.id) this.ownership.delete(claim)
    }
  }

  has(id: string): boolean { return this.manifests.has(id) }
  get(id: string): ExtensionManifest | undefined {
    const value = this.manifests.get(id)
    return value ? cloneManifest(value) : undefined
  }
  list(): readonly ExtensionManifest[] { return [...this.manifests.values()].map(cloneManifest) }
  capabilityOwners(capability: string): readonly string[] {
    return [...this.manifests.values()].filter((item) => item.capabilities?.includes(capability)).map((item) => item.id).sort()
  }

  validate(document: Readonly<WorldDocument>): ExtensionValidationDiagnostic[] {
    return [...this.manifests.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .flatMap((manifest) => (manifest.validate?.(document) ?? []).map((diagnostic) => ({
        ...diagnostic,
        code: `${manifest.id}:${diagnostic.code}`,
      })))
  }

  migrate(document: WorldDocument, fromVersion: string, toVersion: string): WorldDocument {
    let result = structuredClone(document)
    for (const manifest of [...this.manifests.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (manifest.migrate) result = manifest.migrate(result, fromVersion, toVersion)
    }
    return result
  }

  snapshotHooks(): readonly import('./types.js').SnapshotExtensionHook[] {
    return [...this.manifests.values()]
      .filter((manifest): manifest is ExtensionManifest & { snapshot: import('./types.js').SnapshotExtensionHook } => Boolean(manifest.snapshot))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((manifest) => manifest.snapshot)
  }

  schemaContributions(): readonly { id: string; root: Record<string, import('./types.js').JsonValue> }[] {
    return [...this.manifests.values()]
      .filter((manifest): manifest is ExtensionManifest & { schema: Record<string, import('./types.js').JsonValue> } => Boolean(manifest.schema))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((manifest) => ({ id: manifest.id, root: structuredClone(manifest.schema) }))
  }

  resolve(requirements: Readonly<Record<string, ExtensionRequirementDefinition>> = {}, schemaVersion?: string): ExtensionResolutionDiagnostic[] {
    const diagnostics: ExtensionResolutionDiagnostic[] = []
    for (const [id, requirement] of Object.entries(requirements)) {
      const manifest = this.manifests.get(id)
      if (!manifest) {
        diagnostics.push({
          severity: requirement.required ?? true ? 'error' : 'warning',
          code: requirement.required ?? true ? 'EXTENSION_REQUIRED_MISSING' : 'EXTENSION_OPTIONAL_MISSING',
          extension: id,
          message: `${requirement.required ?? true ? 'Required' : 'Optional'} extension "${id}" is not registered.`,
        })
        continue
      }
      if (!versionSatisfies(manifest.version, requirement.version)) {
        diagnostics.push({ severity: 'error', code: 'EXTENSION_VERSION_INCOMPATIBLE', extension: id, message: `Extension "${id}" ${manifest.version} does not satisfy ${requirement.version}.` })
      }
      if (schemaVersion && manifest.schemaVersions?.length && !manifest.schemaVersions.some((value) => versionSatisfies(schemaVersion, value))) {
        diagnostics.push({ severity: 'error', code: 'EXTENSION_SCHEMA_INCOMPATIBLE', extension: id, message: `Extension "${id}" does not support world schema ${schemaVersion}.` })
      }
      for (const capability of requirement.capabilities ?? []) {
        if (!(manifest.capabilities ?? []).includes(capability)) diagnostics.push({ severity: 'error', code: 'EXTENSION_CAPABILITY_MISSING', extension: id, message: `Extension "${id}" does not provide capability "${capability}".` })
      }
    }
    return diagnostics
  }
}

function addConsumer(map: Map<string, Set<string>>, key: string | undefined, consumer: string): void {
  if (!key) return
  const set = map.get(key) ?? new Set<string>()
  set.add(consumer)
  map.set(key, set)
}

function collectBindings(value: unknown, entityId: string, output: Map<string, Set<string>>): void {
  if (Array.isArray(value)) {
    for (const child of value) collectBindings(child, entityId, output)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.$bind === 'string') addConsumer(output, record.$bind, entityId)
  for (const child of Object.values(record)) collectBindings(child, entityId, output)
}

function walkEntities(
  entities: readonly EntityDefinition[],
  visitor: (entity: EntityDefinition) => void,
): void {
  for (const entity of entities) {
    visitor(entity)
    walkEntities(entity.children ?? [], visitor)
  }
}

export function buildCompilerDependencyGraph(document: WorldDocument | NormalizedWorldDocument): CompilerDependencyGraph {
  const materialConsumers = new Map<string, Set<string>>()
  const assetConsumers = new Map<string, Set<string>>()
  const prefabInstances = new Map<string, Set<string>>()
  const compositionInstances = new Map<string, Set<string>>()
  const cameraDependents = new Map<string, Set<string>>()
  const variableBindings = new Map<string, Set<string>>()
  const collectEntity = (entity: EntityDefinition): void => {
    addConsumer(materialConsumers, entity.material, entity.id)
    addConsumer(assetConsumers, entity.asset, entity.id)
    addConsumer(prefabInstances, entity.use, entity.instanceId ?? entity.id)
    addConsumer(compositionInstances, entity.composition, entity.instanceId ?? entity.id)
    collectBindings(entity, entity.id, variableBindings)
  }
  walkEntities(document.entities ?? [], collectEntity)
  for (const floor of document.building?.floors ?? []) for (const room of floor.rooms) walkEntities(room.entities ?? [], collectEntity)
  for (const [prefabId, prefab] of Object.entries(document.prefabs ?? {})) {
    if (prefab.extends) addConsumer(prefabInstances, prefab.extends, `prefab:${prefabId}`)
    walkEntities(prefab.children ?? [], (entity) => {
      addConsumer(materialConsumers, entity.material, `prefab:${prefabId}/${entity.id}`)
      addConsumer(assetConsumers, entity.asset, `prefab:${prefabId}/${entity.id}`)
      addConsumer(prefabInstances, entity.use, `prefab:${prefabId}/${entity.id}`)
      collectBindings(entity, `prefab:${prefabId}/${entity.id}`, variableBindings)
    })
  }
  for (const [compositionId, composition] of Object.entries(document.compositions ?? {})) {
    if (composition.extends) addConsumer(compositionInstances, composition.extends, `composition:${compositionId}`)
    walkEntities(composition.children ?? [], (entity) => {
      addConsumer(materialConsumers, entity.material, `composition:${compositionId}/${entity.id}`)
      addConsumer(assetConsumers, entity.asset, `composition:${compositionId}/${entity.id}`)
      addConsumer(prefabInstances, entity.use, `composition:${compositionId}/${entity.id}`)
      addConsumer(compositionInstances, entity.composition, `composition:${compositionId}/${entity.id}`)
      collectBindings(entity, `composition:${compositionId}/${entity.id}`, variableBindings)
    })
  }
  for (const [id, camera] of Object.entries(document.cameras ?? {})) {
    if (camera.parent) addConsumer(cameraDependents, camera.parent, id)
    if (camera.follow?.entity) addConsumer(cameraDependents, camera.follow.entity, id)
    if (camera.lookAt && !Array.isArray(camera.lookAt) && 'entity' in camera.lookAt) addConsumer(cameraDependents, camera.lookAt.entity, id)
  }
  return { materialConsumers, assetConsumers, prefabInstances, compositionInstances, cameraDependents, variableBindings }
}
