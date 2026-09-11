import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import {
  createComponentTypeRegistry,
} from '../dist/esm/components/index.js'
import {
  assetsPlugin,
  createAssetTypeRegistry,
} from '../dist/esm/assets/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

function createDocument(overrides = {}) {
  return {
    version: '0.5',
    assets: {},
    materials: {},
    entities: [],
    ...overrides,
  }
}

class MockCamera {
  position = [0, 0, 0]
  rotation = [0, 0]
  getPosition() { return this.position }
  setPosition(value) { this.position = [...value] }
  getRotation() { return this.rotation }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class CapabilityRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  info
  constructor(capabilities) {
    this.info = {
      name: 'Capability Renderer',
      version: '1.0.0',
      capabilities: {
        text: true,
        images: true,
        models: true,
        lights: true,
        picking: true,
        roomVisibility: true,
        incrementalUpdates: true,
        instancing: true,
        shadows: false,
        xr: false,
        ...capabilities,
      },
    }
  }
  async mount() {}
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

test('legacy entity behavior compiles into namespaced components without breaking semantics', async () => {
  const world = createWorld({ plugins: [assetsPlugin(), entitiesPlugin()] })
  await world.load(createDocument({
    entities: [{
      id: 'product',
      type: 'box',
      collision: true,
      visible: true,
      interaction: { action: 'open-product', params: { sku: 'SKU-1' } },
      audio: { src: './ambient.ogg', loop: true },
      lod: [{ distance: 20, visible: false }],
    }],
  }))

  const primitive = world.compiled.primitives[0]
  assert.equal(primitive.collision, true)
  assert.equal(primitive.interaction.action, 'open-product')
  assert.equal(primitive.audio.src, './ambient.ogg')
  assert.equal(primitive.lod[0].distance, 20)
  assert.deepEqual(
    primitive.components.map((component) => component.type).sort(),
    ['anyo.audio', 'anyo.collider', 'anyo.interactable', 'anyo.lod', 'anyo.visibility'].sort(),
  )
  world.dispose()
})

test('explicit components override legacy fields and disabled components remain inactive', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()] })
  await world.load(createDocument({
    entities: [{
      id: 'door',
      type: 'box',
      collision: true,
      interaction: { action: 'legacy-action' },
      components: [
        { type: 'anyo.collider', enabled: false },
        { type: 'anyo.interactable', events: { select: { action: 'open-door', params: { speed: 2 } } } },
      ],
    }],
  }))

  const primitive = world.compiled.primitives[0]
  assert.equal(primitive.collision, false)
  assert.equal(primitive.interaction.action, 'open-door')
  assert.deepEqual(primitive.interaction.params, { speed: 2 })
  assert.equal(primitive.components.find((component) => component.type === 'anyo.collider').enabled, false)
  world.dispose()
})

test('unknown components support error, warning, and preservation policies', async () => {
  const document = createDocument({
    entities: [{
      id: 'status',
      type: 'box',
      components: [{ type: 'community.status', value: 7 }],
    }],
  })

  const strictWorld = createWorld({ plugins: [entitiesPlugin()] })
  await assert.rejects(strictWorld.load(document), /ANYO_COMPONENT_TYPE_UNSUPPORTED[\s\S]*community\.status/)
  strictWorld.dispose()

  const warnings = []
  const warningWorld = createWorld({
    plugins: [entitiesPlugin({ unknownComponents: 'warn' })],
    onWarning: (message) => warnings.push(message),
  })
  await warningWorld.load(document)
  assert.equal(warnings.length, 1)
  assert.equal(warningWorld.compiled.primitives[0].components[0].data.value, 7)
  warningWorld.dispose()

  const preserveWorld = createWorld({ plugins: [entitiesPlugin({ unknownComponents: 'preserve' })] })
  await preserveWorld.load(document)
  assert.equal(preserveWorld.compiled.primitives[0].components[0].type, 'community.status')
  preserveWorld.dispose()
})

