import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Engine,
  ImageMesh,
  InstancedMesh,
  Mesh,
  Node,
  PointLight,
  OrthographicCamera,
  PerspectiveCamera,
  StandardMaterial,
  TextMesh,
} from '@blcklab/sekai64'
import { createRendererFeatures } from '@blcklab/sekai64/renderer'
import { Sekai64Renderer } from '../dist/esm/renderer-sekai64/index.js'

class Fake2DContext {
  font = ''
  fillStyle = ''
  textBaseline = ''
  textAlign = ''
  measureText(text) { return { width: Math.max(1, String(text).length * 12) } }
  scale() {}
  clearRect() {}
  fillRect() {}
  fillText() {}
}
class FakeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; this.context = new Fake2DContext() }
  getContext(type) { return type === '2d' ? this.context : null }
}
globalThis.OffscreenCanvas ??= FakeOffscreenCanvas
globalThis.createImageBitmap ??= async () => ({ width: 2, height: 2, close() {} })

function canvas() {
  return {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  }
}

class FakeGpuRenderer {
  width = 1
  height = 1
  pixelRatio = 1
  disposed = false
  stats = { drawCalls: 0, triangles: 0, visibleObjects: 0, culledObjects: 0, pipelineChanges: 0, geometryMemory: 0, textureMemory: 0 }
  constructor(backend = 'webgpu', overrides = {}) {
    this.backend = backend
    this.capabilities = {
      backend,
      maxTextureSize: 8192,
      maxPointLights: 8,
      computeShaders: backend === 'webgpu',
      timestampQueries: false,
      instancing: true,
      offscreenCanvas: true,
      features: createRendererFeatures({
        text: true, images: true, models: true,
        ambientLights: true, directionalLights: true, pointLights: true,
        picking: true, trianglePicking: true, instancedPicking: true,
        shadows: false, xr: false,
        ...overrides,
      }),
    }
  }
  async initialize() {}
  resize(width, height, pixelRatio) { this.width = width; this.height = height; this.pixelRatio = pixelRatio }
  setClearColor(value) { this.clearColor = value }
  setColorManagement(value) { this.colorManagement = value }
  setEnvironmentLighting(value) { this.environmentLighting = value }
  setShadowOptions(value) { this.shadowOptions = value }
  setImageQuality(value) { this.imageQuality = value }
  render(scene) {
    let draws = 0
    let visible = 0
    scene.traverse((node) => {
      if (!node.worldVisible) return
      if (node instanceof Mesh) { draws += 1; visible += node instanceof InstancedMesh ? node.count : 1 }
    })
    this.stats.drawCalls = draws
    this.stats.visibleObjects = visible
    this.stats.geometryMemory = draws * 256
    this.stats.textureMemory = 128
  }
  dispose() { this.disposed = true }
}

function engineFactory(backend = 'webgpu', overrides = {}, record = []) {
  return async (options) => {
    const nativeRenderer = new FakeGpuRenderer(backend, overrides)
    const engine = new Engine(nativeRenderer, options.canvas, { development: false })
    engine.initialize(options)
    await engine.installModules(options.modules ?? [])
    record.push({ engine, nativeRenderer, options })
    return engine
  }
}

