import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createWorld,
  entitiesPlugin,
  inspectWorldDocument,
  normalizeWorldDocument,
} from '../dist/esm/index.js'
import { Sekai64Renderer } from '../dist/esm/renderer-sekai64/index.js'
import { Engine, Mesh, ParticleEmitter } from '@blcklab/sekai64'
import { createRendererFeatures } from '@blcklab/sekai64/renderer'

const loadShowcase = async () => JSON.parse(await readFile(new URL('../examples/step-12-world-quality/world.anyo.json', import.meta.url), 'utf8'))

class Fake2DContext {
  font = ''; fillStyle = ''; textBaseline = ''; textAlign = ''
  measureText(text) { return { width: Math.max(1, String(text).length * 12) } }
  scale() {}; clearRect() {}; fillRect() {}; fillText() {}
}
class FakeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; this.context = new Fake2DContext() }
  getContext(type) { return type === '2d' ? this.context : null }
}
globalThis.OffscreenCanvas ??= FakeOffscreenCanvas
globalThis.createImageBitmap ??= async () => ({ width: 16, height: 16, close() {} })

const canvas = () => ({
  width: 800, height: 600, clientWidth: 800, clientHeight: 600,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
})

class FakeGpuRenderer {
  width = 1; height = 1; pixelRatio = 1
  stats = { drawCalls: 0, triangles: 0, visibleObjects: 0, culledObjects: 0, pipelineChanges: 0, geometryMemory: 0, textureMemory: 0 }
  constructor(backend) {
    this.backend = backend
    this.capabilities = {
      backend, maxTextureSize: 8192, maxPointLights: 8,
      computeShaders: backend === 'webgpu', timestampQueries: false,
      instancing: true, offscreenCanvas: true,
      features: createRendererFeatures({
        text: true, images: true, models: true,
        ambientLights: true, directionalLights: true, pointLights: true,
        picking: true, trianglePicking: true, instancedPicking: true,
        shadows: true, xr: false,
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
    let drawCalls = 0; let visibleObjects = 0
    scene.traverse((node) => {
      if (!node.worldVisible || !(node instanceof Mesh)) return
      drawCalls += 1; visibleObjects += 1
    })
    this.stats.drawCalls = drawCalls
    this.stats.visibleObjects = visibleObjects
  }
  dispose() {}
}

const engineFactory = (backend, records) => async options => {
  const nativeRenderer = new FakeGpuRenderer(backend)
  const engine = new Engine(nativeRenderer, options.canvas, { development: false })
  engine.initialize(options)
  await engine.installModules(options.modules ?? [])
  records.push(nativeRenderer)
  return engine
}

test('Step 12 integrated showcase validates as one coherent Anyo 0.8 world', async () => {
  const world = await loadShowcase()
  const result = inspectWorldDocument(world)
  assert.equal(result.errors.length, 0, result.errors.map(item => `${item.code}: ${item.message}`).join('\n'))
  assert.equal(world.version, '0.8')
  assert.equal(world.metadata.id, 'step-12-world-quality')
  assert.ok(world.entities.length >= 15)
  assert.ok(world.compositions['research-pavilion'])
  assert.ok(world.compositions['garden-tree'])
  assert.ok(world.compositions['cumulus-mass'])
})

test('Step 12 combines accepted visual foundations without deferred decal or volume systems', async () => {
  const world = await loadShowcase()
  assert.equal(world.environment.sky.stars.enabled, true)
  assert.ok(world.environment.sky.cloudCoverage > 0)
  assert.equal(world.environment.atmosphere.enabled, true)
  assert.equal(world.materials.water.shadingModel, 'water')
  assert.ok(world.materials.water.water.waveStrength > 0)
  assert.ok(world.materials.concrete.detail.normalTexture)
  assert.ok(world.materials.concrete.detail.heightTexture)
  assert.equal(world.materials.leaf.alphaMode, 'mask')
  assert.equal(world.materials.leaf.doubleSided, true)
  assert.ok(world.materials.glass.transmission > 0.8)
  assert.ok(world.materials['wet-stone'].clearcoat > 0.7)
  assert.ok(world.entities.filter(entity => entity.components?.some(component => component.type === 'anyo.vfx')).length >= 3)
  const serialized = JSON.stringify(world)
  for (const forbidden of ['DecalSystem', 'CloudSystem', 'WaterSystem', 'StarSystem', 'VolumeSystem', 'raymarchSteps']) assert.equal(serialized.includes(forbidden), false)
})

test('Step 12 deterministic authored variation expands vegetation and rocks reproducibly', async () => {
  const source = await loadShowcase()
  const first = normalizeWorldDocument(source)
  const second = normalizeWorldDocument(source)
  const snapshot = world => world.entities
    .filter(entity => entity.id.startsWith('tree-') || entity.id.startsWith('rock-bank'))
    .map(entity => ({ id: entity.id, position: entity.position, rotation: entity.rotation, scale: entity.scale }))
  assert.deepEqual(snapshot(first), snapshot(second))
  assert.ok(first.entities.filter(entity => entity.id.startsWith('tree-')).length >= 19)
  assert.ok(first.entities.filter(entity => entity.id.startsWith('rock-bank')).length >= 8)
})

test('Step 12 compiles reusable procedural resources instead of unique cloud meshes', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await world.load(await loadShowcase())
  const graph = world.compiled.resourceGraph
  assert.ok(graph)
  const noiseGeometry = graph.list('geometry').filter(node => node.definition.kind === 'noise')
  assert.equal(noiseGeometry.length, 4, 'three cloud geometries plus one shared rock geometry')
  const cloudInstances = graph.list('instance').filter(node => /^instance:cloud-(near|far)\//.test(node.id))
  assert.equal(cloudInstances.length, 16)
  assert.ok(new Set(cloudInstances.map(node => node.source)).size <= 3)
  assert.equal(world.compiled.entities.filter(entity => entity.components?.some(component => component.type === 'anyo.vfx')).length, 3)
  world.dispose()
})

test('Step 12 uses the frozen animation contract for cloud drift', async () => {
  const world = await loadShowcase()
  const clouds = world.entities.filter(entity => entity.id === 'cloud-near' || entity.id === 'cloud-far')
  assert.equal(clouds.length, 2)
  for (const cloud of clouds) {
    const animation = cloud.components.find(component => component.type === 'anyo.animation')
    assert.ok(animation)
    assert.equal(animation.autoplay, true)
    assert.equal(animation.tracks[0].target, 'transform.position')
    assert.equal(animation.tracks[0].loop, 'repeat')
    assert.equal(animation.tracks[0].easing, 'linear')
  }
})

test('Step 12 integrated world mounts through the same WebGL2 and WebGPU Sekai64 adapter path', async () => {
  const source = await loadShowcase()
  const compiler = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await compiler.load(source)
  const compiled = compiler.compiled
  const results = []

  for (const backend of ['webgl2', 'webgpu']) {
    const records = []
    const renderer = new Sekai64Renderer({
      canvas: canvas(),
      particleQuality: 'balanced',
      engineFactory: engineFactory(backend, records),
    })
    await renderer.mount(compiled, source)
    await renderer.whenIdle()
    renderer.render()
    let particleEmitters = 0
    renderer.getNativeAccess().scene.traverse(node => { if (node instanceof ParticleEmitter) particleEmitters += 1 })
    results.push({ backend: renderer.info.capabilities.backend, nodes: renderer.nodes.size, drawCalls: records[0].stats.drawCalls, particleEmitters })
    renderer.dispose()
  }

  assert.deepEqual(results.map(result => result.backend), ['webgl2', 'webgpu'])
  assert.equal(results[0].nodes, results[1].nodes)
  assert.equal(results[0].drawCalls, results[1].drawCalls)
  assert.equal(results[0].particleEmitters, 3)
  assert.equal(results[1].particleEmitters, 3)
  assert.ok(results[0].nodes >= 100)
  compiler.dispose()
})