test('custom component registrations validate and compile renderer-independent data', async () => {
  const registry = createComponentTypeRegistry()
  registry.register({
    type: 'community.health',
    validate(component) {
      if (typeof component.maximum !== 'number' || component.maximum <= 0) {
        throw new Error('community.health maximum must be positive.')
      }
    },
    compile(component) {
      return {
        current: typeof component.current === 'number' ? component.current : component.maximum,
        maximum: component.maximum,
      }
    },
  })

  const world = createWorld({ plugins: [entitiesPlugin({ componentRegistry: registry })] })
  await world.load(createDocument({
    entities: [{
      id: 'player',
      type: 'box',
      components: [{ type: 'community.health', current: 80, maximum: 100 }],
    }],
  }))

  assert.deepEqual(world.compiled.primitives[0].components[0].data, { current: 80, maximum: 100 })
  world.dispose()
})

test('asset registry validates formats, custom asset types, fallbacks, and material texture references', async () => {
  const unsupported = createWorld({ plugins: [assetsPlugin(), entitiesPlugin()] })
  await assert.rejects(unsupported.load(createDocument({
    assets: { scene: { type: 'model', format: 'fbx', src: './scene.fbx' } },
    entities: [{ id: 'scene', type: 'model', asset: 'scene' }],
  })), /ANYO_ASSET_FORMAT_UNSUPPORTED[\s\S]*Format: fbx/)
  unsupported.dispose()

  const invalidFallback = createWorld({ plugins: [assetsPlugin()] })
  await assert.rejects(invalidFallback.load(createDocument({
    assets: { avatar: { type: 'model', format: 'vrm', src: './avatar.vrm', fallback: 'missing' } },
  })), /ANYO_ASSET_FALLBACK_NOT_FOUND/)
  invalidFallback.dispose()

  const invalidTexture = createWorld({ plugins: [assetsPlugin()] })
  await assert.rejects(invalidTexture.load(createDocument({
    assets: { chair: { type: 'model', format: 'glb', src: './chair.glb' } },
    materials: { chair: { baseColorTexture: 'chair' } },
  })), /ANYO_MATERIAL_ASSET_TYPE_INVALID/)
  invalidTexture.dispose()

  const packedPbr = createWorld({ plugins: [assetsPlugin(), entitiesPlugin()] })
  await packedPbr.load(createDocument({
    assets: { packed: { type: 'texture', format: 'png', src: './metallic-roughness.png' } },
    materials: { surface: { metallicRoughnessTexture: 'packed' } },
    entities: [{ id: 'surface', type: 'box', material: 'surface' }],
  }))
  assert.equal(packedPbr.document.materials.surface.metallicRoughnessTexture, 'packed')
  packedPbr.dispose()

  const invalidPackedPbr = createWorld({ plugins: [assetsPlugin(), entitiesPlugin()] })
  await assert.rejects(invalidPackedPbr.load(createDocument({
    assets: { packed: { type: 'model', format: 'glb', src: './not-a-texture.glb' } },
    materials: { surface: { metallicRoughnessTexture: 'packed' } },
    entities: [{ id: 'surface', type: 'box', material: 'surface' }],
  })), /ANYO_MATERIAL_ASSET_TYPE_INVALID[\s\S]*metallicRoughnessTexture/)
  invalidPackedPbr.dispose()

  const registry = createAssetTypeRegistry()
  registry.register({ type: 'point-cloud', formats: ['ply'] })
  const custom = createWorld({ plugins: [assetsPlugin({ registry })] })
  await custom.load(createDocument({
    assets: { cloud: { type: 'point-cloud', format: 'ply', src: './cloud.ply' } },
  }))
  assert.equal(custom.document.assets.cloud.type, 'point-cloud')
  custom.dispose()
})