function primitive(id, kind, overrides = {}) {
  return {
    id, kind,
    transform: { position: [0, 0, -5], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    roomId: 'room',
    size: kind === 'plane' || kind === 'text' || kind === 'image' ? [2, 1, 0.02] : [1, 1, 1],
    static: false,
    ...overrides,
  }
}

function compiled(primitives, rooms = [{ id: 'chunk:room', roomId: 'room', floorId: 'ground', bounds: { min: [-10, 0, -10], max: [10, 4, 10] }, primitiveIds: primitives.map((p) => p.id), colliderIds: [], portalIds: [], visible: true }]) {
  const materials = [
    { id: 'white', definition: { color: '#ffffff', roughness: 0.8 } },
    { id: 'red', definition: { color: '#ff0000', roughness: 0.5 } },
  ]
  return {
    version: 1, units: 'meters', primitives, materials, colliders: [], portals: [], rooms, triggers: [],
    roomById: new Map(rooms.map((room) => [room.roomId, room])),
    primitiveById: new Map(primitives.map((item) => [item.id, item])),
    colliderById: new Map(),
    materialById: new Map(materials.map((item) => [item.id, item])),
  }
}

function document(materials = { white: { color: '#ffffff', roughness: 0.8 }, red: { color: '#ff0000', roughness: 0.5 } }) {
  return {
    version: '0.4', units: 'meters', materials, assets: {}, entities: [],
    environment: { background: '#111111', ambientLight: { intensity: 0.4 }, sun: { intensity: 1 } },
    building: { defaults: { roomHeight: 3.2, wallThickness: 0.14, floorThickness: 0.16, ceilingThickness: 0.12 }, floors: [] },
  }
}

const imageSource = 'data:image/png;base64,AA=='
const gltfSource = `data:model/gltf+json,${encodeURIComponent(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }))}`


test('Sekai64 switches perspective and orthographic projection without losing the camera pose', () => {
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu') })
  renderer.resize(1600, 800)
  renderer.camera.setPosition([12, 80, -7])
  renderer.camera.setRotation(.25, -Math.PI / 2 + .001)
  assert.equal(renderer.camera.nativeCamera.rotation.order, 'XYZ')
  const before = renderer.camera.getPosition()

  renderer.camera.setProjection({ type: 'orthographic', verticalSize: 120, near: .05, far: 4_000 })
  assert.ok(renderer.camera.nativeCamera instanceof OrthographicCamera)
  assert.equal(renderer.camera.getProjection().type, 'orthographic')
  assert.equal(renderer.camera.getProjection().verticalSize, 120)
  assert.deepEqual(renderer.camera.getPosition(), before)
  assert.equal(renderer.camera.nativeCamera.top, 60)
  assert.equal(renderer.camera.nativeCamera.right, 120)

  renderer.camera.setProjection({ type: 'perspective', fieldOfView: 65, near: .05, far: 2_000 })
  assert.ok(renderer.camera.nativeCamera instanceof PerspectiveCamera)
  assert.equal(renderer.camera.getProjection().type, 'perspective')
  assert.equal(renderer.camera.getProjection().fieldOfView, 65)
  assert.deepEqual(renderer.camera.getPosition(), before)
  renderer.dispose()
})

test('Sekai64 forwards trusted renderer modules into engine creation', async () => {
  const records = []
  const module = {
    id: 'test.renderer-module',
    setup() { return { capabilities: { installed: true } } },
  }
  const renderer = new Sekai64Renderer({
    canvas: canvas(),
    modules: [module],
    engineFactory: engineFactory('webgpu', {}, records),
  })

  await renderer.initialize()

  assert.equal(records[0].options.modules[0], module)
  assert.equal(records[0].engine.modules.has('test.renderer-module'), true)
  renderer.dispose()
})

test('Sekai64 maps all required primitive and light types', async () => {
  const items = [
    primitive('box', 'box', { material: 'white' }),
    primitive('plane', 'plane', { transform: { position: [3, 0, -5], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
    primitive('cylinder', 'cylinder', { transform: { position: [-3, 0, -5], rotation: [0, 0, 0], scale: [1, 1, 1] }, radius: 0.5, height: 1 }),
    primitive('disc', 'disc', { transform: { position: [-1, 0, -5], rotation: [0, 0, 0], scale: [1, 1, 1] }, radius: 0.75, height: 0.06 }),
    primitive('cone', 'cone', { transform: { position: [1, 0, -5], rotation: [0, 0, 0], scale: [1, 1, 1] }, radius: 0.75, height: 1.5 }),
    primitive('sphere', 'sphere', { transform: { position: [0, 1.5, -5], rotation: [0, 0, 0], scale: [1, 1, 1] }, radius: 0.75 }),
    primitive('text', 'text', { text: 'Anyo + Sekai64' }),
    primitive('image', 'image', { src: imageSource }),
    primitive('model', 'model', { src: gltfSource }),
    primitive('ambient', 'light', { lightType: 'ambient' }),
    primitive('directional', 'light', { lightType: 'directional' }),
    primitive('point', 'light', { lightType: 'point' }),
  ]
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu') })
  await renderer.mount(compiled(items), document())
  await renderer.whenIdle()
  const nodes = renderer.nodes
  assert.ok(nodes.get('box') instanceof Mesh)
  assert.ok(nodes.get('plane') instanceof Mesh)
  assert.ok(nodes.get('cylinder') instanceof Mesh)
  assert.ok(nodes.get('disc') instanceof Mesh)
  assert.ok(nodes.get('cone') instanceof Mesh)
  assert.ok(nodes.get('sphere') instanceof Mesh)
  assert.ok(nodes.get('text') instanceof TextMesh)
  assert.ok(nodes.get('image') instanceof ImageMesh)
  assert.equal(nodes.get('model')?.id, 'model')
  assert.ok(nodes.get('ambient') instanceof AmbientLight)
  assert.ok(nodes.get('directional') instanceof DirectionalLight)
  assert.ok(nodes.get('point') instanceof PointLight)
  assert.equal(renderer.roomGroups.has('room'), true)
  renderer.dispose()
})

test('Sekai64 applies transform, visibility, material, text, image, room, and removal updates', async () => {
  const items = [
    primitive('box', 'box', { material: 'white' }),
    primitive('text', 'text', { text: 'Before', transform: { position: [0, 2, -5], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
    primitive('image', 'image', { src: imageSource, transform: { position: [0, -2, -5], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
  ]
  const world = compiled(items)
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgl2') })
  await renderer.mount(world, document())
  await renderer.whenIdle()
  const box = { ...items[0], transform: { position: [2, 1, -4], rotation: [0, 0.5, 0], scale: [2, 1, 1] }, material: 'red' }
  const text = { ...items[1], text: 'After' }
  const image = { ...items[2], src: 'data:image/png;base64,AQ==' }
  await renderer.applyChanges([
    { type: 'primitive-transform', primitiveId: 'box', primitive: box },
    { type: 'primitive-material', primitiveId: 'box', primitive: box },
    { type: 'primitive-visibility', primitiveId: 'box', visible: false, primitive: { ...box, visible: false } },
    { type: 'primitive-content', primitiveId: 'text', primitive: text },
    { type: 'primitive-content', primitiveId: 'image', primitive: image },
    { type: 'room-visibility', roomId: 'room', visible: false },
  ], compiled([box, text, image]), document())
  await renderer.whenIdle()
  assert.equal(renderer.nodes.get('box').position.x, 2)
  assert.equal(renderer.nodes.get('box').visible, false)
  assert.equal(renderer.nodes.get('text').text, 'After')
  assert.equal(String(renderer.nodes.get('image').texture.source), image.src)
  assert.equal(renderer.roomGroups.get('room').visible, false)
  await renderer.removePrimitive('text')
  assert.equal(renderer.nodes.has('text'), false)
  renderer.dispose()
})

test('Sekai64 uses precise picking and preserves instanced primitive identity', async () => {
  const boxes = [
    primitive('product:0', 'box', { interactive: true, interaction: { action: 'open' }, static: true, batchKey: 'products:white:box', geometryKey: 'unit-box' }),
    primitive('product:1', 'box', { interactive: true, interaction: { action: 'open' }, static: true, batchKey: 'products:white:box', geometryKey: 'unit-box', transform: { position: [3, 0, -5], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
  ]
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu') })
  await renderer.mount(compiled(boxes), document())
  renderer.camera.setPosition([0, 0, 0])
  renderer.camera.setRotation(0, 0)
  const hit = renderer.pick(400, 300)
  assert.equal(hit?.primitiveId, 'product:0')
  assert.equal(hit?.instanceId, 0)
  const rayHit = renderer.pickRay([0, 0, 0], [0, 0, -1], { precision: 'triangles', far: 10 })
  assert.equal(rayHit?.primitiveId, 'product:0')
  assert.equal(rayHit?.instanceId, 0)
  assert.ok(rayHit?.distance > 0)
  assert.equal(rayHit?.point.length, 3)
  assert.equal(renderer.nodes.get('product:0') instanceof InstancedMesh, true)
  renderer.dispose()
})

test('Sekai64 native access registers external nodes with stable Anyo picking identity', async () => {
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu') })
  await renderer.mount(compiled([]), document())
  renderer.camera.setPosition([0, 0, 0])
  renderer.camera.setRotation(0, 0)

  const access = renderer.getNativeAccess()
  assert.ok(access)
  const mesh = new Mesh({
    id: 'map-building-mesh',
    geometry: new BoxGeometry({ width: 2, height: 2, depth: 2 }),
    material: new StandardMaterial({ baseColor: '#667788' }),
    ownsResources: true,
  })
  mesh.setTransform({ position: [0, 0, -5] })
  access.scene.add(mesh)
  const unregister = access.registerExternalNode({
    primitiveId: 'map:osm-way-100',
    entityId: 'osm-way-100',
    node: mesh,
    interactive: true,
  })

  const hit = renderer.pick(400, 300)
  assert.equal(hit?.primitiveId, 'map:osm-way-100')
  assert.equal(hit?.entityId, 'osm-way-100')

  unregister()
  assert.equal(renderer.pick(400, 300), null)
  mesh.dispose()
  renderer.dispose()
})

test('Sekai64 shares geometry, batches 1,000 primitives, and disposes ownership safely', async () => {
  const rooms = Array.from({ length: 20 }, (_, index) => ({
    id: `chunk:room-${index}`, roomId: `room-${index}`, floorId: 'ground',
    bounds: { min: [-50, 0, -50], max: [50, 4, 50] }, primitiveIds: [], colliderIds: [], portalIds: [], visible: true,
  }))
  const materials = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`m${index}`, { color: `#${index}${index}${index}${index}${index}${index}` }]))
  const boxes = Array.from({ length: 1000 }, (_, index) => {
    const roomId = `room-${index % 20}`
    const material = `m${index % 10}`
    return primitive(`wall:${index}`, 'box', {
      roomId, material, static: true, geometryKey: 'unit-box', batchKey: `${roomId}:${material}:box`,
      transform: { position: [(index % 50) - 25, 1.5, -Math.floor(index / 50)], rotation: [0, 0, 0], scale: [1, 1, 1] },
    })
  })
  for (const box of boxes) rooms.find((room) => room.roomId === box.roomId).primitiveIds.push(box.id)
  const records = []
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu', {}, records) })
  await renderer.mount(compiled(boxes, rooms), document(materials))
  const sharedBox = renderer.unitBox
  renderer.render()
  const metrics = renderer.getMetrics()
  assert.equal(metrics.mountedPrimitives, 1000)
  assert.equal(metrics.sharedGeometryCount, 5)
  assert.ok(metrics.instancedBatchCount <= 20)
  assert.ok(metrics.drawCalls <= 20)
  assert.equal(sharedBox.disposed, false)
  await renderer.removePrimitive('wall:0')
  assert.equal(sharedBox.disposed, false)
  await renderer.disposeAsync()
  assert.equal(sharedBox.disposed, true)
  assert.equal(records[0].engine.disposed, true)
})

test('Sekai64 reports actual WebGPU and WebGL2 fallback capabilities', async () => {
  const webgpu = new Sekai64Renderer({ canvas: canvas(), backend: 'auto', engineFactory: engineFactory('webgpu') })
  await webgpu.initialize()
  assert.equal(webgpu.info.capabilities.backend, 'webgpu')
  webgpu.dispose()
  const fallback = new Sekai64Renderer({ canvas: canvas(), backend: 'auto', engineFactory: engineFactory('webgl2') })
  await fallback.initialize()
  assert.equal(fallback.info.capabilities.backend, 'webgl2')
  fallback.dispose()
})

test('Sekai64 aborts stale async image loads when primitives are removed', async () => {
  const originalBitmap = globalThis.createImageBitmap
  let resolveBitmap
  globalThis.createImageBitmap = () => new Promise((resolve) => { resolveBitmap = resolve })
  const item = primitive('slow-image', 'image', { src: imageSource })
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu') })
  await renderer.mount(compiled([item]), document())
  await renderer.removePrimitive('slow-image')
  resolveBitmap?.({ width: 2, height: 2, close() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(renderer.nodes.has('slow-image'), false)
  assert.equal(renderer.getMetrics().pendingAssets, 0)
  globalThis.createImageBitmap = originalBitmap
  renderer.dispose()
})


test('Sekai64 exposes registered model formats and loads VRM through an external loader', async () => {
  let disposed = false
  let request
  const renderer = new Sekai64Renderer({
    canvas: canvas(),
    engineFactory: engineFactory('webgpu'),
    assetLoaders: [{
      type: 'model',
      formats: ['vrm'],
      async load(value) {
        request = value
        return new Node({ id: value.id ?? 'vrm-model' })
      },
      dispose() { disposed = true },
    }],
  })

  await renderer.initialize()
  assert.deepEqual(renderer.info.capabilities.assetFormats.model, ['glb', 'gltf', 'vrm'])

  const avatar = primitive('avatar', 'model', {
    src: 'https://assets.example.com/avatar.vrm',
    assetId: 'avatar-asset',
    assetType: 'model',
    assetFormat: 'vrm',
  })
  const worldDocument = document()
  worldDocument.assets['avatar-asset'] = {
    type: 'model',
    format: 'vrm',
    src: avatar.src,
    options: { humanoid: true },
  }

  await renderer.mount(compiled([avatar]), worldDocument)
  await renderer.whenIdle()
  assert.equal(renderer.nodes.get('avatar')?.id, 'avatar')
  assert.equal(request.type, 'model')
  assert.equal(request.format, 'vrm')
  assert.equal(request.src, avatar.src)
  assert.deepEqual(request.options, { humanoid: true })
  renderer.dispose()
  assert.equal(disposed, true)
})

test('Sekai64 loads all packed PBR texture channels from Anyo material asset references', async () => {
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu') })
  const item = primitive('textured-box', 'box', { material: 'textured' })
  const worldDocument = document({
    textured: {
      baseColor: '#ffffff',
      baseColorTexture: 'albedo',
      metallicRoughnessTexture: 'metallic-roughness',
      normalTexture: 'normal',
      emissiveTexture: 'emissive',
      occlusionTexture: 'occlusion',
      roughness: 0.6,
      alphaMode: 'opaque',
      doubleSided: true,
    },
  })
  worldDocument.assets = {
    albedo: { type: 'texture', format: 'png', src: imageSource },
    'metallic-roughness': { type: 'texture', format: 'png', src: 'data:image/png;base64,AQ==' },
    normal: { type: 'texture', format: 'png', src: 'data:image/png;base64,Ag==' },
    emissive: { type: 'texture', format: 'png', src: 'data:image/png;base64,Aw==' },
    occlusion: { type: 'texture', format: 'png', src: 'data:image/png;base64,BA==' },
  }

  await renderer.mount(compiled([item]), worldDocument)
  await renderer.whenIdle()
  const mesh = renderer.nodes.get('textured-box')
  assert.ok(mesh instanceof Mesh)
  assert.ok(mesh.material.baseColorTexture)
  assert.ok(mesh.material.metallicRoughnessTexture)
  assert.ok(mesh.material.normalTexture)
  assert.ok(mesh.material.emissiveTexture)
  assert.ok(mesh.material.occlusionTexture)
  assert.equal(mesh.material.side, 'double')
  for (const channel of ['baseColor', 'metallicRoughness', 'normal', 'emissive', 'occlusion']) {
    assert.equal(renderer.info.capabilities.materialTextureChannels.includes(channel), true)
  }

  const material = mesh.material
  renderer.dispose()
  assert.equal(material.disposed, true)
  assert.equal(material.baseColorTexture.disposed, true)
  assert.equal(material.metallicRoughnessTexture.disposed, true)
  assert.equal(material.normalTexture.disposed, true)
  assert.equal(material.emissiveTexture.disposed, true)
  assert.equal(material.occlusionTexture.disposed, true)
})

test('Sekai64 applies identical normalized text styling during creation and updates', async () => {
  const initial = primitive('styled-text', 'text', {
    text: 'First\nline',
    size: [5, 1, 0.02],
    style: { resolution: 512, fontSize: 0.22, padding: 0.08, align: 'start', background: '#00000000' },
  })
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu') })
  await renderer.mount(compiled([initial]), document())
  const node = renderer.nodes.get('styled-text')
  assert.ok(node instanceof TextMesh)
  assert.equal(node.textOptions.fontSize, 113)
  assert.equal(node.textOptions.padding, 41)
  assert.equal(node.textOptions.width, 2560)
  assert.equal(node.textOptions.height, 512)
  assert.equal(node.textOptions.align, 'left')
  const oldTexture = node.texture

  const updated = {
    ...initial,
    text: 'Updated\ntext',
    style: { ...initial.style, align: 'end' },
  }
  await renderer.updatePrimitive(updated)
  assert.equal(node.text, 'Updated\ntext')
  assert.equal(node.textOptions.fontSize, 113)
  assert.equal(node.textOptions.padding, 41)
  assert.equal(node.textOptions.align, 'right')
  assert.equal(oldTexture.disposed, true)
  renderer.dispose()
})


test('Sekai64 receives the complete normalized Anyo visual contract', async () => {
  const records = []
  const renderer = new Sekai64Renderer({
    canvas: canvas(),
    engineFactory: engineFactory('webgl2', { shadows: true }, records),
  })
  const box = primitive('visual-box', 'box', {
    material: 'advanced',
    castShadow: false,
    receiveShadow: true,
  })
  const point = primitive('visual-light', 'light', {
    lightType: 'point',
    intensity: 3.5,
    range: 7,
    decay: 2.5,
  })
  const sun = primitive('visual-sun', 'light', {
    lightType: 'directional',
    intensity: 0.8,
    castShadow: true,
  })
  const world = compiled([box, point, sun])
  const advanced = {
    color: '#445566',
    roughness: 0.42,
    metalness: 0.36,
    normalScale: 0.7,
    occlusionStrength: 0.65,
    emissive: '#123456',
    emissiveIntensity: 1.4,
    transmission: 0.25,
    ior: 1.4,
    thickness: 0.03,
    castShadow: false,
    receiveShadow: true,
  }
  world.materials = [{ id: 'advanced', definition: advanced }]
  world.materialById = new Map([['advanced', world.materials[0]]])
  const worldDocument = document({ advanced })
  worldDocument.version = '0.6'
  worldDocument.environment = {
    background: '#090d14',
    ambientLight: { color: '#d8e5ff', intensity: 0.3 },
    lighting: {
      enabled: true,
      skyColor: '#7187a5',
      groundColor: '#111722',
      diffuseIntensity: 0.32,
      specularIntensity: 0.42,
    },
    colorManagement: { toneMapping: 'aces', exposure: 1.1, outputColorSpace: 'srgb' },
    shadows: { enabled: true, mapSize: 2048, bias: 0.0008, normalBias: 0.018, softness: 1, cameraPadding: 2.5 },
    imageQuality: { dithering: true, maxAnisotropy: 8 },
    sun: {
      color: '#e7f0ff', intensity: 0.82, position: [10, 16, 7], castShadow: true,
      shadow: { enabled: true, mapSize: 2048, bias: 0.0008, normalBias: 0.018, softness: 1, cameraPadding: 2.5 },
    },
  }

  await renderer.mount(world, worldDocument)
  await renderer.whenIdle()

  const native = records[0].nativeRenderer
  assert.deepEqual(native.colorManagement, { toneMapping: 'aces', exposure: 1.1, outputColorSpace: 'srgb' })
  assert.equal(native.environmentLighting.enabled, true)
  assert.equal(native.environmentLighting.intensity, 0.32)
  assert.equal(native.environmentLighting.specularIntensity, 0.42)
  assert.equal(native.shadowOptions.mapSize, 2048)
  assert.equal(native.shadowOptions.normalBias, 0.018)
  assert.deepEqual(native.imageQuality, { dithering: true, maxAnisotropy: 8, renderScale: 1, msaaSamples: 4, mipmaps: true, antialiasing: 'fxaa', sharpen: 0.08 })

  const mesh = renderer.nodes.get('visual-box')
  assert.ok(mesh instanceof Mesh)
  assert.equal(mesh.material.normalScale, 0.7)
  assert.equal(mesh.material.occlusionStrength, 0.65)
  assert.equal(mesh.material.emissiveIntensity, 1.4)
  assert.equal(mesh.material.transmission, 0.25)
  assert.equal(mesh.material.ior, 1.4)
  assert.equal(mesh.material.thickness, 0.03)
  assert.equal(mesh.castShadow, false)
  assert.equal(mesh.receiveShadow, true)

  const light = renderer.nodes.get('visual-light')
  assert.ok(light instanceof PointLight)
  assert.equal(light.range, 7)
  assert.equal(light.decay, 2.5)
  const directional = renderer.nodes.get('visual-sun')
  assert.ok(directional instanceof DirectionalLight)
  assert.equal(directional.castShadow, true)

  const environmentSun = renderer.getNativeAccess().scene.children.find((node) => node.id === 'anyo-environment-sun')
  assert.ok(environmentSun instanceof DirectionalLight)
  const expectedLength = Math.hypot(10, 16, 7)
  assert.ok(Math.abs(environmentSun.direction.x - (-10 / expectedLength)) < 1e-6)
  assert.ok(Math.abs(environmentSun.direction.y - (-16 / expectedLength)) < 1e-6)
  assert.ok(Math.abs(environmentSun.direction.z - (-7 / expectedLength)) < 1e-6)
  renderer.dispose()
})

test('anime-rpg keeps environments PBR while routing characters to MToon and effects to toon', async () => {
  const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgpu') })
  const environment = primitive('environment-mesh', 'box')
  const character = primitive('character-mesh', 'box', { tags: ['entity', 'avatar'] })
  const effect = primitive('effect-mesh', 'box', { tags: ['entity', 'vfx'] })
  const worldDocument = document()
  worldDocument.version = '0.6'
  worldDocument.environment.visualStyle = { profile: 'anime-rpg' }

  await renderer.mount(compiled([environment, character, effect]), worldDocument)
  assert.equal(renderer.nodes.get('environment-mesh').material.shadingModel, 'pbr')
  assert.equal(renderer.nodes.get('character-mesh').material.shadingModel, 'mtoon')
  assert.equal(renderer.nodes.get('effect-mesh').material.shadingModel, 'toon')
  renderer.dispose()
})


test('environment sun uses a finite downward fallback for zero or overflowing vectors', async () => {
  for (const position of [[0, 0, 0], [1e308, 1e308, 1e308]]) {
    const renderer = new Sekai64Renderer({ canvas: canvas(), engineFactory: engineFactory('webgl2', { shadows: true }) })
    const worldDocument = document()
    worldDocument.environment.sun = { position, intensity: 1, castShadow: true }
    await renderer.mount(compiled([]), worldDocument)
    const sun = renderer.getNativeAccess().scene.children.find(node => node.id === 'anyo-environment-sun')
    assert.ok(sun instanceof DirectionalLight)
    assert.deepEqual([sun.direction.x, sun.direction.y, sun.direction.z], [0, -1, 0])
    renderer.dispose()
  }
})
