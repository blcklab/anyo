import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Engine,
  Euler,
  ImageMesh,
  InstancedMesh,
  Matrix4,
  Mesh,
  Node,
  Camera,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  ParticleEmitter,
  PointLight,
  Scene,
  SphereGeometry,
  StandardMaterial,
  TextMesh,
  SEKAI64_VERSION,
  Vector3,
  createEngine,
  type EngineOptions,
  type Geometry,
  type Material,
  type ParticleQuality,
  type ResourceScope,
} from '@blcklab/sekai64'
import { AssetLoaderRegistry, type AssetLoaderRegistration } from '@blcklab/sekai64/assets'
import { BeveledBoxGeometry } from '@blcklab/sekai64/geometry/beveled-box'
import type { RendererModule } from '@blcklab/sekai64/modules'
import { GltfLoader } from '@blcklab/sekai64/gltf'
import { Raycaster } from '@blcklab/sekai64/interaction'
import { parseCubeLut } from '@blcklab/sekai64/renderer'
import { createProceduralSky } from '@blcklab/sekai64/environment-authoring'
import type { XRFrameState } from '@blcklab/sekai64/xr'
import type {
  CompiledPrimitive,
  CompiledEntityNode,
  CompiledWorld,
  CompiledCamera,
  CompiledWorldChannels,
  CameraTransitionDefinition,
  MaterialDefinition,
  NormalizedWorldDocument,
  PickResult,
  RendererAdapter,
  RendererCapabilities,
  RendererDiagnostic,
  RendererAssetProgress,
  RuntimeTransformUpdate,
  RendererInfo,
  CameraProjection,
  RayPickOptions,
  TransformDefinition,
  Vec3,
  WorldChange,
} from '../core/types.js'
import { Sekai64CameraAdapter } from './Sekai64CameraAdapter.js'
import { Sekai64FrameDriver } from './Sekai64FrameDriver.js'
import { Sekai64XRBridge } from './Sekai64XRBridge.js'
import { toSekaiTextOptions } from './textOptions.js'
import { normalizeEnvironmentDefinition } from '../core/visualContract.js'
import { createSekai64ResourceAdapterFromNativeAccess, type Sekai64ResourceAdapter } from './Sekai64ResourceAdapter.js'
import { createResourceAssetLoaderOptions } from './resourceAssetHooks.js'

const RENDER_MASK_LIMIT = 0x7fff
const PICKING_SHIFT = 16
const DEFAULT_RENDER_MASK = 1
const DEFAULT_PICKING_MASK = 1 << PICKING_SHIFT

function nativeLayerMask(primitive: CompiledPrimitive): number {
  const render = (primitive.renderMask ?? DEFAULT_RENDER_MASK) & RENDER_MASK_LIMIT
  const picking = primitive.interaction ? (((primitive.pickingMask ?? 1) & RENDER_MASK_LIMIT) << PICKING_SHIFT) : 0
  return render | picking
}

export interface Sekai64RendererOptions {
  canvas: HTMLCanvasElement
  backend?: 'auto' | 'webgpu' | 'webgl2'
  antialias?: boolean
  alpha?: boolean
  pixelRatio?: number
  maxPixelRatio?: number
  fieldOfView?: number
  near?: number
  far?: number
  development?: boolean
  maxPointLights?: number
  colorManagement?: EngineOptions['colorManagement']
  environmentLighting?: EngineOptions['environmentLighting']
  shadows?: EngineOptions['shadows']
  imageQuality?: EngineOptions['imageQuality']
  atmosphere?: EngineOptions['atmosphere']
  colorGrading?: EngineOptions['colorGrading']
  postProcessing?: EngineOptions['postProcessing']
  optimization?: EngineOptions['optimization']
  entityGeometry?: {
    /** Use a compact shared beveled cuboid for author-authored box entities. Building slabs and walls remain exact boxes. */
    beveledBoxes?: boolean
    /** Radius on the unit cuboid before the entity transform is applied. Defaults to 0.035. */
    bevelRadius?: number
    bevelSegments?: number
  }
  assetConcurrency?: number
  assetLoaders?: readonly AssetLoaderRegistration<Node>[]
  /** Optional Sekai64 renderer modules installed with the engine lifecycle. */
  modules?: readonly RendererModule[]
  /** Renderer-owned generic particle density policy; not part of Anyo JSON semantics. */
  particleQuality?: ParticleQuality
  engineFactory?: (options: EngineOptions) => Promise<Engine>
}

export interface Sekai64RendererMetrics {
  mountDurationMs: number
  incrementalUpdateDurationMs: number
  mountedPrimitives: number
  sharedGeometryCount: number
  instancedBatchCount: number
  pendingAssets: number
  drawCalls: number
  geometryMemory: number
  textureMemory: number
  backend?: string
}

/**
 * Additive native access for trusted optional integrations such as dynamic
 * texture presentation. This is intentionally exposed only by the concrete
 * Sekai64 adapter and is not part of Anyo's required RendererAdapter contract.
 */
export interface Sekai64ExternalNodeRegistration {
  primitiveId: string
  entityId?: string
  node: Node
  interactive?: boolean
}

export interface Sekai64RendererNativeAccess {
  readonly engine: Engine
  readonly scene: Scene
  readonly camera: Camera
  getPrimitiveNode(primitiveId: string): Node | undefined
  getRoomNode(roomId: string): Node | undefined
  /**
   * Registers a trusted renderer-native node with Anyo picking identity.
   * The node remains owned and disposed by the caller.
   */
  registerExternalNode(registration: Sekai64ExternalNodeRegistration): () => void
}

interface InstanceBinding {
  mesh: InstancedMesh
  index: number
  primitive: CompiledPrimitive
}

interface PendingAsset {
  primitiveId: string
  promise: Promise<void>
}

interface QueuedAsset {
  primitiveId: string
  generation: number
  run: () => Promise<void>
  resolve: () => void
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function inferAssetFormat(src: string): string | undefined {
  const lower = src.toLowerCase()
  if (lower.startsWith('data:model/gltf+json')) return 'gltf'
  if (lower.startsWith('data:model/vrm')) return 'vrm'
  if (lower.startsWith('data:model/gltf-binary') || lower.startsWith('data:application/octet-stream')) return 'glb'
  try {
    const pathname = new URL(src, 'https://sekai64.invalid').pathname
    const match = /\.([a-z0-9]+)$/i.exec(pathname)
    return match?.[1]?.toLowerCase()
  } catch {
    return undefined
  }
}

function defaultMaterial(primitive: CompiledPrimitive): MaterialDefinition {
  if (primitive.tags?.includes('floor')) return { color: '#d7d2c8', roughness: 0.78 }
  if (primitive.tags?.includes('ceiling')) return { color: '#fafafa', roughness: 0.95 }
  if (primitive.tags?.includes('wall')) return { color: '#f1f0ec', roughness: 0.9 }
  if (primitive.tags?.includes('window')) return { color: '#b9dce8', roughness: 0.15, opacity: 0.35, transparent: true, side: 'double' }
  if (primitive.tags?.includes('stair')) return { color: '#b9b2a6', roughness: 0.75 }
  return { color: primitive.color ?? '#a8a29e', roughness: 0.7 }
}

function materialKey(name: string | undefined, definition: MaterialDefinition): string {
  return JSON.stringify({
    name: name ?? null,
    baseColor: definition.baseColor ?? definition.color ?? null,
    baseColorTexture: definition.baseColorTexture ?? null,
    normalTexture: definition.normalTexture ?? null,
    normalScale: definition.normalScale ?? null,
    roughnessTexture: definition.roughnessTexture ?? null,
    metalnessTexture: definition.metalnessTexture ?? null,
    metallicRoughnessTexture: definition.metallicRoughnessTexture ?? null,
    emissiveTexture: definition.emissiveTexture ?? null,
    occlusionTexture: definition.occlusionTexture ?? null,
    occlusionStrength: definition.occlusionStrength ?? null,
    textureTransform: definition.textureTransform ?? null,
    textureWrap: definition.textureWrap ?? null,
    emissive: definition.emissive ?? null,
    emissiveIntensity: definition.emissiveIntensity ?? null,
    roughness: definition.roughness ?? null,
    metalness: definition.metalness ?? null,
    opacity: definition.opacity ?? 1,
    alphaMode: definition.alphaMode ?? null,
    alphaCutoff: definition.alphaCutoff ?? null,
    transparent: definition.transparent ?? false,
    wireframe: definition.wireframe ?? false,
    side: definition.side ?? 'front',
    doubleSided: definition.doubleSided ?? false,
    transmission: definition.transmission ?? null,
    ior: definition.ior ?? null,
    thickness: definition.thickness ?? null,
    attenuationColor: definition.attenuationColor ?? null,
    attenuationDistance: definition.attenuationDistance ?? null,
    shadingModel: definition.shadingModel ?? null,
    toon: definition.toon ?? null,
  })
}


function particleRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}
}

function particleNumber(value: unknown, fallback: number, minimum = -Infinity, maximum = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback
}

function particleInteger(value: unknown, fallback: number, minimum = -0xffffffff): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? Math.max(minimum, value) : fallback
}

function particleVec3(value: unknown, fallback: readonly [number, number, number]): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) return fallback
  return [value[0] as number, value[1] as number, value[2] as number]
}

function particleScalarRange(value: unknown, defaultMin: number, defaultMax: number): { min: number; max: number } {
  const record = particleRecord(value)
  const min = particleNumber(record.min, defaultMin)
  const max = particleNumber(record.max, defaultMax)
  return max >= min ? { min, max } : { min: max, max: min }
}

function particleVectorRange(value: unknown): { min: readonly [number, number, number]; max: readonly [number, number, number] } {
  const record = particleRecord(value)
  const min = particleVec3(record.min, [0, 0, 0])
  const max = particleVec3(record.max, min)
  return { min, max }
}

function particleLegacySizeRange(value: unknown): { min: number; max: number } {
  const record = particleRecord(value)
  const start = particleNumber(record.start, 0.1, 0)
  const end = particleNumber(record.end, start, 0)
  return { min: Math.min(start, end), max: Math.max(start, end) }
}

function particleOverLifeScalar(value: unknown, minimum = -Infinity, maximum = Infinity): { start: number; end: number } | undefined {
  const record = particleRecord(value)
  if (record.start === undefined && record.end === undefined) return undefined
  const start = particleNumber(record.start, particleNumber(record.end, 0), minimum, maximum)
  const end = particleNumber(record.end, start, minimum, maximum)
  return { start, end }
}

