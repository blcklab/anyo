import { cloneWorldDocument, findEntityInDocument, getValueAtPointer, hashWorldDocument, serializeWorldDocument, type SerializeWorldOptions } from '../document/index.js'
import { DocumentHistory } from '../history/index.js'
import { migrateWorldDocument, type MigrationResult } from '../migrations/index.js'
import { getDataPath, setDataPath } from '../schema/bindings.js'
import { assertSafeObjectGraph, hasOwn, parseJsonPointer } from '../schema/safePath.js'
import { inspectWorldDocument, validateWorldDocument, type ValidationResult } from '../schema/validate.js'
import { normalizeWorldDocument } from '../schema/normalize.js'
import { composeMatrix4, decomposeMatrix4, relativeTransformMatrix } from '../math/matrix4.js'
import { quaternionFromEulerXYZ } from '../math/quaternion.js'
import { normalizeScale } from '../math/transform.js'
import { RuntimeTransformStore } from '../systems/RuntimeTransformStore.js'
import { SystemScheduler } from '../systems/SystemScheduler.js'
import { WorldQuery } from '../systems/WorldQuery.js'
import { ActionRegistry } from './ActionRegistry.js'
import { assertUniquePluginNames, createCompileAccumulator, finalizeCompiledWorld } from './compile.js'
import { classifyWorldChanges } from './changes.js'
import { buildCompilerDependencyGraph, compileCameras, compileWorldChannels } from './architecture.js'
import { applyStableTransaction } from './domainPatch.js'
import { EventBus } from './EventBus.js'
import { WindowFrameDriver } from './WindowFrameDriver.js'
import { WorldXRController } from './WorldXR.js'
import { WorldExplorationController } from './WorldExploration.js'
import type {
  ActionHandler,
  Bounds3,
  CompiledEntityNode,
  CompiledPrimitive,
  CompiledWorld,
  CreateWorldOptions,
  EntityDefinition,
  MaterialDefinition,
  NormalizedWorldDocument,
  PluginRuntimeContext,
  RendererAdapter,
  WorldDocument,
  WorldPatch,
  HistoryEntrySummary,
  InteractionSelection,
  WorldEventHandler,
  WorldInput,
  WorldPlugin,
  WorldChange,
  WorldSourceContext,
  RendererFrameDriver,
  RendererAssetProgress,
  RuntimeTransformUpdate,
  SystemFrameDriver,
  WorldSystem,
  Matrix4Tuple,
  WorldValidationOptions,
  ActionDefinition,
  CameraTransitionDefinition,
  CompilerDependencyGraph,
  CompilerPerformanceReport,
  PatchResult,
  SnapshotExtensionHook,
  WorldRuntimeSnapshot,
  WorldRuntimeSnapshotInput,
  WorldTransaction,
} from './types.js'
import { HeadlessRenderer, isHeadlessRenderer } from './HeadlessRenderer.js'
import { validateWorldRuntimeSnapshot } from '../snapshots/index.js'
import { prepareFastEntityMutation, type FastEntityMutation } from './fastEntityMutation.js'

export type ChangeClassification = 'data' | 'entity' | 'structure' | 'document' | 'history'

export interface DocumentChangeEvent {
  label: string
  classification: ChangeClassification
  source: 'api' | 'patch' | 'transaction' | 'history' | 'load' | 'preview'
  document: WorldDocument
}

interface PreparedWorld {
  document: NormalizedWorldDocument
  compiled: CompiledWorld
}

interface RuntimeSnapshot {
  cameraPosition: readonly [number, number, number]
  cameraRotation: readonly [number, number]
  currentRoom: string | null
  roomVisibility: ReadonlyMap<string, boolean>
}

interface PreviewState {
  label: string
  before: WorldDocument
}

function isUrlInput(input: WorldInput): input is string | URL {
  return typeof input === 'string' || input instanceof URL
}

interface LoadedWorldInput {
  document: WorldDocument
  sourceContext?: WorldSourceContext
}

async function loadInput(input: WorldInput): Promise<LoadedWorldInput> {
  if (!isUrlInput(input)) return { document: cloneWorldDocument(input) }
  if (typeof fetch === 'undefined') throw new Error('Loading a world URL requires a runtime with fetch support.')
  const documentUrl = new URL(String(input), typeof location === 'undefined' ? undefined : location.href)
  const response = await fetch(documentUrl)
  if (!response.ok) throw new Error(`Failed to load Anyo world: ${response.status} ${response.statusText}`)
  const value = await response.json() as unknown
  if (!value || typeof value !== 'object') throw new Error('The loaded Anyo world is not a JSON object.')
  return {
    document: value as WorldDocument,
    sourceContext: {
      documentUrl: documentUrl.href,
      baseUrl: new URL('.', documentUrl).href,
    },
  }
}