test('renderer capability negotiation rejects unsupported asset formats and texture channels', async () => {
  const modelRenderer = new CapabilityRenderer({ assetFormats: { model: ['gltf', 'glb'] } })
  const vrmWorld = createWorld({
    renderer: modelRenderer,
    plugins: [assetsPlugin(), entitiesPlugin()],
  })
  await assert.rejects(vrmWorld.load(createDocument({
    assets: { avatar: { type: 'model', format: 'vrm', src: './avatar.vrm' } },
    entities: [{ id: 'avatar', type: 'model', asset: 'avatar' }],
  })), /required capability "asset:model\/vrm"/)
  vrmWorld.dispose()

  const materialRenderer = new CapabilityRenderer({
    assetFormats: { texture: ['png'] },
    materialTextureChannels: ['baseColor'],
  })
  const materialWorld = createWorld({
    renderer: materialRenderer,
    plugins: [assetsPlugin(), entitiesPlugin()],
  })
  await assert.rejects(materialWorld.load(createDocument({
    assets: { normal: { type: 'texture', format: 'png', src: './normal.png' } },
    materials: { surface: { normalTexture: 'normal' } },
    entities: [{ id: 'surface', type: 'box', material: 'surface' }],
  })), /required capability "material-texture:normal"/)
  materialWorld.dispose()

  const packedMaterialRenderer = new CapabilityRenderer({
    assetFormats: { texture: ['png'] },
    materialTextureChannels: ['baseColor', 'normal'],
  })
  const packedMaterialWorld = createWorld({
    renderer: packedMaterialRenderer,
    plugins: [assetsPlugin(), entitiesPlugin()],
  })
  await assert.rejects(packedMaterialWorld.load(createDocument({
    assets: { packed: { type: 'texture', format: 'png', src: './metallic-roughness.png' } },
    materials: { surface: { metallicRoughnessTexture: 'packed' } },
    entities: [{ id: 'surface', type: 'box', material: 'surface' }],
  })), /required capability "material-texture:metallicRoughness"/)
  packedMaterialWorld.dispose()
})

test('preferred audio components compile the unified renderer-independent contract', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()] })
  await world.load(createDocument({
    entities: [{
      id: 'fountain',
      type: 'box',
      components: [{
        type: 'anyo.audio',
        source: './water.ogg',
        category: 'ambient',
        strategy: 'streaming',
        spatial: true,
        autoplay: true,
        loop: true,
        volume: 0.6,
        playbackRate: 1.1,
        startOffset: 2,
        distance: { model: 'linear', min: 2, max: 30, rolloff: 0.5 },
        cone: { innerAngle: 180, outerAngle: 270, outerGain: 0.2 },
        zone: { shape: 'sphere', radius: 5, fadeDistance: 2 },
      }],
    }],
  }))

  const audio = world.compiled.primitives[0].audio
  assert.equal(audio.source, './water.ogg')
  assert.equal(audio.src, './water.ogg')
  assert.equal(audio.category, 'ambient')
  assert.equal(audio.strategy, 'streaming')
  assert.deepEqual(audio.distance, { model: 'linear', min: 2, max: 30, rolloff: 0.5 })
  assert.deepEqual(audio.cone, { innerAngle: 180, outerAngle: 270, outerGain: 0.2 })
  assert.equal(audio.zone.shape, 'sphere')
  assert.equal(audio.zone.radius, 5)
  assert.equal(audio.zone.fadeDistance, 2)
  assert.equal(audio.zone.size, undefined)
  world.dispose()
})

test('unified audio validation rejects unsafe ranges before runtime ownership begins', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()] })
  await assert.rejects(world.load(createDocument({
    entities: [{
      id: 'broken-audio',
      type: 'box',
      components: [{
        type: 'anyo.audio',
        source: './broken.ogg',
        volume: 1.5,
        distance: { min: 10, max: 2 },
      }],
    }],
  })), /volume|distance/i)
  world.dispose()
})