function particleOverLifeColor(value: unknown): { start: readonly [number, number, number]; end: readonly [number, number, number] } | undefined {
  const record = particleRecord(value)
  if (typeof record.start !== 'string' && typeof record.end !== 'string') return undefined
  try {
    const start = Color.from(typeof record.start === 'string' ? record.start : record.end as string)
    const end = Color.from(typeof record.end === 'string' ? record.end : record.start as string)
    return { start: [start.r, start.g, start.b], end: [end.r, end.g, end.b] }
  } catch { return undefined }
}

function particleSpawnShape(value: unknown):
  | { type: 'point' }
  | { type: 'box'; size: readonly [number, number, number] }
  | { type: 'sphere'; radius: number }
  | { type: 'surface'; size?: readonly [number, number, number] } {
  const record = particleRecord(value)
  if (record.type === 'box') return { type: 'box', size: particleVec3(record.size, [1, 1, 1]) }
  if (record.type === 'sphere') return { type: 'sphere', radius: particleNumber(record.radius, 0.5, 0.000001) }
  if (record.type === 'surface') return { type: 'surface' }
  return { type: 'point' }
}

function capabilitiesFromEngine(engine: Engine, assetLoaders: AssetLoaderRegistry): RendererCapabilities {
  const features = engine.capabilities.features
  const materialTextureChannels: NonNullable<RendererCapabilities['materialTextureChannels']>[number][] = []
  if (features.baseColorTextures) materialTextureChannels.push('baseColor')
  if (features.normalTextures) materialTextureChannels.push('normal')
  if (features.metallicRoughnessTextures) materialTextureChannels.push('roughness', 'metalness', 'metallicRoughness')
  if (features.emissiveTextures) materialTextureChannels.push('emissive')
  if (features.occlusionTextures) materialTextureChannels.push('occlusion')
  return {
    assetFormats: {
      model: assetLoaders.formats('model'),
      texture: ['png', 'jpg', 'jpeg', 'webp', 'avif'],
      image: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg'],
      audio: ['mp3', 'ogg', 'wav', 'm4a'],
    },
    materialTextureChannels,
    materialFeatures: ['normalScale', 'occlusionStrength', 'emissiveIntensity', 'transmission', 'ior', 'thickness', 'attenuation', 'textureTransform', 'textureWrap', 'materialDetail', 'toonShading', 'mtoonShading'],
    colorManagement: true,
    environmentLighting: true,
    atmosphere: true,
    colorGrading: true,
    environmentMaps: features.environmentMaps,
    perspectiveCameras: true,
    orthographicCameras: true,
    cameraTransitions: false,
    namedLayers: true,
    renderingIntent: true,
    text: features.text,
    images: features.images,
    models: features.models,
    lights: features.ambientLights || features.directionalLights || features.pointLights,
    ambientLights: features.ambientLights,
    directionalLights: features.directionalLights,
    pointLights: features.pointLights,
    picking: features.picking,
    trianglePicking: features.trianglePicking,
    instancedPicking: features.instancedPicking,
    roomVisibility: true,
    incrementalUpdates: true,
    runtimeTransforms: true,
    instancing: engine.capabilities.instancing,
    shadows: features.shadows,
    xr: features.xr,
    webSurfaces: true,
    webSurfaceSnapshots: features.images,
    webSurfaceDomOverlay: typeof document !== 'undefined',
    backend: engine.capabilities.backend,
  }
}