function resolveArrayIndex(key: string, length: number, allowAppend: boolean): number {
  if (key === '-' && allowAppend) return length
  const index = Number(key)
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid array index "${key}".`)
  return index
}

function escapePointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function formatJsonPointer(parts: readonly string[]): string {
  return parts.length === 0 ? '' : `/${parts.map(escapePointerSegment).join('/')}`
}

function clonePatchValue(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value)
}

function transformMatrix(transform: { position: readonly [number, number, number]; rotation: readonly [number, number, number]; quaternion?: readonly [number, number, number, number]; scale: readonly [number, number, number]; matrix?: readonly number[] }): Matrix4Tuple {
  return (transform.matrix as Matrix4Tuple | undefined) ?? composeMatrix4(
    transform.position,
    transform.quaternion ?? quaternionFromEulerXYZ(transform.rotation),
    transform.scale,
  )
}


function applyPatchValue(root: unknown, patch: WorldPatch): WorldPatch {
  const parts = parseJsonPointer(patch.path)
  if (parts.length === 0) throw new Error('Patching the document root is not supported.')

  let target: unknown = root
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(target)) {
      const index = resolveArrayIndex(part, target.length, false)
      if (index >= target.length) throw new Error(`Array index is outside patch path "${patch.path}".`)
      target = target[index]
    } else if (target && typeof target === 'object') {
      if (!hasOwn(target, part)) throw new Error(`Cannot resolve JSON patch path "${patch.path}".`)
      target = (target as Record<string, unknown>)[part]
    } else {
      throw new Error(`Cannot resolve JSON patch path "${patch.path}".`)
    }
  }

  const key = parts.at(-1)
  if (key === undefined) throw new Error(`Cannot resolve JSON patch path "${patch.path}".`)
  if (Array.isArray(target)) {
    const index = resolveArrayIndex(key, target.length, patch.operation === 'add')
    const actualPath = formatJsonPointer([...parts.slice(0, -1), String(index)])
    if (patch.operation === 'remove') {
      if (index >= target.length) throw new Error(`Array index is outside patch path "${patch.path}".`)
      const previous = clonePatchValue(target[index])
      target.splice(index, 1)
      return { operation: 'add', path: actualPath, value: previous }
    }
    if (patch.operation === 'add') {
      if (index > target.length) throw new Error(`Array index is outside patch path "${patch.path}".`)
      assertSafeObjectGraph(patch.value, `JSON patch value at ${patch.path}`)
      target.splice(index, 0, clonePatchValue(patch.value))
      return { operation: 'remove', path: actualPath }
    }
    if (index >= target.length) throw new Error(`Array index is outside patch path "${patch.path}".`)
    const previous = clonePatchValue(target[index])
    assertSafeObjectGraph(patch.value, `JSON patch value at ${patch.path}`)
    target[index] = clonePatchValue(patch.value)
    return { operation: 'replace', path: actualPath, value: previous }
  }

  if (!target || typeof target !== 'object') throw new Error(`Cannot apply patch path "${patch.path}".`)
  const record = target as Record<string, unknown>
  const existed = hasOwn(record, key)
  const previous = existed ? clonePatchValue(record[key]) : undefined
  if (patch.operation === 'remove') {
    if (!existed) throw new Error(`Cannot remove missing path "${patch.path}".`)
    delete record[key]
    return { operation: 'add', path: patch.path, value: previous }
  }

  if (patch.operation === 'replace' && !existed) throw new Error(`Cannot replace missing path "${patch.path}".`)
  assertSafeObjectGraph(patch.value, `JSON patch value at ${patch.path}`)
  record[key] = clonePatchValue(patch.value)
  return existed
    ? { operation: 'replace', path: patch.path, value: previous }
    : { operation: 'remove', path: patch.path }
}

export class World {
  renderer: NonNullable<CreateWorldOptions['renderer']>
  readonly plugins: readonly WorldPlugin[]
  readonly systems: readonly WorldSystem[]
  readonly transforms: RuntimeTransformStore
  readonly query: WorldQuery
  readonly exploration: WorldExplorationController
  readonly xr: WorldXRController

  document: NormalizedWorldDocument | null = null
  compiled: CompiledWorld | null = null

  private sourceDocument: WorldDocument | null = null
  private sourceContext?: WorldSourceContext
  private runtimeData: Record<string, unknown> = {}
  private readonly events = new EventBus()
  private readonly actions = new ActionRegistry(this)
  private readonly history: DocumentHistory
  private readonly warningHandler: (message: string) => void
  private readonly configuredPixelRatio?: number
  private runtimeContext: PluginRuntimeContext | null = null
  private running = false
  private readonly windowFrameDriver = new WindowFrameDriver()
  private activeFrameDriver: RendererFrameDriver | null = null
  private previousTime = 0
  private resizeObserver: ResizeObserver | null = null
  private currentRoom: string | null = null
  private disposed = false
  private disposing = false
  private disposalPromise: Promise<void> | null = null
  private rendererEventCleanups: Array<() => void> = []
  private mutationQueue: Promise<void> = Promise.resolve()
  private runtimeTransformQueue: Promise<void> = Promise.resolve()
  private previewState: PreviewState | null = null
  private readonly systemScheduler: SystemScheduler
  private readonly validationOptions: WorldValidationOptions
  private readonly snapshotHooks = new Map<string, SnapshotExtensionHook>()
  private dependencyGraph: CompilerDependencyGraph | null = null
  private compilerReport: CompilerPerformanceReport | null = null

  constructor(options: CreateWorldOptions = {}) {
    this.renderer = options.renderer ?? new HeadlessRenderer()
    this.plugins = options.plugins ?? []
    this.systems = options.systems ?? []
    this.warningHandler = options.onWarning ?? ((message) => console.warn(`[Anyo] ${message}`))
    this.configuredPixelRatio = options.pixelRatio
    this.history = new DocumentHistory(options.historyLimit ?? 100)
    this.validationOptions = options.validation ?? {}
    this.query = new WorldQuery()
    this.transforms = new RuntimeTransformStore()
    this.systemScheduler = new SystemScheduler(this.systems, options.systemOptions, this.transforms, this.warningHandler)
    this.exploration = new WorldExplorationController()
    this.xr = new WorldXRController(this)
    this.bindRendererEvents()
    assertUniquePluginNames([...this.plugins])
    this.registerBuiltInActions()
    for (const hook of this.validationOptions.extensionRegistry?.snapshotHooks?.() ?? []) this.registerSnapshotExtension(hook)

    if ((options.autoResize ?? true) && !isHeadlessRenderer(this.renderer)) this.installResizeObserver()
  }

  async load(input: WorldInput): Promise<this> {
    await this.enqueue(async () => {
      this.assertNotDisposed()
      this.assertNoActivePreview('load a world')
      const loaded = await loadInput(input)
      const migration = migrateWorldDocument(loaded.document)
      if (this.validationOptions.extensionRegistry?.migrate) {
        const beforeExtensionMigration = hashWorldDocument(migration.document)
        migration.document = this.validationOptions.extensionRegistry.migrate(migration.document, migration.from, migration.to)
        if (hashWorldDocument(migration.document) !== beforeExtensionMigration) {
          migration.changes.push({ path: '/extensions', description: 'Applied registered extension migration hooks.' })
          migration.changed = true
        }
      }
      assertSafeObjectGraph(migration.document, 'world document')
      validateWorldDocument(migration.document, this.worldValidationOptions())
      const previousSource = this.sourceDocument ? cloneWorldDocument(this.sourceDocument) : null
      const previousSourceContext = this.sourceContext
      const previousRuntimeData = structuredClone(this.runtimeData)
      const previousRuntimeTransforms = this.transforms.snapshotLayers()
      this.sourceDocument = migration.document
      this.sourceContext = loaded.sourceContext
      this.runtimeData = structuredClone(migration.document.data ?? {})
      try {
        await this.rebuild({ preserveRuntime: false, resetRuntimeTransforms: true })
      } catch (error) {
        this.sourceDocument = previousSource
        this.sourceContext = previousSourceContext
        this.runtimeData = previousRuntimeData
        this.transforms.restoreLayers(previousRuntimeTransforms)
        if (previousSource) {
          try { await this.rebuild({ preserveRuntime: true }) }
          catch (restoreError) { this.warningHandler(`World rollback failed after load error: ${String(restoreError)}`) }
        }
        throw error
      }
      this.history.clear()
      this.events.emit<MigrationResult>('world:migrate', migration)
      this.emitDocumentChange('Load world', 'document', 'load')
    })
    return this
  }

  async reload(): Promise<void> {
    await this.enqueue(async () => {
      this.assertNotDisposed()
      if (!this.sourceDocument) throw new Error('Cannot reload before a world document has been loaded.')
      await this.rebuild({ preserveRuntime: true })
    })
  }

  async whenReady(): Promise<void> {
    this.assertNotDisposed()
    await this.mutationQueue
    await this.runtimeTransformQueue
    this.assertReady()
  }

  async whenIdle(): Promise<void> {
    await this.whenReady()
    await this.renderer.whenIdle?.()
    await this.runtimeTransformQueue
  }

  getAssetProgress(): RendererAssetProgress {
    return this.renderer.getAssetProgress?.() ?? {
      queued: 0,
      loading: 0,
      loaded: 0,
      failed: 0,
      total: 0,
      ratio: 1,
    }
  }

  start(): void {
    this.assertReady()
    if (isHeadlessRenderer(this.renderer)) throw new Error('Cannot start a render loop without an attached renderer.')
    if (this.running) return
    this.previousTime = typeof performance === 'undefined' ? Date.now() : performance.now()
    this.activeFrameDriver = this.renderer.frameDriver ?? this.windowFrameDriver
    this.running = true
    try {
      this.activeFrameDriver.start(this.stepFrame)
    } catch (error) {
      this.running = false
      this.activeFrameDriver = null
      throw error
    }
    this.exploration.setWorldRunning(true)
    this.events.emit('world:start', undefined)
  }

  get isRunning(): boolean { return this.running }
  get isDisposed(): boolean { return this.disposed }

  pause(): void {
    if (!this.running) return
    this.stop()
    this.events.emit('world:pause', undefined)
  }

  resume(): void {
    if (this.running) return
    this.start()
    this.events.emit('world:resume', undefined)
  }

  stop(): void {
    if (!this.running) return
    this.activeFrameDriver?.stop()
    this.activeFrameDriver = null
    this.running = false
    this.exploration.setWorldRunning(false)
    this.events.emit('world:stop', undefined)
  }

  readonly stepFrame = (time: number): void => {
    if (!this.running || !this.runtimeContext) return
    const delta = Math.max(0, (time - this.previousTime) / 1000)
    this.previousTime = time
    this.runFrame(delta, time, this.activeFrameDriver?.mode ?? 'window')
  }

  tick(deltaSeconds: number): void {
    this.assertReady()
    if (this.running) throw new Error('Cannot manually tick an Anyo world while its render loop is running.')
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('tick(deltaSeconds) requires a non-negative finite number.')
    const time = (typeof performance === 'undefined' ? Date.now() : performance.now())
    this.runFrame(deltaSeconds, time, 'manual')
  }

  private runFrame(deltaSeconds: number, time: number, driver: SystemFrameDriver): void {
    const context = this.runtimeContext
    if (!context) return
    const delta = Math.max(0, deltaSeconds)
    const systemFrame = this.systemScheduler.beginFrame(delta, time, driver)

    for (const plugin of this.plugins) {
      try {
        plugin.update?.(delta, context)
      } catch (error) {
        this.warningHandler(`Plugin "${plugin.name}" failed during update: ${String(error)}`)
      }
    }
    this.systemScheduler.lateFrame(delta)
    this.flushRuntimeTransformsForFrame()
    try {
      this.renderer.render(delta)
    } catch (error) {
      this.warningHandler(`Renderer failed during frame: ${String(error)}`)
    }
    this.events.emit('world:frame', {
      delta,
      time,
      driver,
      fixedSteps: systemFrame.fixedSteps,
      interpolationAlpha: systemFrame.interpolationAlpha,
    })
  }

  async flushRuntimeTransforms(): Promise<number> {
    this.assertReady()
    await this.runtimeTransformQueue
    const updates = this.transforms.takeUpdates()
    if (updates.length === 0) return 0
    try {
      await this.applyRuntimeTransformBatch(updates)
      this.emitRuntimeTransformBatch(updates)
      return updates.length
    } catch (error) {
      this.transforms.restoreUpdates(updates)
      throw error
    }
  }

  private flushRuntimeTransformsForFrame(): void {
    const updates = this.transforms.takeUpdates()
    if (updates.length === 0) return
    if (this.renderer.applyRuntimeTransforms) {
      try {
        this.renderer.applyRuntimeTransforms(updates)
        this.emitRuntimeTransformBatch(updates)
      } catch (error) {
        this.transforms.restoreUpdates(updates)
        this.warningHandler(`Renderer failed during runtime transform synchronization: ${String(error)}`)
      }
      return
    }

    this.runtimeTransformQueue = this.runtimeTransformQueue
      .then(async () => {
        await this.applyRuntimeTransformBatch(updates)
        this.emitRuntimeTransformBatch(updates)
      })
      .catch((error) => {
        this.transforms.restoreUpdates(updates)
        this.warningHandler(`Renderer failed during runtime transform synchronization: ${String(error)}`)
      })
  }

  private async applyRuntimeTransformBatch(updates: readonly RuntimeTransformUpdate[]): Promise<void> {
    if (updates.length === 0) return
    if (this.renderer.applyRuntimeTransforms) {
      this.renderer.applyRuntimeTransforms(updates)
      return
    }
    const changes: WorldChange[] = updates.map((update) => ({
      type: 'primitive-transform',
      primitiveId: update.primitiveId,
      primitive: update.primitive,
    }))
    if (this.renderer.applyChanges && this.compiled && this.document) {
      await this.renderer.applyChanges(changes, this.compiled, this.document)
      return
    }
    if (this.renderer.updatePrimitive) {
      for (const update of updates) await this.renderer.updatePrimitive(update.primitive)
      return
    }
    throw new Error('The attached renderer does not support runtime transform synchronization.')
  }

  private emitRuntimeTransformBatch(updates: readonly RuntimeTransformUpdate[]): void {
    this.events.emit('runtime:transforms', {
      primitiveCount: updates.length,
      entityCount: new Set(updates.map((update) => update.entityId)).size,
      updates,
    })
  }

  on<T = unknown>(event: string, handler: WorldEventHandler<T>): () => void {
    return this.events.on(event, handler)
  }

  emit<T = unknown>(event: string, payload: T): void {
    this.events.emit(event, payload)
  }

  registerAction(name: string, handler: ActionHandler): () => void {
    return this.actions.register(name, handler)
  }

  async runAction(name: string, params: Record<string, unknown> = {}, source?: string): Promise<void> {
    await this.actions.run(name, params, source)
  }

  async executeActions(actions: readonly ActionDefinition[], source?: string): Promise<void> {
    for (const action of actions) {
      if (action.type === 'sequence') {
        await this.executeActions(action.actions ?? [], source)
        continue
      }
      const legacyAction = !action.type && typeof action.action === 'string' ? action.action : null
      if (legacyAction || action.type === 'invoke') {
        const name = legacyAction ?? action.action
        if (!name) throw new Error('invoke action requires a registered action name.')
        await this.runAction(name, action.params ?? {}, source)
        continue
      }
      switch (action.type) {
        case 'emit':
          if (!action.event) throw new Error('emit action requires an event.')
          this.emit(action.event, action.value ?? action.params ?? null)
          break
        case 'setVariable':
          if (!action.path) throw new Error('setVariable action requires a path.')
          await this.setData(action.path, action.value)
          break
        case 'toggleVariable': {
          if (!action.path) throw new Error('toggleVariable action requires a path.')
          await this.setData(action.path, !Boolean(this.getData(action.path)))
          break
        }
        case 'incrementVariable': {
          if (!action.path) throw new Error('incrementVariable action requires a path.')
          const current = Number(this.getData(action.path) ?? 0)
          if (!Number.isFinite(current)) throw new Error(`Variable "${action.path}" is not numeric.`)
          await this.setData(action.path, current + (action.amount ?? 1))
          break
        }
        case 'setVisibility':
          if (!action.target) throw new Error('setVisibility action requires a target entity.')
          await this.updateEntity(action.target, { visible: action.visible ?? Boolean(action.value) })
          break
        case 'setTransform':
          if (!action.target || !action.transform) throw new Error('setTransform action requires target and transform.')
          await this.updateEntity(action.target, action.transform)
          break
        case 'activateCamera':
          if (!action.camera) throw new Error('activateCamera action requires a camera id.')
          await this.activateCamera(action.camera, action.transition)
          break
        case 'enableEntity':
        case 'disableEntity':
          if (!action.target) throw new Error(`${action.type} action requires a target entity.`)
          await this.updateEntity(action.target, { enabled: action.type === 'enableEntity' })
          break
        case undefined:
          if (action.event) this.emit(action.event, action.params ?? {})
          else throw new Error('Action declaration is missing a supported discriminator.')
          break
        default:
          throw new Error(`Unsupported declarative action type "${String(action.type)}".`)
      }
    }
  }

  async dispatchDocumentEvent(event: string, payload?: unknown, source?: string): Promise<void> {
    this.assertReady()
    this.emit(event, payload ?? null)
    const actions = this.document?.events?.[event]
    if (actions?.length) await this.executeActions(actions, source ?? `world:${event}`)
  }

  async activateCamera(id: string, transition?: CameraTransitionDefinition): Promise<void> {
    this.assertReady()
    const camera = this.compiled?.cameraById.get(id)
    if (!camera || !camera.enabled) throw new Error(`Unknown or disabled camera "${id}".`)
    if (this.renderer.activateCamera) await this.renderer.activateCamera(id, camera, transition ?? camera.transition)
    else {
      this.renderer.camera.setPosition(camera.transform.position)
      const rotation = camera.transform.rotation
      this.renderer.camera.setRotation(rotation[1], rotation[0])
    }
    if (this.compiled) this.compiled.activeCameraId = id
    this.events.emit('camera:activate', { cameraId: id, transition: transition ?? camera.transition })
  }

  async applyTransaction(transaction: WorldTransaction): Promise<PatchResult> {
    return this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('apply a stable transaction')
      const beforeCompiled = this.compiled as CompiledWorld
      const beforeDocument = this.document as NormalizedWorldDocument
      try {
        const applied = applyStableTransaction(this.sourceDocument as WorldDocument, transaction)
        await this.commitDocument(applied.document, `Transaction ${transaction.id}`, 'document', 'transaction', true, {
          forward: applied.forward,
          inverse: applied.inverse,
        })
        const rendererChanges = classifyWorldChanges(
          beforeCompiled,
          this.compiled as CompiledWorld,
          beforeDocument,
          this.document as NormalizedWorldDocument,
        ).changes
        return {
          applied: true,
          revision: this.sourceDocument?.revision ?? 0,
          diagnostics: applied.diagnostics,
          affectedEntities: [...applied.affectedEntities].sort(),
          affectedMaterials: [...applied.affectedMaterials].sort(),
          affectedAssets: [...applied.affectedAssets].sort(),
          affectedPrefabs: [...applied.affectedPrefabs].sort(),
          affectedCameras: [...applied.affectedCameras].sort(),
          rendererChanges,
          rebuildRequired: rendererChanges.some((change) => change.type === 'world-rebuild'),
        }
      } catch (error) {
        return {
          applied: false,
          revision: this.sourceDocument?.revision ?? 0,
          diagnostics: [{ severity: 'error', code: 'TRANSACTION_REJECTED', message: String(error instanceof Error ? error.message : error) }],
          affectedEntities: [], affectedMaterials: [], affectedAssets: [], affectedPrefabs: [], affectedCameras: [],
          rendererChanges: [], rebuildRequired: false,
        }
      }
    })
  }

  registerSnapshotExtension(hook: SnapshotExtensionHook): () => void {
    if (!hook.id.trim()) throw new Error('Snapshot extension id must not be empty.')
    if (this.snapshotHooks.has(hook.id)) throw new Error(`Snapshot extension "${hook.id}" is already registered.`)
    this.snapshotHooks.set(hook.id, hook)
    return () => this.snapshotHooks.delete(hook.id)
  }

  createSnapshot(): WorldRuntimeSnapshot {
    this.assertReady()
    const entities: WorldRuntimeSnapshot['entities'] = {}
    for (const entity of this.compiled?.entities ?? []) {
      const resolved = this.transforms.getResolved(entity.id)
      if (!resolved) continue
      entities[entity.authoringId] = {
        position: [...resolved.position] as [number, number, number],
        rotation: [...resolved.rotation] as [number, number, number],
        scale: [...resolved.scale] as [number, number, number],
        visible: (entity.enabled ?? true),
      }
    }
    const extensions: Record<string, import('./types.js').JsonValue> = {}
    for (const hook of this.snapshotHooks.values()) {
      const value = hook.create?.()
      if (value !== undefined) extensions[hook.id] = structuredClone(value)
    }
    return {
      snapshotVersion: '1.0',
      worldId: typeof this.sourceDocument?.metadata?.id === 'string' ? this.sourceDocument.metadata.id : undefined,
      worldRevision: this.sourceDocument?.revision ?? 0,
      variables: structuredClone(this.runtimeData),
      entities,
      activeCamera: this.compiled?.activeCameraId,
      roomVisibility: Object.fromEntries((this.compiled?.rooms ?? []).map((room) => [room.roomId, room.visible])),
      portalStates: Object.fromEntries((this.compiled?.portals ?? []).map((portal) => [portal.id, portal.open])),
      player: isHeadlessRenderer(this.renderer) ? undefined : {
        position: [...this.renderer.camera.getPosition()] as [number, number, number],
        rotation: [...this.renderer.camera.getRotation()] as [number, number],
        room: this.currentRoom ?? undefined,
      },
      extensions: Object.keys(extensions).length ? extensions : undefined,
    }
  }

  async restoreSnapshot(snapshot: WorldRuntimeSnapshotInput): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      validateWorldRuntimeSnapshot(snapshot, { worldRevision: this.sourceDocument?.revision ?? 0, worldId: typeof this.sourceDocument?.metadata?.id === 'string' ? this.sourceDocument.metadata.id : undefined })
      const previousData = structuredClone(this.runtimeData)
      const previousLayers = this.transforms.snapshotLayers()
      try {
        if (snapshot.variables) this.runtimeData = structuredClone(snapshot.variables)
        const prepared = this.prepareWorld()
        await this.applyPreparedWorld(prepared)
        for (const [id, transform] of Object.entries(snapshot.entities ?? {})) {
          const node = this.compiled?.entityByAuthoringId.get(id) ?? this.compiled?.entityById.get(id)
          if (!node) continue
          this.transforms.set(node.id, transform, { source: 'anyo.snapshot', priority: 10_000, mode: 'override', space: 'world' })
          if (transform.visible !== undefined) {
            for (const primitiveId of node.primitiveIds) this.renderer.setPrimitiveVisibility?.(primitiveId, transform.visible)
          }
        }
        await this.flushRuntimeTransforms()
        for (const [roomId, visible] of Object.entries(snapshot.roomVisibility ?? {})) this.setRoomVisibility(roomId, visible)
        for (const [portalId, open] of Object.entries(snapshot.portalStates ?? {})) {
          const portal = this.compiled?.portals.find((candidate) => candidate.id === portalId)
          if (portal) { portal.open = open; this.renderer.setPortalState?.(portalId, open) }
        }
        if (snapshot.activeCamera && this.compiled?.cameraById.has(snapshot.activeCamera)) await this.activateCamera(snapshot.activeCamera)
        if (snapshot.player && !isHeadlessRenderer(this.renderer)) {
          this.renderer.camera.setPosition(snapshot.player.position)
          this.renderer.camera.setRotation(snapshot.player.rotation[0], snapshot.player.rotation[1])
          this.setCurrentRoom(snapshot.player.room ?? null)
        }
        for (const [id, value] of Object.entries(snapshot.extensions ?? {})) await this.snapshotHooks.get(id)?.restore?.(value)
        this.events.emit('snapshot:restore', { snapshotVersion: snapshot.snapshotVersion, worldRevision: snapshot.worldRevision })
      } catch (error) {
        this.runtimeData = previousData
        this.transforms.restoreLayers(previousLayers)
        throw error
      }
    })
  }

  async commitSnapshot(snapshot: WorldRuntimeSnapshotInput = this.createSnapshot(), label = 'Commit runtime snapshot'): Promise<void> {
    await this.transaction((document) => {
      if (snapshot.variables) document.data = structuredClone(snapshot.variables)
      for (const [id, transform] of Object.entries(snapshot.entities ?? {})) {
        const entity = findEntityInDocument(document, id)
        if (!entity) continue
        if (transform.position) entity.position = structuredClone(transform.position)
        if (transform.rotation) entity.rotation = structuredClone(transform.rotation)
        if (transform.scale) entity.scale = structuredClone(transform.scale)
        if (transform.visible !== undefined) entity.visible = transform.visible
      }
      if (snapshot.activeCamera) document.activeCamera = snapshot.activeCamera
      for (const [id, value] of Object.entries(snapshot.extensions ?? {})) this.snapshotHooks.get(id)?.commit?.(value, document)
    }, label)
  }

  getDependencyGraph(): CompilerDependencyGraph | null { return this.dependencyGraph }
  getCompilerPerformanceReport(): CompilerPerformanceReport | null { return this.compilerReport ? structuredClone(this.compilerReport) : null }

  async selectPrimitive(selection: InteractionSelection): Promise<boolean> {
    this.assertReady()
    const primitive = this.compiled?.primitiveById.get(selection.primitiveId)
    if (!primitive?.interaction) return false
    const interaction = primitive.interaction
    const maxDistance = interaction.distance
    if (maxDistance !== undefined && selection.distance !== undefined && selection.distance > maxDistance) return false
    const payload = {
      entityId: primitive.entityId,
      primitiveId: primitive.id,
      instanceId: selection.instanceId,
      point: selection.point,
      normal: selection.normal,
      source: selection.source,
      data: primitive.data,
    }
    this.events.emit('entity:select', payload)
    if (interaction.event) {
      this.events.emit(interaction.event, {
        ...payload,
        params: interaction.params ?? {},
      })
    }
    if (interaction.action) {
      await this.runAction(interaction.action, interaction.params ?? {}, primitive.entityId ?? selection.source)
    }
    const entity = primitive.entityId ? this.compiled?.entityById.get(primitive.entityId) : undefined
    const declarative = entity?.events?.select
    if (declarative?.length) await this.executeActions(declarative, primitive.entityId ?? selection.source)
    return true
  }

  async attachRenderer(renderer: RendererAdapter): Promise<void> {
    await this.enqueue(async () => {
      this.assertNotDisposed()
      if (renderer === this.renderer) return
      const previousRenderer = this.renderer
      const snapshot = !isHeadlessRenderer(previousRenderer) && this.compiled
        ? this.captureRuntimeSnapshot()
        : null

      const wasRunning = this.running
      this.stop()
      if (this.xr.state !== 'idle') await this.xr.exit()
      this.disposeRuntimeServices(false)
      this.resizeObserver?.disconnect()
      this.resizeObserver = null
      this.unbindRendererEvents()
      this.renderer = renderer
      this.bindRendererEvents()
      this.xr.refresh()

      try {
        if (this.sourceDocument) await this.rebuild({ preserveRuntime: false })
        if (snapshot && !isHeadlessRenderer(renderer)) this.restoreRuntimeSnapshot(snapshot)
        if (!isHeadlessRenderer(renderer)) this.installResizeObserver()
        if (previousRenderer.disposeAsync) await previousRenderer.disposeAsync()
        else previousRenderer.dispose()
        if (wasRunning && this.sourceDocument) this.start()
      } catch (error) {
        try {
          if (renderer.disposeAsync) await renderer.disposeAsync()
          else renderer.dispose()
        } catch {}
        this.unbindRendererEvents()
        this.renderer = previousRenderer
        this.bindRendererEvents()
        this.xr.refresh()
        if (this.sourceDocument) {
          await this.rebuild({ preserveRuntime: false })
          if (snapshot && !isHeadlessRenderer(previousRenderer)) this.restoreRuntimeSnapshot(snapshot)
        }
        if (wasRunning && this.sourceDocument) this.start()
        throw error
      }
    })
  }

  getSourceDocument(): WorldDocument | null {
    return this.sourceDocument ? cloneWorldDocument(this.sourceDocument) : null
  }

  serialize(options: SerializeWorldOptions = {}): string {
    if (!this.sourceDocument) throw new Error('Cannot serialize before a world document has been loaded.')
    return serializeWorldDocument(this.sourceDocument, options)
  }

  serializeDocument(options: SerializeWorldOptions = {}): string { return this.serialize(options) }

  validate(): ValidationResult {
    if (!this.sourceDocument) throw new Error('Cannot validate before a world document has been loaded.')
    return inspectWorldDocument(this.sourceDocument, this.worldValidationOptions())
  }

  get isPreviewing(): boolean { return this.previewState !== null }
  get canUndo(): boolean { return this.history.canUndo }
  get canRedo(): boolean { return this.history.canRedo }

  getHistory(): { undo: HistoryEntrySummary[]; redo: HistoryEntrySummary[] } {
    return { undo: this.history.listUndo(), redo: this.history.listRedo() }
  }

  getEntityBounds(id: string): Bounds3 | null {
    const entity = this.compiled?.entityById.get(id) ?? this.compiled?.entityByAuthoringId.get(id)
    const bounds = entity?.bounds
    if (!bounds) return null
    const size: [number, number, number] = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ]
    return {
      min: [...bounds.min] as [number, number, number],
      max: [...bounds.max] as [number, number, number],
      size,
      center: [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ],
    }
  }

  async resetRuntimeTransform(entityId: string, source?: string): Promise<boolean> {
    this.assertReady()
    const changed = this.transforms.clear(entityId, source)
    if (!changed) return false
    await this.flushRuntimeTransforms()
    this.events.emit('runtime:transform-reset', { entityId, source })
    return true
  }

  async commitRuntimeTransform(
    entityId: string,
    options: { source?: string; label?: string } = {},
  ): Promise<boolean> {
    this.assertReady()
    const node = this.compiled?.entityById.get(entityId) ?? this.compiled?.entityByAuthoringId.get(entityId)
    if (!node) throw new Error(`Unknown runtime transform entity "${entityId}".`)
    if (!node.authoring.editable) {
      throw new Error(`ANYO_RUNTIME_TRANSFORM_TARGET_GENERATED
Entity: ${entityId}
Source: ${node.authoring.sourcePath}`)
    }
    const layers = this.transforms.getLayers(node.id)
    if (layers.length === 0) return false
    if (options.source && (layers.length !== 1 || layers[0]?.source !== options.source)) {
      throw new Error(`ANYO_RUNTIME_TRANSFORM_COMMIT_AMBIGUOUS
Entity: ${entityId}
A source-specific commit requires that source to be the entity's only active runtime transform layer.`)
    }

    const sourceEntity = getValueAtPointer(this.sourceDocument as WorldDocument, node.authoring.sourcePath) as EntityDefinition | undefined
    if (!sourceEntity || typeof sourceEntity !== 'object') throw new Error(`Cannot resolve editable entity "${entityId}".`)
    if (sourceEntity.surface) {
      throw new Error(`ANYO_RUNTIME_TRANSFORM_SURFACE_COMMIT_UNSUPPORTED
Entity: ${entityId}
Detach the surface attachment before committing a runtime world transform.`)
    }

    const finalTransform = this.transforms.getResolved(node.id)
    if (!finalTransform) return false
    let parentMatrix: ReturnType<typeof transformMatrix> | null = null
    if (node.parentId) {
      const parent = this.compiled?.entityById.get(node.parentId)
      const parentTransform = parent ? this.transforms.getResolved(parent.id) ?? parent.transform : null
      if (parentTransform) parentMatrix = transformMatrix(parentTransform)
    } else if (node.roomId && this.document) {
      for (const floor of this.document.building.floors) {
        const room = floor.rooms.find((candidate) => candidate.id === node.roomId)
        if (!room) continue
        parentMatrix = composeMatrix4([room.position[0], floor.elevation, room.position[1]], [0, 0, 0, 1], [1, 1, 1])
        break
      }
    }

    const local = parentMatrix
      ? decomposeMatrix4(relativeTransformMatrix(parentMatrix, transformMatrix(finalTransform)))
      : finalTransform
    const assetScale = normalizeScale(sourceEntity.asset ? this.document?.assets[sourceEntity.asset]?.scale : undefined)
    const sourceScale: [number, number, number] = [
      local.scale[0] / (assetScale[0] || 1),
      local.scale[1] / (assetScale[1] || 1),
      local.scale[2] / (assetScale[2] || 1),
    ]

    await this.transaction((document) => {
      const entity = getValueAtPointer(document, node.authoring.sourcePath) as EntityDefinition | undefined
      if (!entity || typeof entity !== 'object') throw new Error(`Cannot resolve editable entity "${entityId}".`)
      entity.position = [...local.position] as [number, number, number]
      entity.rotation = [...local.rotation] as [number, number, number]
      entity.scale = sourceScale
    }, options.label ?? `Commit runtime transform ${node.authoringId}`)
    this.transforms.clear(node.id)
    await this.flushRuntimeTransforms()
    this.events.emit('runtime:transform-commit', { entityId: node.id, label: options.label ?? `Commit runtime transform ${node.id}` })
    return true
  }

  beginPreview(label = 'Preview edit'): void {
    this.assertReady()
    if (this.previewState) throw new Error('An Anyo preview transaction is already active.')
    this.previewState = { label, before: cloneWorldDocument(this.sourceDocument as WorldDocument) }
    this.events.emit('preview:start', { label })
  }

  async previewTransaction(mutator: (document: WorldDocument) => void): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      if (!this.previewState) throw new Error('Call beginPreview() before applying preview changes.')
      const next = cloneWorldDocument(this.sourceDocument as WorldDocument)
      mutator(next)
      assertSafeObjectGraph(next, 'preview document')
      await this.commitDocument(next, this.previewState.label, 'entity', 'preview', false)
      this.events.emit('preview:update', { label: this.previewState.label })
    })
  }

  async previewEntityTransform(
    id: string,
    transform: Partial<Pick<EntityDefinition, 'position' | 'rotation' | 'scale'>>,
  ): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      const preview = this.previewState
      if (!preview) throw new Error('Call beginPreview() before applying preview changes.')
      const node = this.compiled?.entityById.get(id) ?? this.compiled?.entityByAuthoringId.get(id)
      if (node && !node.authoring.editable) {
        throw new Error(`ANYO_EDITOR_TARGET_GENERATED\nEntity: ${id}\nSource: ${node.authoring.sourcePath}`)
      }
      if (!node) throw new Error(`Unknown editable entity "${id}".`)

      const mutations: FastEntityMutation[] = []
      if (transform.position !== undefined) mutations.push({ property: 'position', operation: 'set', value: transform.position })
      if (transform.rotation !== undefined) mutations.push({ property: 'rotation', operation: 'set', value: transform.rotation })
      if (transform.scale !== undefined) mutations.push({ property: 'scale', operation: 'set', value: transform.scale })
      const fast = await this.tryFastEntityMutations(node, mutations, preview.label, 'entity', 'preview', false)
      if (!fast) {
        const next = cloneWorldDocument(this.sourceDocument as WorldDocument)
        const entity = getValueAtPointer(next, node.authoring.sourcePath) as EntityDefinition | undefined
        if (!entity) throw new Error(`Unknown editable entity "${id}".`)
        if (transform.position !== undefined) entity.position = structuredClone(transform.position)
        if (transform.rotation !== undefined) entity.rotation = structuredClone(transform.rotation)
        if (transform.scale !== undefined) entity.scale = structuredClone(transform.scale)
        assertSafeObjectGraph(next, 'preview document')
        await this.commitDocument(next, preview.label, 'entity', 'preview', false)
      }
      this.events.emit('preview:update', { label: preview.label })
    })
  }

  async commitPreview(label?: string): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertReady()
      const preview = this.previewState
      if (!preview) return false
      const current = cloneWorldDocument(this.sourceDocument as WorldDocument)
      const entry = this.history.push(label ?? preview.label, preview.before, current)
      this.previewState = null
      if (entry) {
        this.events.emit('history:push', { label: entry.label, timestamp: entry.timestamp, operationCount: entry.operationCount })
        this.emitDocumentChange(entry.label, 'entity', 'api')
      }
      this.events.emit('preview:commit', { label: label ?? preview.label, changed: Boolean(entry) })
      return Boolean(entry)
    })
  }

  async cancelPreview(): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertReady()
      const preview = this.previewState
      if (!preview) return false
      this.previewState = null
      try {
        await this.commitDocument(preview.before, `Cancel: ${preview.label}`, 'entity', 'preview', false)
      } catch (error) {
        this.previewState = preview
        throw error
      }
      this.events.emit('preview:cancel', { label: preview.label })
      return true
    })
  }

  async transaction(mutator: (document: WorldDocument) => void, label = 'Transaction'): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('transaction')
      const next = cloneWorldDocument(this.sourceDocument as WorldDocument)
      mutator(next)
      assertSafeObjectGraph(next, 'transaction document')
      await this.commitDocument(next, label, 'document', 'transaction', true)
    })
  }

  async replaceDocument(document: WorldDocument, label = 'Replace document'): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('replace the document')
      const migration = migrateWorldDocument(document)
      await this.commitDocument(migration.document, label, 'document', 'api', true)
    })
  }

  async updateEntity(id: string, patch: Partial<EntityDefinition>): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('update an entity')
      assertSafeObjectGraph(patch, `entity update ${id}`)
      const node = this.compiled?.entityById.get(id) ?? this.compiled?.entityByAuthoringId.get(id)
      const keys = Object.keys(patch)
      const fastKeys = new Set(['position', 'rotation', 'scale', 'visible'])
      if (node && keys.length > 0 && keys.every((key) => fastKeys.has(key))) {
        const mutations = keys.map((key) => ({
          property: key as FastEntityMutation['property'],
          operation: 'set' as const,
          value: (patch as unknown as Record<string, unknown>)[key],
        }))
        const fast = await this.tryFastEntityMutations(node, mutations, `Update entity ${id}`, 'entity', 'api', true)
        if (fast) {
          this.events.emit('entity:update', { id, patch: structuredClone(patch), entity: structuredClone(fast.entity) })
          return
        }
      }

      const next = cloneWorldDocument(this.sourceDocument as WorldDocument)
      const entity = findEntityInDocument(next, id)
      if (!entity) throw new Error(`Unknown entity "${id}".`)
      Object.assign(entity, structuredClone(patch))
      await this.commitDocument(next, `Update entity ${id}`, 'entity', 'api', true)
      this.events.emit('entity:update', { id, patch: structuredClone(patch), entity: structuredClone(entity) })
    })
  }

  async patch(patch: WorldPatch | WorldPatch[]): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('apply patches')
      const patches = Array.isArray(patch) ? patch : [patch]

      if (patches.length === 1 && this.compiled) {
        const operation = patches[0] as WorldPatch
        const parts = parseJsonPointer(operation.path)
        const property = parts.at(-1)
        if (property === 'position' || property === 'rotation' || property === 'scale' || property === 'visible') {
          const entityPath = formatJsonPointer(parts.slice(0, -1))
          const node = this.compiled.entities.find((candidate) => candidate.sourcePath === entityPath)
          const sourceEntity = this.sourceDocument ? getValueAtPointer(this.sourceDocument, entityPath) : undefined
          const propertyExists = Boolean(sourceEntity && typeof sourceEntity === 'object' && !Array.isArray(sourceEntity) && hasOwn(sourceEntity, property))
          const operationIsValid = operation.operation === 'add' || propertyExists
          if (node && operationIsValid) {
            const fast = await this.tryFastEntityMutations(node, [{
              property,
              operation: operation.operation === 'remove' ? 'remove' : 'set',
              value: operation.value,
            }], 'Apply JSON patches', 'structure', 'patch', true)
            if (fast) {
              this.events.emit('world:patch', structuredClone(patches))
              return
            }
          }
        }
      }

      const next = cloneWorldDocument(this.sourceDocument as WorldDocument)
      const inverse: WorldPatch[] = []
      for (const operation of patches) inverse.unshift(applyPatchValue(next, operation))
      await this.commitDocument(next, 'Apply JSON patches', 'structure', 'patch', true, { forward: patches, inverse })
      this.events.emit('world:patch', structuredClone(patches))
    })
  }

  async undo(): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('undo')
      const entry = this.history.undo()
      if (!entry) return false
      const next = cloneWorldDocument(this.sourceDocument as WorldDocument)
      try {
        for (const operation of entry.inverse) applyPatchValue(next, operation)
        await this.commitDocument(next, `Undo: ${entry.label}`, 'history', 'history', false)
        return true
      } catch (error) {
        this.history.redo()
        throw error
      }
    })
  }

  async redo(): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('redo')
      const entry = this.history.redo()
      if (!entry) return false
      const next = cloneWorldDocument(this.sourceDocument as WorldDocument)
      try {
        for (const operation of entry.forward) applyPatchValue(next, operation)
        await this.commitDocument(next, `Redo: ${entry.label}`, 'history', 'history', false)
        return true
      } catch (error) {
        this.history.undo()
        throw error
      }
    })
  }

  async setData(path: string, value: unknown): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('update runtime data')
      assertSafeObjectGraph(value, `runtime data at ${path}`)
      const previousRuntimeData = structuredClone(this.runtimeData)
      const previousPrepared = { document: this.document as NormalizedWorldDocument, compiled: this.compiled as CompiledWorld }
      setDataPath(this.runtimeData, path, structuredClone(value))
      try {
        const prepared = this.prepareWorld()
        await this.applyPreparedWorld(prepared)
      } catch (error) {
        this.runtimeData = previousRuntimeData
        try { await this.restorePreparedWorld(previousPrepared) }
        catch (restoreError) { this.warningHandler(`World rollback failed after data update error: ${String(restoreError)}`) }
        throw error
      }
      this.events.emit('data:update', { path, value: structuredClone(value), persisted: false })
    })
  }

  async commitRuntimeData(label = 'Commit runtime data'): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady()
      this.assertNoActivePreview('commit runtime data')
      const next = cloneWorldDocument(this.sourceDocument as WorldDocument)
      next.data = structuredClone(this.runtimeData)
      await this.commitDocument(next, label, 'data', 'api', true)
      this.events.emit('data:commit', { data: structuredClone(this.runtimeData) })
    })
  }

  getData(path?: string): unknown {
    const data = this.runtimeData
    return structuredClone(path ? getDataPath(data, path) : data)
  }

  setRoomVisibility(roomId: string, visible: boolean): void {
    const room = this.compiled?.roomById.get(roomId)
    if (!room) return
    room.visible = visible
    this.renderer.setRoomVisibility(roomId, visible)
  }

  getCurrentRoom(): string | null {
    return this.currentRoom
  }

  setCurrentRoom(roomId: string | null): void {
    if (this.currentRoom === roomId) return
    const previous = this.currentRoom
    this.currentRoom = roomId
    if (previous) this.events.emit('room:leave', { roomId: previous, nextRoomId: roomId })
    if (roomId) this.events.emit('room:enter', { roomId, previousRoomId: previous })
  }

  resize(): void {
    this.assertNotDisposed()
    if (isHeadlessRenderer(this.renderer)) return
    const rect = this.renderer.canvas.getBoundingClientRect()
    const ratio = this.configuredPixelRatio ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio)
    this.renderer.resize(rect.width, rect.height, ratio)
  }

  dispose(): void {
    if (!this.beginDispose()) return
    try {
      this.renderer.dispose()
    } catch (error) {
      this.warningHandler(`Renderer disposal failed: ${String(error)}`)
    }
    this.finishDispose()
  }

  async disposeAsync(): Promise<void> {
    if (this.disposed) return
    if (this.disposalPromise) return this.disposalPromise
    this.disposalPromise = (async () => {
      if (this.disposing) return
      this.disposing = true
      this.stop()
      try {
        await this.xr.exit()
      } catch (error) {
        this.warningHandler(`XR session shutdown failed: ${String(error)}`)
      }
      if (!this.beginDispose(true)) return
      try {
        if (this.renderer.disposeAsync) await this.renderer.disposeAsync()
        else this.renderer.dispose()
      } catch (error) {
        this.warningHandler(`Renderer async disposal failed: ${String(error)}`)
      }
      this.finishDispose()
    })()
    return this.disposalPromise
  }

  private beginDispose(alreadyDisposing = false): boolean {
    if (this.disposed) return false
    if (this.disposing && !alreadyDisposing) return false
    this.disposing = true
    this.stop()
    this.exploration.dispose()
    this.xr.dispose()
    this.disposeRuntimeServices(true)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.unbindRendererEvents()
    return true
  }

  private finishDispose(): void {
    this.events.clear()
    this.actions.clear()
    this.history.clear()
    this.sourceDocument = null
    this.sourceContext = undefined
    this.runtimeData = {}
    this.transforms.clearAll()
    this.transforms.updateWorld(null)
    this.query.update(null)
    this.document = null
    this.compiled = null
    this.runtimeContext = null
    this.currentRoom = null
    this.previewState = null
    this.disposed = true
    this.disposing = false
  }

  private async tryFastEntityMutations(
    node: CompiledEntityNode,
    mutations: readonly FastEntityMutation[],
    label: string,
    classification: ChangeClassification,
    source: DocumentChangeEvent['source'],
    recordHistory: boolean,
  ) {
    if (!this.sourceDocument || !this.document || !this.compiled) return null
    const result = prepareFastEntityMutation(this.sourceDocument, this.document, this.compiled, node, mutations)
    if (!result) return null

    const previousSource = this.sourceDocument
    const previousPrepared: PreparedWorld = { document: this.document, compiled: this.compiled }
    const prepared: PreparedWorld = { document: result.document, compiled: result.compiled }
    this.sourceDocument = result.sourceDocument

    try {
      if (result.changes.length === 0) this.acceptPreparedWorld(prepared)
      else {
        const applied = await this.applyIncrementalChanges(result.changes, prepared)
        if (!applied) {
          this.sourceDocument = previousSource
          return null
        }
      }
    } catch (error) {
      this.sourceDocument = previousSource
      try { await this.restorePreparedWorld(previousPrepared) }
      catch (restoreError) { this.warningHandler(`World rollback failed after fast entity update error: ${String(restoreError)}`) }
      throw error
    }

    if (recordHistory) {
      const entry = this.history.pushPatches(label, result.forward, result.inverse)
      if (entry) this.events.emit('history:push', { label: entry.label, timestamp: entry.timestamp, operationCount: entry.operationCount })
    }
    this.emitDocumentChange(label, classification, source)
    return result
  }

  private async commitDocument(
    next: WorldDocument,
    label: string,
    classification: ChangeClassification,
    source: DocumentChangeEvent['source'],
    recordHistory: boolean,
    historyPatches?: { forward: readonly WorldPatch[]; inverse: readonly WorldPatch[] },
  ): Promise<void> {
    const previous = cloneWorldDocument(this.sourceDocument as WorldDocument)
    const previousRuntimeData = structuredClone(this.runtimeData)
    const previousPrepared = { document: this.document as NormalizedWorldDocument, compiled: this.compiled as CompiledWorld }
    assertSafeObjectGraph(next, 'world document update')
    const migrated = migrateWorldDocument(next).document
    assertSafeObjectGraph(migrated, 'migrated world document')
    validateWorldDocument(migrated, this.worldValidationOptions())

    const persistedDataChanged = JSON.stringify(previous.data ?? {}) !== JSON.stringify(migrated.data ?? {})
    this.sourceDocument = migrated
    this.runtimeData = persistedDataChanged
      ? structuredClone(migrated.data ?? {})
      : previousRuntimeData

    try {
      const prepared = this.prepareWorld()
      await this.applyPreparedWorld(prepared)
    } catch (error) {
      this.sourceDocument = previous
      this.runtimeData = previousRuntimeData
      try {
        await this.restorePreparedWorld(previousPrepared)
      } catch (restoreError) {
        this.warningHandler(`World rollback failed after an update error: ${String(restoreError)}`)
      }
      throw error
    }

    if (recordHistory) {
      const entry = historyPatches
        ? this.history.pushPatches(label, historyPatches.forward, historyPatches.inverse)
        : this.history.push(label, previous, migrated)
      if (entry) this.events.emit('history:push', { label: entry.label, timestamp: entry.timestamp, operationCount: entry.operationCount })
    }
    this.emitDocumentChange(label, classification, source)
  }

  private emitDocumentChange(
    label: string,
    classification: ChangeClassification,
    source: DocumentChangeEvent['source'],
  ): void {
    if (!this.sourceDocument || !this.events.has('document:change')) return
    this.events.emit<DocumentChangeEvent>('document:change', {
      label,
      classification,
      source,
      document: cloneWorldDocument(this.sourceDocument),
    })
  }

  private createResolvedSource(): WorldDocument {
    const source = cloneWorldDocument(this.sourceDocument as WorldDocument)
    source.data = structuredClone(this.runtimeData)
    return source
  }

  private prepareWorld(): PreparedWorld {
    const started = typeof performance === 'undefined' ? Date.now() : performance.now()
    const document = normalizeWorldDocument(this.createResolvedSource(), { sourceContext: this.sourceContext })
    const output = createCompileAccumulator()
    output.materials.push(...Object.entries(document.materials).map(([id, definition]) => ({ id, definition: structuredClone(definition) })))
    output.channels = compileWorldChannels(document.channels)
    const cameras = compileCameras(document.cameras, document.activeCamera, output.channels)
    output.cameras.push(...cameras.cameras)
    output.activeCameraId = cameras.activeCameraId
    output.revision = document.revision
    for (const plugin of this.plugins) plugin.compile?.({ document, output, warn: this.warningHandler })
    const compiled = finalizeCompiledWorld(output)
    const graphStart = typeof performance === 'undefined' ? Date.now() : performance.now()
    this.dependencyGraph = buildCompilerDependencyGraph(document)
    const graphEnd = typeof performance === 'undefined' ? Date.now() : performance.now()
    const edges = [...this.dependencyGraph.materialConsumers.values(), ...this.dependencyGraph.assetConsumers.values(), ...this.dependencyGraph.prefabInstances.values(), ...this.dependencyGraph.cameraDependents.values(), ...this.dependencyGraph.variableBindings.values()].reduce((sum, set) => sum + set.size, 0)
    this.compilerReport = {
      fullCompileMs: graphEnd - started,
      dependencyGraphMs: graphEnd - graphStart,
      entityCount: compiled.entities.length,
      primitiveCount: compiled.primitives.length,
      dependencyEdges: edges,
      documentHash: hashWorldDocument(this.sourceDocument as WorldDocument),
      lastIncremental: false,
      lastChangeCount: 0,
      rebuildReasons: [],
    }
    return { document, compiled }
  }

  private async applyPreparedWorld(prepared: PreparedWorld): Promise<void> {
    if (!this.document || !this.compiled || !this.runtimeContext) {
      await this.rebuild({ preserveRuntime: false, prepared })
      return
    }

    const classification = classifyWorldChanges(this.compiled, prepared.compiled, this.document, prepared.document)
    if (this.compilerReport) {
      this.compilerReport.lastIncremental = classification.incremental
      this.compilerReport.lastChangeCount = classification.changes.length
      this.compilerReport.rebuildReasons = classification.reason ? [classification.reason] : classification.changes.filter((change): change is Extract<WorldChange, { type: 'world-rebuild' }> => change.type === 'world-rebuild').map((change) => change.reason)
    }
    if (!classification.incremental || classification.changes.some((change) => change.type === 'world-rebuild')) {
      await this.rebuild({ preserveRuntime: true, prepared })
      this.events.emit('world:changes', classification.changes)
      return
    }

    if (classification.changes.length === 0) {
      this.acceptPreparedWorld(prepared)
      await this.flushRuntimeTransforms()
      return
    }

    const applied = await this.applyIncrementalChanges(classification.changes, prepared)
    if (!applied) await this.rebuild({ preserveRuntime: true, prepared })
    this.events.emit('world:changes', classification.changes)
  }

  private async applyIncrementalChanges(changes: readonly WorldChange[], prepared: PreparedWorld): Promise<boolean> {
    if (this.renderer.applyChanges) {
      await this.renderer.applyChanges(changes, prepared.compiled, prepared.document)
      this.acceptPreparedWorld(prepared)
      await this.notifyPluginsOfChanges(changes)
      await this.flushRuntimeTransforms()
      return true
    }

    for (const change of changes) {
      switch (change.type) {
        case 'primitive-transform':
        case 'primitive-material':
        case 'primitive-content':
        case 'primitive-replace':
          if (!this.renderer.updatePrimitive) return false
          await this.renderer.updatePrimitive(change.primitive)
          break
        case 'primitive-visibility':
          if (this.renderer.setPrimitiveVisibility) this.renderer.setPrimitiveVisibility(change.primitiveId, change.visible)
          else if (this.renderer.updatePrimitive) await this.renderer.updatePrimitive(change.primitive)
          else return false
          break
        case 'primitive-remove':
          if (!this.renderer.removePrimitive) return false
          await this.renderer.removePrimitive(change.primitiveId)
          break
        case 'room-visibility':
          this.renderer.setRoomVisibility(change.roomId, change.visible)
          break
        case 'portal-state':
          this.renderer.setPortalState?.(change.portalId, change.open)
          break
        case 'collider-state':
          break
        case 'camera-update':
          if (!this.renderer.updateCamera) return false
          await this.renderer.updateCamera(change.camera)
          break
        case 'camera-remove':
          if (!this.renderer.removeCamera) return false
          await this.renderer.removeCamera(change.cameraId)
          break
        case 'camera-activate': {
          const camera = prepared.compiled.cameraById.get(change.cameraId)
          if (!camera || !this.renderer.activateCamera) return false
          await this.renderer.activateCamera(change.cameraId, camera, change.transition)
          break
        }
        case 'channels-update':
          if (!this.renderer.updateChannels) return false
          await this.renderer.updateChannels(change.channels)
          break
        case 'rendering-intent':
          return false
        case 'world-rebuild':
          return false
      }
    }

    this.acceptPreparedWorld(prepared)
    await this.notifyPluginsOfChanges(changes)
    await this.flushRuntimeTransforms()
    return true
  }

  private async notifyPluginsOfChanges(changes: readonly WorldChange[]): Promise<void> {
    if (!this.runtimeContext) return
    for (const plugin of this.plugins) await plugin.applyChanges?.(changes, this.runtimeContext)
    await this.systemScheduler.applyChanges(changes)
  }

  private acceptPreparedWorld(prepared: PreparedWorld): void {
    this.document = prepared.document
    this.compiled = prepared.compiled
    this.query.update(prepared.compiled)
    this.transforms.updateWorld(prepared.compiled)
    if (this.runtimeContext) {
      this.runtimeContext.document = prepared.document
      this.runtimeContext.compiled = prepared.compiled
      this.runtimeContext.renderer = this.renderer
      this.systemScheduler.updateContext(this.runtimeContext)
    }
  }

  private async restorePreparedWorld(prepared: PreparedWorld): Promise<void> {
    await this.rebuild({ preserveRuntime: true, prepared })
  }

  private async rebuild(options: { preserveRuntime?: boolean; prepared?: PreparedWorld; resetRuntimeTransforms?: boolean } = {}): Promise<void> {
    if (!this.sourceDocument) return
    const prepared = options.prepared ?? this.prepareWorld()
    const wasRunning = this.running
    const snapshot = options.preserveRuntime ? this.captureRuntimeSnapshot() : null
    this.stop()
    this.disposeRuntimeServices(false)
    if (options.resetRuntimeTransforms) this.transforms.clearAll()

    await this.renderer.initialize?.()
    if (!isHeadlessRenderer(this.renderer)) this.assertRendererCapabilities(prepared)
    await this.renderer.mount(prepared.compiled, prepared.document)
    this.document = prepared.document
    this.compiled = prepared.compiled
    this.query.update(prepared.compiled)
    this.transforms.updateWorld(prepared.compiled)
    const context: PluginRuntimeContext = {
      world: this,
      renderer: this.renderer,
      document: prepared.document,
      compiled: prepared.compiled,
      transforms: this.transforms,
      query: this.query,
    }
    this.runtimeContext = context

    try {
      if (!isHeadlessRenderer(this.renderer)) {
        for (const plugin of this.plugins) await plugin.setup?.(context)
      }
      await this.systemScheduler.setup(context)
      await this.flushRuntimeTransforms()
    } catch (error) {
      this.disposeRuntimeServices(false)
      throw error
    }

    if (!isHeadlessRenderer(this.renderer)) {
      if (snapshot) this.restoreRuntimeSnapshot(snapshot)
      else this.applyInitialSpawn()
      this.resize()
    }
    this.events.emit('world:load', { document: prepared.document, compiled: prepared.compiled })
    if (wasRunning) this.start()
  }

  private captureRuntimeSnapshot(): RuntimeSnapshot {
    return {
      cameraPosition: [...this.renderer.camera.getPosition()] as [number, number, number],
      cameraRotation: [...this.renderer.camera.getRotation()] as [number, number],
      currentRoom: this.currentRoom,
      roomVisibility: new Map(this.compiled?.rooms.map((room) => [room.roomId, room.visible]) ?? []),
    }
  }

  private restoreRuntimeSnapshot(snapshot: RuntimeSnapshot): void {
    this.renderer.camera.setPosition(snapshot.cameraPosition)
    this.renderer.camera.setRotation(snapshot.cameraRotation[0], snapshot.cameraRotation[1])
    const roomExists = snapshot.currentRoom ? this.compiled?.roomById.has(snapshot.currentRoom) : true
    for (const [roomId, visible] of snapshot.roomVisibility) {
      if (this.compiled?.roomById.has(roomId)) this.setRoomVisibility(roomId, visible)
    }
    if (roomExists) this.setCurrentRoom(snapshot.currentRoom)
    else this.applyInitialSpawn()
  }

  private worldValidationOptions(): WorldValidationOptions {
    return {
      ...this.validationOptions,
      actionRegistry: this.actions,
      rendererInfo: this.renderer.info ?? this.validationOptions.rendererInfo,
    }
  }

  private assertRendererCapabilities(prepared: PreparedWorld): void {
    const info = this.renderer.info
    if (!info) return
    for (const camera of prepared.compiled.cameras) {
      if (camera.type === 'perspective' && info.capabilities.perspectiveCameras === false) throw new Error(`Renderer "${info.name}" does not support perspective cameras requested by "${camera.id}".`)
      if (camera.type === 'orthographic' && info.capabilities.orthographicCameras === false) throw new Error(`Renderer "${info.name}" does not support orthographic cameras requested by "${camera.id}".`)
      if (camera.transition.duration > 0 && info.capabilities.cameraTransitions === false) this.warningHandler(`Renderer "${info.name}" will activate camera "${camera.id}" without its requested transition.`)
    }
    if ((prepared.document.channels.render || prepared.document.channels.picking || prepared.document.channels.editor) && info.capabilities.namedLayers === false) throw new Error(`Renderer "${info.name}" does not support named world channels.`)
    if (Object.keys(prepared.document.rendering).length && info.capabilities.renderingIntent === false) this.warningHandler(`Renderer "${info.name}" does not consume portable rendering intent.`)
    const missing = new Map<string, CompiledPrimitive>()
    for (const primitive of prepared.compiled.primitives) {
      const capability = primitive.kind === 'text'
        ? 'text'
        : primitive.kind === 'image'
          ? 'images'
          : primitive.kind === 'model'
            ? 'models'
            : null
      if (capability && !info.capabilities[capability]) missing.set(capability, primitive)
      if (primitive.kind === 'light') {
        const specific = primitive.lightType === 'ambient'
          ? 'ambientLights'
          : primitive.lightType === 'directional'
            ? 'directionalLights'
            : 'pointLights'
        const specificSupport = info.capabilities[specific]
        if (specificSupport === false || (specificSupport === undefined && !info.capabilities.lights)) missing.set(specific, primitive)
      }
      if (primitive.assetType && primitive.assetFormat && info.capabilities.assetFormats) {
        const supported = info.capabilities.assetFormats[primitive.assetType]
        if (!supported || !supported.includes(primitive.assetFormat.toLowerCase())) {
          missing.set(`asset:${primitive.assetType}/${primitive.assetFormat}`, primitive)
        }
      }
      if (primitive.material) {
        const material = prepared.document.materials[primitive.material]
        const channels = info.capabilities.materialTextureChannels
        const requiredChannels: Array<[string, keyof MaterialDefinition]> = [
          ['baseColor', 'baseColorTexture'],
          ['normal', 'normalTexture'],
          ['roughness', 'roughnessTexture'],
          ['metalness', 'metalnessTexture'],
          ['metallicRoughness', 'metallicRoughnessTexture'],
          ['emissive', 'emissiveTexture'],
          ['occlusion', 'occlusionTexture'],
        ]
        for (const [channel, field] of requiredChannels) {
          if (material?.[field] && (!channels || !channels.includes(channel as 'baseColor' | 'normal' | 'roughness' | 'metalness' | 'metallicRoughness' | 'emissive' | 'occlusion'))) {
            missing.set(`material-texture:${channel}`, primitive)
          }
        }
      }
      if (primitive.interaction && !info.capabilities.picking) missing.set('picking', primitive)
    }
    if (missing.size === 0) return
    const [capability, primitive] = missing.entries().next().value as [string, CompiledPrimitive]
    throw new Error([
      `Renderer "${info.name}" does not support required capability "${capability}".`,
      `Primitive: ${primitive.id}`,
      `Type: ${primitive.kind}`,
      primitive.sourcePath ? `Source: ${primitive.sourcePath}` : '',
    ].filter(Boolean).join('\n'))
  }

  private disposeRuntimeServices(final: boolean): void {
    const context = this.runtimeContext
    this.runtimeContext = null
    this.systemScheduler.dispose(final)
    if (!context) return
    for (const plugin of [...this.plugins].reverse()) {
      try {
        if (plugin.teardown) plugin.teardown(context)
        else plugin.dispose?.(context)
      } catch (error) {
        this.warningHandler(`Plugin "${plugin.name}" failed during ${final ? 'teardown' : 'world teardown'}: ${String(error)}`)
      }
    }
    if (!final) return
    for (const plugin of [...this.plugins].reverse()) {
      if (!plugin.teardown || !plugin.dispose) continue
      try {
        plugin.dispose(context)
      } catch (error) {
        this.warningHandler(`Plugin "${plugin.name}" failed during final disposal: ${String(error)}`)
      }
    }
  }

  private applyInitialSpawn(): void {
    if (this.compiled?.activeCameraId) return
    const spawn = this.document?.exploration?.spawn
    if (!spawn) return
    const roomId = spawn.room
    const room = roomId ? this.compiled?.roomById.get(roomId) : null
    const local = spawn.position ?? [0, this.document?.exploration?.eyeHeight ?? 1.65, 0]
    const position = room
      ? [
          (room.bounds.min[0] + room.bounds.max[0]) / 2 + local[0],
          room.bounds.min[1] + local[1],
          (room.bounds.min[2] + room.bounds.max[2]) / 2 + local[2],
        ] as const
      : local
    this.renderer.camera.setPosition(position)
    this.setCurrentRoom(roomId ?? null)
  }

  private registerBuiltInActions(): void {
    this.registerAction('emit', async (params) => {
      const event = typeof params.event === 'string' ? params.event : null
      if (!event) throw new Error('The built-in "emit" action requires params.event.')
      this.emit(event, params.payload)
    })
    this.registerAction('show-room', async (params) => {
      if (typeof params.room !== 'string') throw new Error('show-room requires params.room.')
      this.setRoomVisibility(params.room, true)
    })
    this.registerAction('hide-room', async (params) => {
      if (typeof params.room !== 'string') throw new Error('hide-room requires params.room.')
      this.setRoomVisibility(params.room, false)
    })
  }

  private bindRendererEvents(): void {
    this.unbindRendererEvents()
    if (this.renderer.onAssetProgress) {
      this.rendererEventCleanups.push(this.renderer.onAssetProgress((progress) => {
        this.events.emit('assets:progress', progress)
      }))
    }
    if (this.renderer.onDiagnostic) {
      this.rendererEventCleanups.push(this.renderer.onDiagnostic((diagnostic) => {
        this.events.emit('renderer:diagnostic', diagnostic)
      }))
    }
  }

  private unbindRendererEvents(): void {
    for (const cleanup of this.rendererEventCleanups.splice(0)) cleanup()
  }

  private installResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry || this.disposed) return
      const ratio = this.configuredPixelRatio ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio)
      this.renderer.resize(entry.contentRect.width, entry.contentRect.height, ratio)
    })
    if (!isHeadlessRenderer(this.renderer)) this.resizeObserver.observe(this.renderer.canvas)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private assertReady(): void {
    this.assertNotDisposed()
    if (!this.sourceDocument || !this.document || !this.compiled || !this.runtimeContext) {
      throw new Error('The Anyo world has not been loaded yet.')
    }
  }

  private assertNoActivePreview(operation: string): void {
    if (this.previewState) throw new Error(`Cannot ${operation} while preview "${this.previewState.label}" is active. Commit or cancel it first.`)
  }

  private assertNotDisposed(): void {
    if (this.disposed || this.disposing) throw new Error('This Anyo world is disposing or has already been disposed.')
  }
}