function srgbChannelToLinear(value: number): number {
  const x = Math.max(0, Math.min(1, value))
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function colorToTriplet(value: string): readonly [number, number, number] {
  const color = Color.from(value)
  return [color.r, color.g, color.b] as const
}

function colorToLinearTriplet(value: string): readonly [number, number, number] {
  const color = Color.from(value)
  return [srgbChannelToLinear(color.r), srgbChannelToLinear(color.g), srgbChannelToLinear(color.b)] as const
}

export class Sekai64Renderer implements RendererAdapter {
  readonly canvas: HTMLCanvasElement
  readonly camera: Sekai64CameraAdapter
  readonly frameDriver: Sekai64FrameDriver
  readonly xr: Sekai64XRBridge

  private engine: Engine | null = null
  private scene: Scene | null = null
  private readonly perspectiveCamera: PerspectiveCamera
  private readonly orthographicCamera: OrthographicCamera
  private activeCamera: Camera
  private orthographicVerticalSize = 20
  private viewportWidth = 1
  private viewportHeight = 1
  private readonly raycaster = new Raycaster()
  private scope: ResourceScope | null = null
  private gltfLoader: GltfLoader | null = null
  private readonly assetLoaders = new AssetLoaderRegistry()
  private unitBox: BoxGeometry | null = null
  private unitBeveledBox: BeveledBoxGeometry | null = null
  private unitPlane: PlaneGeometry | null = null
  private unitCylinder: CylinderGeometry | null = null
  private unitCone: CylinderGeometry | null = null
  private unitSphere: SphereGeometry | null = null
  private readonly nodes = new Map<string, Node>()
  private readonly roomGroups = new Map<string, Node>()
  private readonly materials = new Map<string, Material>()
  private readonly instanceBindings = new Map<string, InstanceBinding>()
  private readonly instanceIds = new Map<InstancedMesh, string[]>()
  private readonly interactivePrimitiveIds = new Set<string>()
  private readonly primitiveByNode = new WeakMap<Node, string>()
  private readonly externalEntityByPrimitiveId = new Map<string, string | undefined>()
  private readonly externalNodeByPrimitiveId = new Map<string, Node>()
  private readonly primitiveCache = new Map<string, CompiledPrimitive>()
  private readonly particleEmitters = new Map<string, ParticleEmitter>()
  private lastParticleFrameTime = 0
  private readonly diagnostics: RendererDiagnostic[] = []
  private readonly diagnosticListeners = new Set<(diagnostic: RendererDiagnostic) => void>()
  private readonly assetProgressListeners = new Set<(progress: RendererAssetProgress) => void>()
  private readonly pendingAssets = new Map<string, PendingAsset>()
  private readonly assetQueue: QueuedAsset[] = []
  private activeAssetLoads = 0
  private assetLoaded = 0
  private assetFailed = 0
  private assetTotal = 0
  private readonly assetControllers = new Map<string, AbortController>()
  private worldAbort: AbortController | null = null
  private mountGeneration = 0
  private resourceAdapter: Sekai64ResourceAdapter | null = null
  private document: NormalizedWorldDocument | null = null
  private compiled: CompiledWorld | null = null
  private readonly namedCameras = new Map<string, CompiledCamera>()
  private worldChannels: CompiledWorldChannels | null = null
  private disposed = false
  private disposal: Promise<void> | null = null
  private xrFrameState: XRFrameState | null = null
  private engineDiagnosticCleanup: (() => void) | null = null
  private capabilityState: RendererCapabilities = {
    text: false,
    images: false,
    models: false,
    lights: false,
    picking: false,
    roomVisibility: true,
    incrementalUpdates: true,
    instancing: false,
    shadows: false,
    xr: false,
  }
  private readonly metrics: Sekai64RendererMetrics = {
    mountDurationMs: 0,
    incrementalUpdateDurationMs: 0,
    mountedPrimitives: 0,
    sharedGeometryCount: 0,
    instancedBatchCount: 0,
    pendingAssets: 0,
    drawCalls: 0,
    geometryMemory: 0,
    textureMemory: 0,
  }

  constructor(private readonly options: Sekai64RendererOptions) {
    this.canvas = options.canvas
    this.perspectiveCamera = new PerspectiveCamera({
      id: 'anyo-camera-perspective',
      fieldOfView: options.fieldOfView ?? 70,
      near: options.near ?? 0.05,
      far: options.far ?? 500,
      autoAspect: true,
    })
    this.orthographicCamera = new OrthographicCamera({
      id: 'anyo-camera-orthographic',
      left: -10, right: 10, top: 10, bottom: -10,
      near: options.near ?? 0.05,
      far: Math.max(options.far ?? 500, 2_000),
    })
    this.activeCamera = this.perspectiveCamera
    this.camera = new Sekai64CameraAdapter(
      () => this.activeCamera,
      projection => this.setCameraProjection(projection),
      this.canvas,
    )
    this.frameDriver = new Sekai64FrameDriver()
    this.xr = new Sekai64XRBridge({
      ensureEngine: () => this.ensureEngine(),
      getScene: () => this.scene,
      setFrameState: state => { this.xrFrameState = state },
      frameDriver: this.frameDriver,
    })
    this.assetLoaders.register<Node>({
      type: 'model',
      formats: ['gltf', 'glb'],
      load: async (request) => {
        if (!this.gltfLoader) throw new Error('Sekai64 glTF loader is not initialized.')
        return this.gltfLoader.loadNode(request.src, {
          id: request.id,
          name: request.id,
          signal: request.signal,
          staticBatching: normalizeEnvironmentDefinition(this.document?.environment).optimization.staticBatching
            ? { minInstances: normalizeEnvironmentDefinition(this.document?.environment).optimization.staticBatchMinInstances }
            : false,
        })
      },
    })
    for (const loader of options.assetLoaders ?? []) this.assetLoaders.register(loader)
  }

  get info(): RendererInfo {
    return { name: 'sekai64', version: SEKAI64_VERSION, capabilities: { ...this.capabilityState } }
  }

  async initialize(): Promise<void> {
    await this.ensureEngine()
  }

  async mount(compiled: CompiledWorld, document: NormalizedWorldDocument): Promise<void> {
    this.assertAlive()
    const started = now()
    const engine = await this.ensureEngine()
    if (this.resourceAdapter) { await this.resourceAdapter.dispose(); this.resourceAdapter = null }
    this.clearMountedWorld()
    this.document = document
    this.compiled = compiled
    this.namedCameras.clear()
    for (const camera of compiled.cameras ?? []) this.namedCameras.set(camera.id, camera)
    this.worldChannels = compiled.channels ?? { render: {}, picking: {}, editor: {}, renderMaskByName: new Map(), pickingMaskByName: new Map(), editorMaskByName: new Map() }
    this.mountGeneration += 1
    const generation = this.mountGeneration
    this.worldAbort = new AbortController()
    this.scene = new Scene({ id: 'anyo-world', name: 'Anyo compiled world', autoDisposeResources: false })
    const scope = engine.resources.createScope('anyo-compiled-world') as ResourceScope
    this.scope = scope
    this.gltfLoader = new GltfLoader()
    this.unitBox = scope.track(new BoxGeometry({ width: 1, height: 1, depth: 1, label: 'anyo-unit-box' }))
    if (this.options.entityGeometry?.beveledBoxes) {
      this.unitBeveledBox = scope.track(new BeveledBoxGeometry({
        width: 1,
        height: 1,
        depth: 1,
        bevelRadius: this.options.entityGeometry.bevelRadius ?? 0.035,
        bevelSegments: this.options.entityGeometry.bevelSegments ?? 1,
        label: 'anyo-unit-beveled-box',
      }))
    }
    this.unitPlane = scope.track(new PlaneGeometry({ width: 1, height: 1, label: 'anyo-unit-plane' }))
    this.unitCylinder = scope.track(new CylinderGeometry({ radiusTop: 0.5, radiusBottom: 0.5, height: 1, label: 'anyo-unit-cylinder' }))
    this.unitCone = scope.track(new CylinderGeometry({ radiusTop: 0, radiusBottom: 0.5, height: 1, radialSegments: 20, label: 'anyo-unit-cone' }))
    this.unitSphere = scope.track(new SphereGeometry({ radius: 0.5, widthSegments: 16, heightSegments: 10, label: 'anyo-unit-sphere' }))
    this.metrics.sharedGeometryCount = this.unitBeveledBox ? 6 : 5
    this.applyVisualConfiguration(engine, document)
    engine.setClearColor(normalizeEnvironmentDefinition(document.environment).background)
    if (compiled.activeCameraId) {
      const camera = compiled.cameraById?.get(compiled.activeCameraId) ?? this.namedCameras.get(compiled.activeCameraId)
      if (camera) await this.activateCamera(compiled.activeCameraId, camera)
    }

    for (const room of compiled.rooms) {
      const group = new Node({ id: `anyo-room:${room.roomId}`, name: `Room:${room.roomId}`, visible: room.visible, layerMask: RENDER_MASK_LIMIT | (RENDER_MASK_LIMIT << PICKING_SHIFT) })
      this.roomGroups.set(room.roomId, group)
      this.scene.add(group)
    }

    this.installEnvironment(document)
    this.mountPrimitiveBatches(compiled.primitives, generation)
    this.mountParticleEmitters(compiled.entities ?? [])
    if (compiled.resourceGraph) {
      const native = this.getNativeAccess()
      if (!native) throw new Error('Sekai64 native access is unavailable for Anyo ResourceGraph realization.')
      this.resourceAdapter = createSekai64ResourceAdapterFromNativeAccess(native, createResourceAssetLoaderOptions(this.assetLoaders))
      await this.resourceAdapter.transition(compiled.resourceGraph)
    }
    this.metrics.mountDurationMs = now() - started
    this.metrics.mountedPrimitives = compiled.primitives.length
    this.metrics.pendingAssets = this.pendingAssets.size
  }

  async applyChanges(
    changes: readonly WorldChange[],
    compiled: CompiledWorld,
    document: NormalizedWorldDocument,
  ): Promise<void> {
    const started = now()
    this.assertAlive()
    this.document = document
    this.compiled = compiled

    const requiresBatchRebuild = changes.some((change) => {
      if (change.type === 'primitive-remove') return this.instanceBindings.has(change.primitiveId)
      if (change.type === 'primitive-material' || change.type === 'primitive-content' || change.type === 'primitive-replace') {
        return this.instanceBindings.has(change.primitive.id)
      }
      return false
    })
    if (requiresBatchRebuild) {
      await this.mount(compiled, document)
      return
    }

    for (const change of changes) {
      switch (change.type) {
        case 'primitive-transform':
          this.applyPrimitiveTransform(change.primitive)
          break
        case 'primitive-visibility':
          this.setPrimitiveVisibility(change.primitiveId, change.visible)
          break
        case 'primitive-material':
          await this.updatePrimitiveMaterial(change.primitive)
          break
        case 'primitive-content':
          await this.updatePrimitiveContent(change.primitive)
          break
        case 'primitive-replace':
          await this.replacePrimitive(change.primitive)
          break
        case 'primitive-remove':
          await this.removePrimitive(change.primitiveId)
          break
        case 'room-visibility':
          this.setRoomVisibility(change.roomId, change.visible)
          break
        case 'portal-state':
          this.setPortalState(change.portalId, change.open)
          break
        case 'collider-state':
          break
        case 'camera-update':
          await this.updateCamera(change.camera)
          break
        case 'camera-remove':
          await this.removeCamera(change.cameraId)
          break
        case 'camera-activate': {
          const camera = compiled.cameraById.get(change.cameraId)
          if (camera) await this.activateCamera(change.cameraId, camera, change.transition)
          break
        }
        case 'channels-update':
          await this.updateChannels(change.channels)
          break
        case 'resource-graph':
          if (!this.resourceAdapter && compiled.resourceGraph) {
            const native = this.getNativeAccess()
            if (!native) throw new Error('Sekai64 native access is unavailable for Anyo ResourceGraph realization.')
            this.resourceAdapter = createSekai64ResourceAdapterFromNativeAccess(native, createResourceAssetLoaderOptions(this.assetLoaders))
          }
          await this.resourceAdapter?.transition(compiled.resourceGraph ?? null)
          if (!compiled.resourceGraph && this.resourceAdapter) { await this.resourceAdapter.dispose(); this.resourceAdapter = null }
          break
        case 'rendering-intent':
          this.applyVisualConfiguration(this.engine as Engine, document)
          break
        case 'world-rebuild':
          await this.mount(compiled, document)
          break
      }
    }
    this.metrics.incrementalUpdateDurationMs = now() - started
    this.metrics.pendingAssets = this.pendingAssets.size
  }

  applyRuntimeTransforms(updates: readonly RuntimeTransformUpdate[]): void {
    this.assertAlive()
    for (const update of updates) {
      if (update.primitive) { this.applyPrimitiveTransform(update.primitive); continue }
      const node = this.externalNodeByPrimitiveId.get(update.resourceInstanceId ?? update.primitiveId)
      if (node) node.setTransform({ position: update.transform.position, rotation: update.transform.rotation, scale: update.transform.scale })
    }
  }

  async updatePrimitive(primitive: CompiledPrimitive): Promise<void> {
    this.assertAlive()
    const previous = this.primitiveCache.get(primitive.id)
    if (!previous || previous.kind !== primitive.kind || this.instanceBindings.has(primitive.id)) {
      await this.replacePrimitive(primitive)
      return
    }
    this.applyPrimitiveTransform(primitive)
    this.setPrimitiveVisibility(primitive.id, primitive.visible)
    if (previous.material !== primitive.material) await this.updatePrimitiveMaterial(primitive)
    if (previous.src !== primitive.src || previous.text !== primitive.text || previous.color !== primitive.color || previous.intensity !== primitive.intensity || JSON.stringify(previous.style) !== JSON.stringify(primitive.style)) {
      await this.updatePrimitiveContent(primitive)
    }
    this.primitiveCache.set(primitive.id, primitive)
  }

  private async replacePrimitive(primitive: CompiledPrimitive): Promise<void> {
    if (this.instanceBindings.has(primitive.id)) {
      if (this.compiled && this.document) await this.mount(this.compiled, this.document)
      return
    }
    await this.removePrimitive(primitive.id)
    this.primitiveCache.set(primitive.id, primitive)
    await this.addPrimitive(primitive, this.mountGeneration)
  }

  private async updatePrimitiveMaterial(primitive: CompiledPrimitive): Promise<void> {
    const node = this.nodes.get(primitive.id)
    if (!node) { await this.replacePrimitive(primitive); return }
    if (node instanceof Mesh && !(node instanceof TextMesh) && !(node instanceof ImageMesh)) {
      node.setMaterial(this.materialFor(primitive), { disposePrevious: false, ownsResource: false })
      this.primitiveCache.set(primitive.id, primitive)
      return
    }
    await this.replacePrimitive(primitive)
  }

  private async updatePrimitiveContent(primitive: CompiledPrimitive): Promise<void> {
    const node = this.nodes.get(primitive.id)
    if (node instanceof TextMesh && primitive.kind === 'text') {
      node.setText(primitive.text ?? '', toSekaiTextOptions(primitive))
      this.applyTransform(node, primitive)
      this.primitiveCache.set(primitive.id, primitive)
      return
    }
    if (node instanceof ImageMesh && primitive.kind === 'image') {
      if (primitive.src) {
        const controller = this.createAssetController(primitive.id)
        this.trackAsset(primitive.id, () => node.setSource(primitive.src as string, { signal: controller.signal }).then(() => undefined), this.mountGeneration)
      }
      this.applyTransform(node, primitive)
      this.primitiveCache.set(primitive.id, primitive)
      return
    }
    await this.replacePrimitive(primitive)
  }

  async removePrimitive(primitiveId: string): Promise<void> {
    this.assetControllers.get(primitiveId)?.abort()
    this.assetControllers.delete(primitiveId)
    const binding = this.instanceBindings.get(primitiveId)
    if (binding) {
      const hidden = this.instanceMatrix(binding.primitive, false)
      binding.mesh.setMatrixAt(binding.index, hidden)
      this.instanceBindings.delete(primitiveId)
      this.nodes.delete(primitiveId)
      this.primitiveCache.delete(primitiveId)
      this.interactivePrimitiveIds.delete(primitiveId)
      return
    }
    const node = this.nodes.get(primitiveId)
    if (!node) return
    node.removeFromParent()
    node.dispose()
    this.nodes.delete(primitiveId)
    this.primitiveCache.delete(primitiveId)
    this.interactivePrimitiveIds.delete(primitiveId)
    this.pendingAssets.delete(primitiveId)
  }

  setPrimitiveVisibility(primitiveId: string, visible: boolean): void {
    const binding = this.instanceBindings.get(primitiveId)
    if (binding) {
      binding.primitive = { ...binding.primitive, visible }
      binding.mesh.setMatrixAt(binding.index, this.instanceMatrix(binding.primitive, visible))
      this.primitiveCache.set(primitiveId, binding.primitive)
      return
    }
    this.nodes.get(primitiveId)?.setVisible(visible)
    const primitive = this.primitiveCache.get(primitiveId)
    if (primitive) this.primitiveCache.set(primitiveId, { ...primitive, visible })
  }

  setRoomVisibility(roomId: string, visible: boolean): void {
    this.roomGroups.get(roomId)?.setVisible(visible)
  }

  setPortalState(_portalId: string, _open: boolean): void {
    // Portal state remains authoritative in Anyo. Sekai64 only applies visual changes
    // when the associated compiled primitives change.
  }

  async updateCamera(camera: CompiledCamera): Promise<void> {
    this.namedCameras.set(camera.id, structuredClone(camera))
    if (this.compiled?.activeCameraId === camera.id) await this.activateCamera(camera.id, camera)
  }

  async removeCamera(cameraId: string): Promise<void> {
    this.namedCameras.delete(cameraId)
  }

  async activateCamera(cameraId: string, camera: CompiledCamera, _transition?: CameraTransitionDefinition): Promise<void> {
    this.namedCameras.set(cameraId, structuredClone(camera))
    this.setCameraProjection(camera.type === 'orthographic'
      ? { type: 'orthographic', verticalSize: camera.size ?? 20, near: camera.near, far: camera.far }
      : { type: 'perspective', fieldOfView: camera.fov ?? 55, near: camera.near, far: camera.far })
    this.activeCamera.position.set(camera.transform.position[0], camera.transform.position[1], camera.transform.position[2])
    this.activeCamera.rotation.set(camera.transform.rotation[0], camera.transform.rotation[1], camera.transform.rotation[2], 'XYZ')
    this.activeCamera.layerMask = camera.renderMask & RENDER_MASK_LIMIT
    if (this.compiled) this.compiled.activeCameraId = cameraId
  }

  async updateChannels(channels: CompiledWorldChannels): Promise<void> {
    this.worldChannels = channels
  }

  private setCameraProjection(projection: CameraProjection): void {
    const current = this.activeCamera
    const position = [current.position.x, current.position.y, current.position.z] as const
    const rotation = [current.rotation.x, current.rotation.y, current.rotation.z] as const
    if (projection.type === 'orthographic') {
      this.orthographicVerticalSize = Math.max(.1, projection.verticalSize)
      if (projection.near !== undefined) this.orthographicCamera.near = Math.max(.001, projection.near)
      if (projection.far !== undefined) this.orthographicCamera.far = Math.max(this.orthographicCamera.near + .001, projection.far)
      this.activeCamera = this.orthographicCamera
      this.updateOrthographicViewport()
    } else {
      if (projection.fieldOfView !== undefined) this.perspectiveCamera.fieldOfView = projection.fieldOfView
      if (projection.near !== undefined) this.perspectiveCamera.near = Math.max(.001, projection.near)
      if (projection.far !== undefined) this.perspectiveCamera.far = Math.max(this.perspectiveCamera.near + .001, projection.far)
      this.activeCamera = this.perspectiveCamera
      this.perspectiveCamera.updateViewport(this.viewportWidth, this.viewportHeight)
    }
    this.activeCamera.position.set(position[0], position[1], position[2])
    this.activeCamera.rotation.set(rotation[0], rotation[1], rotation[2], 'XYZ')
  }

  private updateOrthographicViewport(): void {
    const aspect = Math.max(.001, this.viewportWidth / Math.max(1, this.viewportHeight))
    const halfHeight = this.orthographicVerticalSize / 2
    const halfWidth = halfHeight * aspect
    this.orthographicCamera.left = -halfWidth
    this.orthographicCamera.right = halfWidth
    this.orthographicCamera.top = halfHeight
    this.orthographicCamera.bottom = -halfHeight
  }

  render(): void {
    this.assertAlive()
    if (!this.engine || !this.scene) return
    const frameTime = now()
    const particleDelta = this.lastParticleFrameTime > 0 ? Math.min(0.25, Math.max(0, (frameTime - this.lastParticleFrameTime) / 1000)) : 0
    this.lastParticleFrameTime = frameTime
    for (const emitter of this.particleEmitters.values()) emitter.update(particleDelta, this.activeCamera)
    if (this.xrFrameState && this.xr.state === 'active') this.xr.render(this.scene, this.xrFrameState)
    else this.engine.render(this.scene, this.activeCamera)
    this.metrics.drawCalls = this.engine.stats.drawCalls
    this.metrics.geometryMemory = this.engine.stats.geometryMemory
    this.metrics.textureMemory = this.engine.stats.textureMemory
    this.metrics.backend = this.engine.capabilities.backend
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    this.assertAlive()
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    this.perspectiveCamera.updateViewport(this.viewportWidth, this.viewportHeight)
    this.updateOrthographicViewport()
    if (!this.engine) return
    this.engine.resize(this.viewportWidth, this.viewportHeight, Math.max(0.25, pixelRatio))
  }

  pick(clientX: number, clientY: number): PickResult | null {
    this.assertAlive()
    if (!this.scene || !this.capabilityState.picking) return null
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const pointer: readonly [number, number] = [
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ]
    this.raycaster.setFromCamera(pointer, this.activeCamera)
    const hits = this.raycaster.intersectScene(this.scene, {
      precision: this.capabilityState.trianglePicking ? 'triangles' : 'bounds',
      firstHitOnly: false,
      layerMask: DEFAULT_PICKING_MASK,
    })

    for (const hit of hits) {
      const ids = hit.object instanceof InstancedMesh ? this.instanceIds.get(hit.object) : undefined
      const primitiveId = hit.instanceId !== undefined && ids ? ids[hit.instanceId] : this.findPrimitiveId(hit.object)
      if (!primitiveId || !this.interactivePrimitiveIds.has(primitiveId)) continue
      const primitive = this.primitiveCache.get(primitiveId)
      return {
        primitiveId,
        entityId: primitive?.entityId ?? this.externalEntityByPrimitiveId.get(primitiveId),
        instanceId: hit.instanceId,
        point: [hit.point.x, hit.point.y, hit.point.z],
        normal: [hit.normal.x, hit.normal.y, hit.normal.z],
        ...(hit.uv ? { uv: [hit.uv.x, hit.uv.y] as const } : {}),
        ...(hit.uv1 ? { uv1: [hit.uv1.x, hit.uv1.y] as const } : {}),
        ...(hit.triangleIndex !== undefined ? { triangleIndex: hit.triangleIndex } : {}),
        distance: hit.distance,
      }
    }
    return null
  }

  pickRay(origin: Vec3, direction: Vec3, options: RayPickOptions = {}): PickResult | null {
    this.assertAlive()
    if (!this.scene || !this.capabilityState.picking) return null
    this.raycaster.ray.set(new Vector3(...origin), new Vector3(...direction))
    const hits = this.raycaster.intersectScene(this.scene, {
      precision: options.precision ?? (this.capabilityState.trianglePicking ? 'triangles' : 'bounds'),
      firstHitOnly: false,
      layerMask: DEFAULT_PICKING_MASK,
      near: options.near,
      far: options.far,
    })
    for (const hit of hits) {
      const ids = hit.object instanceof InstancedMesh ? this.instanceIds.get(hit.object) : undefined
      const primitiveId = hit.instanceId !== undefined && ids ? ids[hit.instanceId] : this.findPrimitiveId(hit.object)
      if (!primitiveId || !this.interactivePrimitiveIds.has(primitiveId)) continue
      const primitive = this.primitiveCache.get(primitiveId)
      return {
        primitiveId,
        entityId: primitive?.entityId ?? this.externalEntityByPrimitiveId.get(primitiveId),
        instanceId: hit.instanceId,
        point: [hit.point.x, hit.point.y, hit.point.z],
        normal: [hit.normal.x, hit.normal.y, hit.normal.z],
        ...(hit.uv ? { uv: [hit.uv.x, hit.uv.y] as const } : {}),
        ...(hit.uv1 ? { uv1: [hit.uv1.x, hit.uv1.y] as const } : {}),
        ...(hit.triangleIndex !== undefined ? { triangleIndex: hit.triangleIndex } : {}),
        distance: hit.distance,
      }
    }
    return null
  }

  getDiagnostics(): readonly RendererDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }))
  }

  onDiagnostic(listener: (diagnostic: RendererDiagnostic) => void): () => void {
    this.diagnosticListeners.add(listener)
    return () => { this.diagnosticListeners.delete(listener) }
  }

  getAssetProgress(): RendererAssetProgress {
    const loading = this.activeAssetLoads
    const queued = Math.max(0, this.pendingAssets.size - loading)
    const total = this.assetTotal
    const completed = this.assetLoaded + this.assetFailed
    return {
      queued,
      loading,
      loaded: this.assetLoaded,
      failed: this.assetFailed,
      total,
      ratio: total > 0 ? Math.min(1, completed / total) : 1,
    }
  }

  onAssetProgress(listener: (progress: RendererAssetProgress) => void): () => void {
    this.assetProgressListeners.add(listener)
    listener(this.getAssetProgress())
    return () => { this.assetProgressListeners.delete(listener) }
  }

  /**
   * Returns a narrow view of the mounted native scene for trusted optional
   * renderer integrations. The view disappears when no world is mounted.
   */
  getNativeAccess(): Sekai64RendererNativeAccess | null {
    if (!this.engine || !this.scene || this.disposed) return null
    const engine = this.engine
    const scene = this.scene
    return Object.freeze({
      engine,
      scene,
      camera: this.activeCamera,
      getPrimitiveNode: (primitiveId: string) => this.nodes.get(primitiveId),
      getRoomNode: (roomId: string) => this.roomGroups.get(roomId),
      registerExternalNode: (registration: Sekai64ExternalNodeRegistration) => this.registerExternalNode(registration),
    })
  }

  private registerExternalNode(registration: Sekai64ExternalNodeRegistration): () => void {
    this.assertAlive()
    const { primitiveId, entityId, node, interactive = true } = registration
    if (!primitiveId.trim()) throw new Error('External Sekai64 nodes require a non-empty primitiveId.')
    const existing = this.externalNodeByPrimitiveId.get(primitiveId)
    if (existing && existing !== node) {
      throw new Error(`External Sekai64 primitive ${primitiveId} is already registered.`)
    }

    const previousLayerMask = node.layerMask
    this.externalNodeByPrimitiveId.set(primitiveId, node)
    this.externalEntityByPrimitiveId.set(primitiveId, entityId)
    this.primitiveByNode.set(node, primitiveId)
    if (interactive) {
      node.layerMask |= DEFAULT_PICKING_MASK
      this.interactivePrimitiveIds.add(primitiveId)
    }

    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.externalNodeByPrimitiveId.get(primitiveId) !== node) return
      this.externalNodeByPrimitiveId.delete(primitiveId)
      this.externalEntityByPrimitiveId.delete(primitiveId)
      this.primitiveByNode.delete(node)
      this.interactivePrimitiveIds.delete(primitiveId)
      if (!node.disposed) node.layerMask = previousLayerMask
    }
  }

  getMetrics(): Readonly<Sekai64RendererMetrics> {
    if (this.engine) {
      this.metrics.drawCalls = this.engine.stats.drawCalls
      this.metrics.geometryMemory = this.engine.stats.geometryMemory
      this.metrics.textureMemory = this.engine.stats.textureMemory
      this.metrics.backend = this.engine.capabilities.backend
    }
    this.metrics.pendingAssets = this.pendingAssets.size
    return { ...this.metrics }
  }

  async whenIdle(): Promise<void> {
    while (this.pendingAssets.size > 0) {
      await Promise.allSettled([...this.pendingAssets.values()].map((entry) => entry.promise))
    }
  }

  dispose(): void {
    if (this.disposed || this.disposal) return
    this.xr.dispose()
    const engine = this.finishDispose()
    engine?.dispose()
  }

  disposeAsync(): Promise<void> {
    if (this.disposal) return this.disposal
    if (this.disposed) return Promise.resolve()
    this.disposal = (async () => {
      await this.xr.disposeAsync()
      const engine = this.finishDispose()
      if (!engine) return
      const asyncEngine = engine as Engine & { disposeAsync?: () => Promise<void> }
      if (typeof asyncEngine.disposeAsync === 'function') await asyncEngine.disposeAsync()
      else engine.dispose()
    })()
    return this.disposal
  }

  private finishDispose(): Engine | null {
    if (this.disposed) return null
    this.frameDriver.dispose()
    this.xrFrameState = null
    this.clearMountedWorld()
    this.engineDiagnosticCleanup?.()
    this.engineDiagnosticCleanup = null
    const engine = this.engine
    this.engine = null
    this.assetLoaders.dispose()
    this.assetProgressListeners.clear()
    this.diagnosticListeners.clear()
    this.disposed = true
    return engine
  }

  private async ensureEngine(): Promise<Engine> {
    if (this.engine) return this.engine
    const factory = this.options.engineFactory ?? createEngine
    const backend = this.options.backend ?? 'auto'
    const engine = await factory({
      canvas: this.canvas,
      renderer: backend,
      antialias: this.options.antialias ?? true,
      alpha: this.options.alpha ?? false,
      pixelRatio: this.options.pixelRatio,
      maxPixelRatio: this.options.maxPixelRatio ?? 2,
      autoResize: false,
      development: this.options.development ?? false,
      maxPointLights: this.options.maxPointLights,
      colorManagement: this.options.colorManagement,
      environmentLighting: this.options.environmentLighting,
      shadows: this.options.shadows,
      imageQuality: this.options.imageQuality,
      atmosphere: this.options.atmosphere,
      colorGrading: this.options.colorGrading,
      modules: this.options.modules,
    })
    this.engine = engine
    this.capabilityState = capabilitiesFromEngine(engine, this.assetLoaders)
    this.engineDiagnosticCleanup = engine.on('diagnostic', (diagnostic: RendererDiagnostic) => {
      this.reportDiagnostic({ ...diagnostic })
    })
    return engine
  }

  private mountParticleEmitters(entities: readonly CompiledEntityNode[]): void {
    if (!this.scene || !this.unitPlane) return
    for (const entity of entities) {
      if (entity.enabled === false) continue
      for (const [componentIndex, component] of (entity.components ?? []).entries()) {
        if (!component.enabled || component.type !== 'anyo.vfx') continue
        const data = component.data as Readonly<Record<string, unknown>>
        if (data.effect !== 'sprite-particles') continue
        const id = `anyo-vfx:${entity.id}:${component.id ?? componentIndex}`
        const opacity = particleScalarRange(data.opacity, 1, 1)
        const color = typeof data.color === 'string' ? data.color : '#ffffff'
        const materialId = typeof data.material === 'string' ? data.material : undefined
        const primitive: CompiledPrimitive = {
          id,
          kind: 'plane',
          transform: entity.transform,
          material: materialId,
          roomId: entity.roomId,
          entityId: entity.id,
          color,
          visible: true,
          renderMask: entity.renderMask,
          pickingMask: entity.pickingMask,
          editorMask: entity.editorMask,
          tags: ['vfx', 'effect'],
        }
        const averageOpacity = (opacity.min + opacity.max) * 0.5
        const legacyTexture = typeof data.texture === 'string' && data.texture.trim() ? data.texture : undefined
        const material = this.materialFor(primitive, {
          baseColor: color,
          ...(legacyTexture ? { baseColorTexture: legacyTexture } : {}),
          opacity: averageOpacity,
          transparent: true,
          alphaMode: 'blend',
          side: 'double',
          roughness: 1,
          metalness: 0,
        }, legacyTexture ? { baseColorTexture: legacyTexture } : undefined)
        const emission = particleRecord(data.emission)
        const velocity = particleVectorRange(data.velocity)
        const size = particleLegacySizeRange(data.size)
        const overLife = particleRecord(data.overLife)
        const sizeOverLife = particleOverLifeScalar(overLife.size, 0)
        const opacityOverLife = particleOverLifeScalar(overLife.opacity, 0, 1)
        const rotationOverLife = particleOverLifeScalar(overLife.rotation)
        const colorOverLife = particleOverLifeColor(overLife.color)
        const emitter = new ParticleEmitter({
          id,
          name: id,
          tags: ['anyo-vfx', 'particle-emitter'],
          geometry: this.unitPlane,
          material,
          ownsResources: false,
          layerMask: (entity.renderMask ?? DEFAULT_RENDER_MASK) & RENDER_MASK_LIMIT,
          castShadow: false,
          receiveShadow: false,
          seed: particleInteger(data.seed, 0),
          maxParticles: particleInteger(data.maxParticles, 256, 1),
          emissionRate: particleNumber(emission.rate, 0, 0),
          burst: particleNumber(emission.burst, 0, 0),
          lifetime: particleScalarRange(data.lifetime, 1, 1),
          spawnShape: particleSpawnShape(data.spawnShape),
          velocity,
          acceleration: particleVec3(data.acceleration, [0, 0, 0]),
          gravity: particleVec3(data.gravity, [0, 0, 0]),
          drag: particleNumber(data.drag, 0, 0),
          size,
          opacity,
          rotation: particleScalarRange(data.rotation, 0, 0),
          ...(sizeOverLife ? { sizeOverLife } : {}),
          ...(opacityOverLife ? { opacityOverLife } : {}),
          ...(rotationOverLife ? { rotationOverLife } : {}),
          ...(colorOverLife ? { colorOverLife } : {}),
          importance: particleNumber(data.importance, 1, 0, 1),
          space: data.space === 'world' ? 'world' : 'local',
          quality: this.options.particleQuality ?? 'balanced',
          autoplay: data.autoplay !== false && data.playOnStart !== false,
          loop: data.loop !== false,
        })
        emitter.setTransform({
          position: entity.transform.position,
          rotation: entity.transform.rotation,
          scale: entity.transform.scale,
        })
        const parent = entity.roomId ? this.roomGroups.get(entity.roomId) : undefined
        ;(parent ?? this.scene).add(emitter)
        this.particleEmitters.set(id, emitter)
      }
    }
  }

  private mountPrimitiveBatches(primitives: readonly CompiledPrimitive[], generation: number): void {
    const batchGroups = new Map<string, CompiledPrimitive[]>()
    const singles: CompiledPrimitive[] = []
    for (const primitive of primitives) {
      this.primitiveCache.set(primitive.id, primitive)
      const canInstance = this.capabilityState.instancing
        && primitive.static === true
        && (primitive.kind === 'box' || primitive.kind === 'plane' || primitive.kind === 'cylinder' || primitive.kind === 'disc' || primitive.kind === 'cone' || primitive.kind === 'sphere')
        && Boolean(primitive.batchKey)
      if (!canInstance) {
        singles.push(primitive)
        continue
      }
      const key = `${primitive.roomId ?? 'world'}:${primitive.material ?? 'default'}:${primitive.batchKey}:${primitive.geometryKey ?? primitive.kind}:cast-${primitive.castShadow !== false}:receive-${primitive.receiveShadow !== false}`
      const group = batchGroups.get(key) ?? []
      group.push(primitive)
      batchGroups.set(key, group)
    }

    for (const group of batchGroups.values()) {
      if (group.length < 2) singles.push(...group)
      else this.addInstancedBatch(group)
    }
    for (const primitive of singles) void this.addPrimitive(primitive, generation)
  }

  private addInstancedBatch(primitives: readonly CompiledPrimitive[]): void {
    const first = primitives[0]
    if (!first) return
    const geometry = this.geometryFor(first)
    const material = this.materialFor(first)
    const mesh = new InstancedMesh({
      id: `anyo-batch:${first.batchKey}:${this.metrics.instancedBatchCount}`,
      geometry,
      material,
      count: primitives.length,
      ownsResources: false,
      visible: true,
      layerMask: primitives.reduce((mask, primitive) => mask | nativeLayerMask(primitive), 0),
      castShadow: first.castShadow !== false,
      receiveShadow: first.receiveShadow !== false,
    })
    const ids: string[] = []
    primitives.forEach((primitive, index) => {
      mesh.setMatrixAt(index, this.instanceMatrix(primitive, primitive.visible))
      this.nodes.set(primitive.id, mesh)
      this.instanceBindings.set(primitive.id, { mesh, index, primitive })
      if (primitive.interaction) this.interactivePrimitiveIds.add(primitive.id)
      ids[index] = primitive.id
    })
    this.instanceIds.set(mesh, ids)
    this.parentFor(first).add(mesh)
    this.metrics.instancedBatchCount += 1
  }

  private async addPrimitive(primitive: CompiledPrimitive, generation: number): Promise<void> {
    if (!this.scene || generation !== this.mountGeneration) return
    if (primitive.kind === 'model') {
      this.addModel(primitive, generation)
      return
    }
    const node = this.createNode(primitive)
    if (!node) return
    this.applyNodeMetadata(node, primitive)
    this.parentFor(primitive).add(node)
    this.nodes.set(primitive.id, node)
    this.primitiveByNode.set(node, primitive.id)
    if (primitive.interaction) this.interactivePrimitiveIds.add(primitive.id)
    if (primitive.kind === 'image' && node instanceof ImageMesh && primitive.src) {
      const controller = this.createAssetController(primitive.id)
      this.trackAsset(primitive.id, () => node.setSource(primitive.src as string, { signal: controller.signal }).then(() => undefined), generation)
    }
  }

  private createNode(primitive: CompiledPrimitive): Node | null {
    const size = primitive.size ?? [1, 1, 1]
    let node: Node
    switch (primitive.kind) {
      case 'box':
      case 'plane':
      case 'cylinder':
      case 'disc':
      case 'cone':
      case 'sphere':
        node = new Mesh({
          id: primitive.id,
          geometry: this.geometryFor(primitive),
          material: this.materialFor(primitive),
          ownsResources: false,
          castShadow: primitive.castShadow !== false,
          receiveShadow: primitive.receiveShadow !== false,
        })
        break
      case 'text':
        node = new TextMesh(primitive.text ?? '', { id: primitive.id, ...toSekaiTextOptions(primitive) })
        break
      case 'image':
        node = new ImageMesh(primitive.src ?? '', {
          id: primitive.id,
          autoload: false,
          worldWidth: size[0],
          worldHeight: size[1],
          transparent: true,
          label: primitive.id,
        })
        break
      case 'light':
        node = this.createLight(primitive)
        break
      case 'audio':
        node = new Node({ id: primitive.id })
        break
      case 'model':
        return null
    }
    this.applyTransform(node, primitive)
    return node
  }

  private addModel(primitive: CompiledPrimitive, generation: number): void {
    const placeholder = new Node({ id: `${primitive.id}:loading`, name: primitive.id, visible: primitive.visible })
    this.applyTransform(placeholder, primitive)
    this.applyNodeMetadata(placeholder, primitive)
    this.parentFor(primitive).add(placeholder)
    this.nodes.set(primitive.id, placeholder)
    this.primitiveByNode.set(placeholder, primitive.id)
    if (!primitive.src) return
    const format = (primitive.assetFormat ?? inferAssetFormat(primitive.src) ?? 'gltf').toLowerCase()
    const loader = this.assetLoaders.resolve(primitive.assetType ?? 'model', format)
    if (!loader) {
      this.reportDiagnostic({
        severity: 'error',
        code: 'ANYO_SEKAI64_ASSET_FORMAT_UNSUPPORTED',
        message: `No Sekai64 loader is registered for ${(primitive.assetType ?? 'model')}/${format}.`,
        details: { primitiveId: primitive.id, assetId: primitive.assetId, format },
      })
      return
    }
    const controller = this.createAssetController(primitive.id)
    this.trackAsset(primitive.id, () => loader.load({
      type: primitive.assetType ?? 'model',
      format,
      src: primitive.src as string,
      id: primitive.id,
      signal: controller.signal,
      options: primitive.assetId ? this.document?.assets[primitive.assetId]?.options : undefined,
    }).then((loaded) => {
      const model = loaded as Node
      if (!model || typeof model !== 'object' || typeof model.dispose !== 'function') {
        throw new Error(`Loader for model/${format} did not return a Sekai64 Node-compatible object.`)
      }
      if (generation !== this.mountGeneration || this.worldAbort?.signal.aborted || !this.nodes.has(primitive.id)) {
        model.dispose()
        return
      }
      placeholder.removeFromParent()
      placeholder.dispose()
      this.applyTransform(model, primitive)
      this.applyNodeMetadata(model, primitive)
      this.parentFor(primitive).add(model)
      this.nodes.set(primitive.id, model)
      this.primitiveByNode.set(model, primitive.id)
      if (primitive.interaction) this.interactivePrimitiveIds.add(primitive.id)
    }), generation)
  }

  private createAssetController(primitiveId: string): AbortController {
    this.assetControllers.get(primitiveId)?.abort()
    const controller = new AbortController()
    if (this.worldAbort?.signal.aborted) controller.abort()
    else this.worldAbort?.signal.addEventListener('abort', () => controller.abort(), { once: true })
    this.assetControllers.set(primitiveId, controller)
    return controller
  }

  private trackAsset(primitiveId: string, run: () => Promise<void>, generation: number): void {
    let resolveQueued: () => void = () => undefined
    const promise = new Promise<void>((resolve) => { resolveQueued = resolve })
    this.assetQueue.push({ primitiveId, generation, run, resolve: resolveQueued })
    this.pendingAssets.set(primitiveId, { primitiveId, promise })
    this.assetTotal += 1
    this.metrics.pendingAssets = this.pendingAssets.size
    this.emitAssetProgress()
    this.drainAssetQueue()
  }

  private drainAssetQueue(): void {
    const concurrency = Math.max(1, Math.floor(this.options.assetConcurrency ?? 6))
    while (this.activeAssetLoads < concurrency && this.assetQueue.length > 0) {
      const queued = this.assetQueue.shift()
      if (!queued) break
      const current = this.pendingAssets.get(queued.primitiveId)
      if (!current || queued.generation !== this.mountGeneration || this.worldAbort?.signal.aborted) {
        queued.resolve()
        continue
      }
      this.activeAssetLoads += 1
      this.emitAssetProgress()
      let failed = false
      Promise.resolve()
        .then(queued.run)
        .catch((error: unknown) => {
          failed = true
          if (queued.generation !== this.mountGeneration || this.worldAbort?.signal.aborted) return
          this.reportDiagnostic({
            severity: 'warning',
            code: 'ANYO_SEKAI64_ASSET_LOAD_FAILED',
            message: `Failed to load asset for primitive "${queued.primitiveId}".`,
            details: { primitiveId: queued.primitiveId, error: error instanceof Error ? error.message : String(error) },
          })
        })
        .finally(() => {
          this.activeAssetLoads -= 1
          const latest = this.pendingAssets.get(queued.primitiveId)
          if (latest === current) {
            this.pendingAssets.delete(queued.primitiveId)
            this.assetControllers.delete(queued.primitiveId)
            if (queued.generation === this.mountGeneration && !this.worldAbort?.signal.aborted) {
              if (failed) this.assetFailed += 1
              else this.assetLoaded += 1
            }
          }
          this.metrics.pendingAssets = this.pendingAssets.size
          queued.resolve()
          this.emitAssetProgress()
          this.drainAssetQueue()
        })
    }
  }

  private geometryFor(primitive: CompiledPrimitive): Geometry {
    if (primitive.kind === 'box' && primitive.tags?.includes('entity') && this.unitBeveledBox) return this.unitBeveledBox
    if (primitive.kind === 'box' && this.unitBox) return this.unitBox
    if (primitive.kind === 'plane' && this.unitPlane) return this.unitPlane
    if ((primitive.kind === 'cylinder' || primitive.kind === 'disc') && this.unitCylinder) return this.unitCylinder
    if (primitive.kind === 'cone' && this.unitCone) return this.unitCone
    if (primitive.kind === 'sphere' && this.unitSphere) return this.unitSphere
    throw new Error(`No shared Sekai64 geometry is available for primitive "${primitive.id}" (${primitive.kind}).`)
  }

  private materialFor(primitive: CompiledPrimitive, overrides: Partial<MaterialDefinition> = {}, directTextureSources?: Readonly<{ baseColorTexture?: string }>): Material {
    const definition = { ...defaultMaterial(primitive), ...(primitive.material ? this.document?.materials[primitive.material] : undefined), ...overrides }
    const visualStyle = normalizeEnvironmentDefinition(this.document?.environment).visualStyle
    const inferredRole = definition.role ?? (
      primitive.tags?.some(tag => tag === 'avatar' || tag === 'character' || tag === 'vrm') ? 'character' :
      primitive.tags?.some(tag => tag === 'foliage' || tag === 'vegetation') ? 'foliage' :
      primitive.tags?.some(tag => tag === 'vfx' || tag === 'effect') ? 'effects' :
      visualStyle.defaultMaterialRole
    )
    const isWindow = primitive.tags?.includes('window') === true
    const hybridRpg = visualStyle.profile === 'anime-rpg'
    const usesGlobalToon = !hybridRpg && visualStyle.profile !== 'standard' && definition.shadingModel !== 'pbr' && !isWindow
    const hybridShading = inferredRole === 'character' ? 'mtoon' : inferredRole === 'effects' ? 'toon' : 'pbr'
    const shadingModel = definition.shadingModel ?? (hybridRpg ? hybridShading : usesGlobalToon ? 'toon' : 'pbr')
    const toon = shadingModel === 'toon' ? { ...visualStyle, ...definition.toon } : definition.toon
    const effectiveDefinition = { ...definition, role: inferredRole, shadingModel, toon }
    const key = materialKey(primitive.material, effectiveDefinition)
    const existing = this.materials.get(key)
    if (existing) return existing
    if (!this.scope) throw new Error('Sekai64 material scope is not initialized.')
    const color = Color.from(effectiveDefinition.baseColor ?? effectiveDefinition.color ?? '#d4d4d4')
    color.a = effectiveDefinition.opacity ?? 1
    const emissive = Color.from(effectiveDefinition.emissive ?? '#000000')
    const baseColorTexture = directTextureSources?.baseColorTexture ?? this.materialTextureSource(effectiveDefinition.baseColorTexture)
    const metallicRoughnessTexture = this.materialTextureSource(effectiveDefinition.metallicRoughnessTexture)
    const metallicTexture = this.materialTextureSource(effectiveDefinition.metalnessTexture)
    const roughnessTexture = this.materialTextureSource(effectiveDefinition.roughnessTexture)
    const normalTexture = this.materialTextureSource(effectiveDefinition.normalTexture)
    const emissiveTexture = this.materialTextureSource(effectiveDefinition.emissiveTexture)
    const occlusionTexture = this.materialTextureSource(effectiveDefinition.occlusionTexture)
    const lightMapTexture = this.materialTextureSource(effectiveDefinition.lightMapTexture)
    const detailNormalTexture = this.materialTextureSource(effectiveDefinition.detail?.normalTexture)
    const detailRoughnessTexture = this.materialTextureSource(effectiveDefinition.detail?.roughnessTexture)
    const detailHeightTexture = this.materialTextureSource(effectiveDefinition.detail?.heightTexture)
    const alphaMode = effectiveDefinition.alphaMode ?? (effectiveDefinition.transparent || color.a < 1 ? 'blend' : 'opaque')
    const material = this.scope.track(new StandardMaterial({
      label: primitive.material ?? key,
      baseColor: color,
      baseColorTexture,
      metallicRoughnessTexture,
      metallicTexture,
      roughnessTexture,
      normalTexture,
      emissiveTexture,
      occlusionTexture,
      lightMapTexture,
      lightMapTexCoord: effectiveDefinition.lightMapTexCoord,
      lightMapIntensity: effectiveDefinition.lightMapIntensity,
      specularFactor: effectiveDefinition.specularFactor,
      specularColor: effectiveDefinition.specularColor,
      clearcoat: effectiveDefinition.clearcoat,
      clearcoatRoughness: effectiveDefinition.clearcoatRoughness,
      sheenColor: effectiveDefinition.sheenColor,
      sheenIntensity: effectiveDefinition.sheenIntensity,
      sheenRoughness: effectiveDefinition.sheenRoughness,
      metallic: effectiveDefinition.metalness ?? 0,
      roughness: effectiveDefinition.roughness ?? 0.8,
      normalScale: effectiveDefinition.normalScale ?? 1,
      occlusionStrength: effectiveDefinition.occlusionStrength ?? 1,
      detail: effectiveDefinition.detail ? { ...effectiveDefinition.detail, normalTexture: detailNormalTexture, roughnessTexture: detailRoughnessTexture, heightTexture: detailHeightTexture } : undefined,
      textureTransform: effectiveDefinition.textureTransform,
      textureWrap: effectiveDefinition.textureWrap,
      transmission: effectiveDefinition.transmission ?? (primitive.tags?.includes('window') ? 0.72 : 0),
      ior: effectiveDefinition.ior ?? 1.5,
      thickness: effectiveDefinition.thickness ?? (primitive.tags?.includes('window') ? 0.02 : 0),
      attenuationColor: effectiveDefinition.attenuationColor ?? effectiveDefinition.baseColor ?? effectiveDefinition.color ?? '#ffffff',
      attenuationDistance: effectiveDefinition.attenuationDistance ?? 1,
      emissive,
      emissiveIntensity: effectiveDefinition.emissiveIntensity ?? (effectiveDefinition.emissive ? 1 : 0),
      alphaMode,
      alphaCutoff: effectiveDefinition.alphaCutoff,
      alphaDither: effectiveDefinition.alphaDither,
      transparent: alphaMode === 'blend',
      side: effectiveDefinition.doubleSided ? 'double' : effectiveDefinition.side ?? 'front',
      wireframe: effectiveDefinition.wireframe ?? false,
      ownsTextures: Boolean(baseColorTexture || metallicRoughnessTexture || metallicTexture || roughnessTexture || normalTexture || emissiveTexture || occlusionTexture || lightMapTexture || detailNormalTexture || detailRoughnessTexture || detailHeightTexture),
      autoloadTextures: false,
      shadingModel,
      mtoon: shadingModel === 'mtoon' ? {
        shadeColor: effectiveDefinition.mtoon?.shadeColor ?? effectiveDefinition.toon?.shadowColor ?? visualStyle.shadowColor,
        shadingShift: effectiveDefinition.mtoon?.shadingShift ?? -0.05,
        shadingToony: effectiveDefinition.mtoon?.shadingToony ?? 0.88,
        giEqualization: effectiveDefinition.mtoon?.giEqualization ?? 0.9,
        parametricRimColor: effectiveDefinition.mtoon?.parametricRimColor ?? effectiveDefinition.toon?.rimColor ?? visualStyle.rimColor,
        rimFresnelPower: effectiveDefinition.mtoon?.parametricRimFresnelPower ?? effectiveDefinition.toon?.rimPower ?? visualStyle.rimPower,
        rimLift: effectiveDefinition.mtoon?.parametricRimLift ?? 0,
        rimLightingMix: effectiveDefinition.mtoon?.rimLightingMix ?? 0.45,
        outlineWidth: effectiveDefinition.mtoon?.outlineWidth ?? 0.8,
        outlineColor: effectiveDefinition.mtoon?.outlineColor ?? effectiveDefinition.toon?.outlineColor ?? visualStyle.outlineColor,
        outlineLightingMix: effectiveDefinition.mtoon?.outlineLightingMix ?? 0.25,
        faceShadowTexture: this.materialTextureSource(effectiveDefinition.mtoon?.faceShadowTexture),
        faceShadowTexCoord: effectiveDefinition.mtoon?.faceShadowTexCoord ?? 0,
        faceShadowStrength: effectiveDefinition.mtoon?.faceShadowStrength ?? 0.75,
        faceShadowFlipX: effectiveDefinition.mtoon?.faceShadowFlipX ?? false,
        hairDepthWrite: effectiveDefinition.mtoon?.hairDepthWrite ?? alphaMode === 'blend',
        hairAlphaDither: effectiveDefinition.mtoon?.hairAlphaDither ?? alphaMode === 'blend',
        transparentSortBias: effectiveDefinition.mtoon?.transparentSortBias ?? 0,
        environmentMix: effectiveDefinition.mtoon?.environmentMix,
        faceShadowSoftness: effectiveDefinition.mtoon?.faceShadowSoftness,
      } : undefined,
      toon: toon ? {
        shadeSteps: toon.shadeSteps,
        shadowColor: toon.shadowColor,
        shadowStrength: toon.shadowStrength,
        highlightColor: toon.highlightColor,
        highlightStrength: toon.highlightStrength,
        rimColor: toon.rimColor,
        rimStrength: toon.rimStrength,
        rimPower: toon.rimPower,
        outlineColor: toon.outlineColor,
        outlineStrength: toon.outlineStrength,
        outlinePower: toon.outlinePower,
        bandSmoothness: toon.bandSmoothness,
        shadowOffset: toon.shadowOffset,
        environmentMix: toon.environmentMix,
      } : undefined,
      water: shadingModel === 'water' ? effectiveDefinition.water : undefined,
    }))
    this.materials.set(key, material)
    if (baseColorTexture || metallicRoughnessTexture || metallicTexture || roughnessTexture || normalTexture || emissiveTexture || occlusionTexture || lightMapTexture || detailNormalTexture || detailRoughnessTexture || detailHeightTexture) {
      const assetKey = `material:${key}`
      const controller = this.createAssetController(assetKey)
      this.trackAsset(assetKey, () => material.loadTextures({ signal: controller.signal }).then(() => undefined), this.mountGeneration)
    }
    return material
  }


  private queueEnvironmentMap(
    renderer: { setEnvironmentMap?: (environment: { width: number; height: number; pixels: Uint8Array | Uint8ClampedArray; intensity?: number; rotation?: number; label?: string } | undefined) => void },
    assetId: string,
    intensity: number,
    rotation: number,
  ): void {
    const source = this.materialTextureSource(assetId)
    if (!source) {
      this.reportDiagnostic({ severity: 'warning', code: 'ANYO_SEKAI64_ENVIRONMENT_MAP_ASSET_MISSING', message: `Environment map asset "${assetId}" is missing or has no source.`, details: { assetId } })
      return
    }
    const generation = this.mountGeneration
    const key = `environment:${assetId}`
    const controller = this.createAssetController(key)
    this.trackAsset(key, async () => {
      if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') throw new Error('This runtime cannot decode browser environment images.')
      const response = await fetch(source, { signal: controller.signal })
      if (!response.ok) throw new Error(`Environment image request failed with ${response.status}.`)
      const bitmap = await createImageBitmap(await response.blob())
      try {
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bitmap.width, bitmap.height) : document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height
        const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
        if (!context) throw new Error('A 2D canvas context is required to decode the environment map.')
        context.drawImage(bitmap, 0, 0)
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
        if (generation === this.mountGeneration && !controller.signal.aborted) renderer.setEnvironmentMap?.({ width: bitmap.width, height: bitmap.height, pixels, intensity, rotation, label: assetId })
      } finally { bitmap.close() }
    }, generation)
  }

  private queueColorLut(
    renderer: { setColorGrading?: (grading: Record<string, unknown>) => void },
    assetId: string,
    intensity: number,
  ): void {
    const source = this.materialTextureSource(assetId)
    if (!source) {
      this.reportDiagnostic({ severity: 'warning', code: 'ANYO_SEKAI64_COLOR_LUT_ASSET_MISSING', message: `Color LUT asset "${assetId}" is missing or has no source.`, details: { assetId } })
      return
    }
    const generation = this.mountGeneration
    const key = `color-lut:${assetId}`
    const controller = this.createAssetController(key)
    this.trackAsset(key, async () => {
      if (typeof fetch !== 'function') throw new Error('This runtime cannot fetch color LUT assets.')
      const response = await fetch(source, { signal: controller.signal })
      if (!response.ok) throw new Error(`Color LUT request failed with ${response.status}.`)
      const parsed = parseCubeLut(await response.text(), assetId)
      if (generation === this.mountGeneration && !controller.signal.aborted) renderer.setColorGrading?.({ enabled: true, lut: parsed.lut, lutIntensity: intensity })
    }, generation)
  }

  private materialTextureSource(assetId: string | undefined): string | undefined {
    if (!assetId) return undefined
    const asset = this.document?.assets[assetId]
    return typeof asset?.src === 'string' ? asset.src : undefined
  }

  private createLight(primitive: CompiledPrimitive): Node {
    const options = { id: primitive.id, color: primitive.color ?? '#ffffff', intensity: primitive.intensity ?? 1 }
    if (primitive.lightType === 'ambient') return new AmbientLight(options)
    if (primitive.lightType === 'directional') {
      const light = new DirectionalLight(options)
      light.castShadow = Boolean(primitive.castShadow && this.capabilityState.shadows)
      return light
    }
    const light = new PointLight({ ...options, range: primitive.range ?? 10, decay: primitive.decay ?? 2 })
    if (primitive.castShadow) {
      this.reportDiagnostic({
        severity: 'warning',
        code: 'ANYO_SEKAI64_POINT_SHADOW_UNSUPPORTED',
        message: `Point-light shadows are not available for primitive "${primitive.id}"; the light remains active without shadows.`,
        details: { primitiveId: primitive.id },
      })
    }
    return light
  }

  private applyVisualConfiguration(engine: Engine, document: NormalizedWorldDocument): void {
    const environment = normalizeEnvironmentDefinition(document.environment)
    const renderer = engine.renderer as Engine['renderer'] & {
      setColorManagement?: Engine['renderer']['setColorManagement']
      setEnvironmentLighting?: Engine['renderer']['setEnvironmentLighting']
      setShadowOptions?: Engine['renderer']['setShadowOptions']
      setImageQuality?: Engine['renderer']['setImageQuality']
      setAtmosphere?: Engine['renderer']['setAtmosphere']
      setColorGrading?: Engine['renderer']['setColorGrading']
      setPostProcessing?: Engine['renderer']['setPostProcessing']
      setOptimization?: Engine['renderer']['setOptimization']
      setEnvironmentMap?: Engine['renderer']['setEnvironmentMap']
    }
    renderer.setColorManagement?.({
      ...environment.colorManagement,
      ...this.options.colorManagement,
    })
    renderer.setEnvironmentLighting?.({
      enabled: environment.lighting.enabled,
      skyColor: colorToLinearTriplet(environment.lighting.skyColor),
      groundColor: colorToLinearTriplet(environment.lighting.groundColor),
      intensity: environment.lighting.diffuseIntensity,
      specularIntensity: environment.lighting.specularIntensity,
      rotation: environment.lighting.environmentRotation,
      ...this.options.environmentLighting,
    })
    renderer.setShadowOptions?.({
      ...environment.shadows,
      ...environment.sun.shadow,
      ...this.options.shadows,
    })
    renderer.setImageQuality?.({
      ...environment.imageQuality,
      ...this.options.imageQuality,
    })
    renderer.setAtmosphere?.({
      ...environment.atmosphere,
      color: colorToTriplet(environment.atmosphere.color),
      ...this.options.atmosphere,
    })
    const { lut: colorLutAsset, lutIntensity, ...colorGrading } = environment.postProcessing.colorGrading
    renderer.setColorGrading?.({
      ...colorGrading,
      ...this.options.colorGrading,
    })
    renderer.setPostProcessing?.({
      enabled: environment.postProcessing.enabled,
      ssao: environment.postProcessing.ssao,
      bloom: environment.postProcessing.bloom,
      outlines: {
        ...environment.postProcessing.outlines,
        color: colorToTriplet(environment.postProcessing.outlines.color),
      },
      ...this.options.postProcessing,
    })
    renderer.setOptimization?.({
      ...environment.optimization,
      ...this.options.optimization,
    })
    if (environment.lighting.environmentMap) {
      if (!this.capabilityState.environmentMaps || !renderer.setEnvironmentMap) {
        this.reportDiagnostic({
          severity: 'warning',
          code: 'ANYO_SEKAI64_ENVIRONMENT_MAP_UNSUPPORTED',
          message: `Environment map "${environment.lighting.environmentMap}" was requested, but the active Sekai64 backend does not support environment maps. Hemisphere lighting is used instead.`,
          details: { assetId: environment.lighting.environmentMap, backend: this.capabilityState.backend },
        })
      } else {
        this.queueEnvironmentMap(renderer, environment.lighting.environmentMap, environment.lighting.diffuseIntensity, environment.lighting.environmentRotation)
      }
    } else if (environment.sky?.enabled && renderer.setEnvironmentMap) {
      const stars = environment.sky.stars
      const starDensity = stars && stars.enabled !== false ? stars.density ?? 0.35 : 0
      const sky = createProceduralSky({
        id: 'anyo-procedural-sky', width: environment.sky.width, height: environment.sky.height,
        zenithColor: environment.sky.zenithColor ? colorToLinearTriplet(environment.sky.zenithColor) : undefined,
        horizonColor: environment.sky.horizonColor ? colorToLinearTriplet(environment.sky.horizonColor) : undefined,
        groundColor: environment.sky.groundColor ? colorToLinearTriplet(environment.sky.groundColor) : undefined,
        sunColor: environment.sky.sunColor ? colorToLinearTriplet(environment.sky.sunColor) : undefined,
        sunDirection: environment.sky.sunDirection,
        sunAngularRadius: environment.sky.sunSize,
        sunIntensity: environment.sky.sunIntensity,
        haze: environment.sky.haze,
        cloudCoverage: environment.sky.cloudCoverage,
        cloudDensity: environment.sky.cloudDensity,
        cloudSeed: environment.sky.seed,
        starDensity,
        starIntensity: stars?.intensity,
        starBrightnessVariation: stars?.brightnessVariation,
        starSizeVariation: stars?.sizeVariation,
        starColorTemperatureVariation: stars?.colorTemperatureVariation,
        starSeed: stars?.seed ?? environment.sky.seed,
        intensity: environment.lighting.diffuseIntensity,
      })
      renderer.setEnvironmentMap({ width: sky.width, height: sky.height, pixels: sky.toLdr(), intensity: environment.lighting.specularIntensity, rotation: environment.lighting.environmentRotation, background: starDensity > 0, backgroundIntensity: 1, label: sky.label })
      sky.dispose()
    } else renderer.setEnvironmentMap?.(undefined)
    if (colorLutAsset && !this.options.colorGrading?.lut) this.queueColorLut(renderer as { setColorGrading?: (grading: Record<string, unknown>) => void }, colorLutAsset, lutIntensity)
    if (environment.sun.castShadow && !this.capabilityState.shadows) {
      this.reportDiagnostic({
        severity: 'warning',
        code: 'ANYO_SEKAI64_SHADOWS_UNSUPPORTED',
        message: 'The world requests sun shadows, but the active Sekai64 backend does not expose shadow support.',
        details: { backend: this.capabilityState.backend },
      })
    }
  }

  private installEnvironment(document: NormalizedWorldDocument): void {
    if (!this.scene) return
    const environment = normalizeEnvironmentDefinition(document.environment)
    const ambient = environment.ambientLight
    const ambientLight = new AmbientLight({
      id: 'anyo-environment-ambient',
      color: ambient.color,
      intensity: ambient.intensity,
      layerMask: RENDER_MASK_LIMIT,
    })
    this.scene.add(ambientLight)
    const sun = environment.sun
    const directional = new DirectionalLight({
      id: 'anyo-environment-sun',
      color: sun.color,
      intensity: sun.intensity,
      layerMask: RENDER_MASK_LIMIT,
    })
    directional.setTransform({ position: sun.position })
    const sunLengthSquared = sun.position[0] ** 2 + sun.position[1] ** 2 + sun.position[2] ** 2
    if (Number.isFinite(sunLengthSquared) && sunLengthSquared > 1e-12) {
      // Anyo's renderer-neutral sun.position describes the apparent sun location.
      // Sekai64 DirectionalLight instead consumes the direction that light rays travel,
      // so point those rays from the authored sun position toward the world origin.
      directional.direction.set(-sun.position[0], -sun.position[1], -sun.position[2]).normalize()
    } else {
      directional.direction.set(0, -1, 0)
    }
    directional.castShadow = Boolean(sun.castShadow && sun.shadow.enabled && this.capabilityState.shadows)
    this.scene.add(directional)
  }

  private applyNodeMetadata(node: Node, primitive: CompiledPrimitive): void {
    node.name = primitive.id
    node.layerMask = nativeLayerMask(primitive)
    node.setVisible(primitive.visible)
    this.primitiveByNode.set(node, primitive.id)
  }

  private applyPrimitiveTransform(primitive: CompiledPrimitive): void {
    const binding = this.instanceBindings.get(primitive.id)
    if (binding) {
      binding.primitive = primitive
      binding.mesh.setMatrixAt(binding.index, this.instanceMatrix(primitive, primitive.visible))
    } else {
      const node = this.nodes.get(primitive.id)
      if (node) this.applyTransform(node, primitive)
    }
    this.primitiveCache.set(primitive.id, primitive)
  }

  private applyTransform(node: Node, primitive: CompiledPrimitive): void {
    const scale = this.effectiveScale(primitive)
    node.setTransform({
      position: primitive.transform.position,
      rotation: primitive.transform.rotation,
      scale,
    })
  }

  private effectiveScale(primitive: CompiledPrimitive): Vec3 {
    const base = primitive.transform.scale
    const size = primitive.size ?? [1, 1, 1]
    if (primitive.kind === 'box' || primitive.kind === 'plane' || primitive.kind === 'cylinder' || primitive.kind === 'disc' || primitive.kind === 'cone' || primitive.kind === 'sphere') {
      return [base[0] * size[0], base[1] * size[1], base[2] * size[2]]
    }
    return [base[0], base[1], base[2]]
  }

  private instanceMatrix(primitive: CompiledPrimitive, visible: boolean): Matrix4 {
    const scale = visible ? this.effectiveScale(primitive) : [0, 0, 0] as Vec3
    return new Matrix4().compose(
      new Vector3(...primitive.transform.position),
      new Euler(...primitive.transform.rotation),
      new Vector3(...scale),
    )
  }

  private parentFor(primitive: CompiledPrimitive): Node {
    if (!this.scene) throw new Error('Sekai64 scene is not mounted.')
    return primitive.roomId ? this.roomGroups.get(primitive.roomId) ?? this.scene : this.scene
  }

  private findPrimitiveId(node: Node): string | undefined {
    let current: Node | null = node
    while (current) {
      const primitiveId = this.primitiveByNode.get(current)
      if (primitiveId) return primitiveId
      current = current.parent
    }
    return undefined
  }

  private clearMountedWorld(): void {
    this.resourceAdapter = null
    this.mountGeneration += 1
    this.worldAbort?.abort()
    this.worldAbort = null
    for (const controller of this.assetControllers.values()) controller.abort()
    this.assetControllers.clear()
    this.pendingAssets.clear()
    for (const queued of this.assetQueue.splice(0)) queued.resolve()
    if (this.scene) {
      for (const child of [...this.scene.children]) {
        child.removeFromParent()
        child.dispose()
      }
      this.scene.dispose()
      this.scene = null
    }
    this.gltfLoader?.dispose()
    this.gltfLoader = null
    this.scope?.dispose()
    this.scope = null
    this.unitBox = null
    this.unitBeveledBox = null
    this.unitPlane = null
    this.unitCylinder = null
    this.unitCone = null
    this.unitSphere = null
    this.nodes.clear()
    this.roomGroups.clear()
    this.materials.clear()
    this.instanceBindings.clear()
    this.instanceIds.clear()
    this.interactivePrimitiveIds.clear()
    this.externalEntityByPrimitiveId.clear()
    this.externalNodeByPrimitiveId.clear()
    this.primitiveCache.clear()
    this.particleEmitters.clear()
    this.lastParticleFrameTime = 0
    this.document = null
    this.compiled = null
    this.metrics.instancedBatchCount = 0
    this.metrics.mountedPrimitives = 0
    this.metrics.pendingAssets = 0
    this.assetLoaded = 0
    this.assetFailed = 0
    this.assetTotal = 0
    this.emitAssetProgress()
  }

  private emitAssetProgress(): void {
    const progress = this.getAssetProgress()
    for (const listener of [...this.assetProgressListeners]) listener(progress)
  }

  private reportDiagnostic(diagnostic: RendererDiagnostic): void {
    this.diagnostics.push(diagnostic)
    if (this.diagnostics.length > 200) this.diagnostics.splice(0, this.diagnostics.length - 200)
    for (const listener of [...this.diagnosticListeners]) listener({ ...diagnostic })
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('This Sekai64Renderer has already been disposed.')
  }
}
