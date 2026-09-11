import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import {
  compileEntities,
  createEntityTypeRegistry,
  entitiesPlugin,
} from '../dist/esm/entities/index.js'
import { normalizeWorldDocument } from '../dist/esm/schema/index.js'

function output() {
  return { primitives: [], materials: [], colliders: [], portals: [], rooms: [], triggers: [] }
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

class MockRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  mounted = null
  mountCount = 0
  async mount(compiled) { this.mounted = compiled; this.mountCount += 1 }
  async applyChanges(_changes, compiled) { this.mounted = compiled }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

test('entity-only worlds normalize and compile without a building', () => {
  const document = normalizeWorldDocument({
    version: '0.4',
    entities: [{ id: 'cube', type: 'box', position: [1, 2, 3] }],
  })
  const compiled = output()
  compileEntities(document, compiled)
  assert.equal(document.building.floors.length, 0)
  assert.equal(compiled.primitives.length, 1)
  assert.deepEqual(compiled.primitives[0].transform.position, [1, 2, 3])
})

test('nested rotations compose mathematically instead of adding Euler angles', () => {
  const document = normalizeWorldDocument({
    version: '0.4',
    entities: [{
      id: 'parent',
      type: 'group',
      rotation: [Math.PI / 2, 0, 0],
      children: [{
        id: 'child',
        type: 'group',
        rotation: [0, Math.PI / 2, 0],
        children: [{ id: 'point', type: 'box', position: [0, 1, 0] }],
      }],
    }],
  })
  const compiled = output()
  compileEntities(document, compiled)
  const point = compiled.primitives.find((primitive) => primitive.entityId === 'parent/child/point')
  assert.ok(point)
  assert.ok(Math.abs(point.transform.position[0]) < 1e-9)
  assert.ok(Math.abs(point.transform.position[1]) < 1e-9)
  assert.ok(Math.abs(point.transform.position[2] - 1) < 1e-9)
  assert.equal(point.transform.matrix.length, 16)
  assert.equal(point.transform.quaternion.length, 4)
})

test('rotated entity colliders use transformed world bounds', () => {
  const document = normalizeWorldDocument({
    version: '0.4',
    entities: [{
      id: 'beam',
      type: 'box',
      size: [4, 1, 1],
      rotation: [0, Math.PI / 4, 0],
      collision: true,
    }],
  })
  const compiled = output()
  compileEntities(document, compiled)
  const bounds = compiled.colliders[0].bounds
  const width = bounds.max[0] - bounds.min[0]
  const depth = bounds.max[2] - bounds.min[2]
  assert.ok(Math.abs(width - Math.sqrt(12.5)) < 1e-9)
  assert.ok(Math.abs(depth - Math.sqrt(12.5)) < 1e-9)
})

test('unknown entity types fail clearly and registered types can compile', () => {
  const document = normalizeWorldDocument({
    version: '0.4',
    entities: [{ id: 'avatar', type: 'avatar' }],
  })
  assert.throws(() => compileEntities(document, output()), /ANYO_ENTITY_TYPE_UNSUPPORTED[\s\S]*Type: avatar/)

  const registry = createEntityTypeRegistry()
  registry.register({
    type: 'avatar',
    compile({ entity, output: target, transform, sourcePath }) {
      target.primitives.push({
        id: `entity:${entity.id}`,
        entityId: entity.id,
        kind: 'model',
        transform,
        visible: true,
        sourcePath,
      })
    },
  })
  const compiled = output()
  compileEntities(document, compiled, { registry })
  assert.equal(compiled.primitives[0].kind, 'model')
})

test('headless worlds compile, mutate, serialize, and attach a renderer later', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()] })
  await world.load({
    version: '0.4',
    entities: [{ id: 'cube', type: 'box' }],
  })
  assert.equal(world.compiled.primitives.length, 1)
  await world.updateEntity('cube', { position: [2, 0, 0] })
  assert.deepEqual(world.compiled.primitives[0].transform.position, [2, 0, 0])
  assert.equal(JSON.parse(world.serialize()).version, '0.7')

  const renderer = new MockRenderer()
  await world.attachRenderer(renderer)
  assert.equal(renderer.mountCount, 1)
  assert.equal(renderer.mounted.primitives[0].entityId, 'cube')
  world.dispose()
})

test('relative asset URLs resolve against the loaded world URL', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return {
        version: '0.4',
        assets: {
          chair: { type: 'model', format: 'glb', src: './models/chair.glb' },
        },
        entities: [{ id: 'chair', type: 'model', asset: 'chair' }],
      }
    },
  })

  try {
    const world = createWorld({ plugins: [entitiesPlugin()] })
    await world.load('https://example.com/worlds/store/world.anyo.json')
    const primitive = world.compiled.primitives[0]
    assert.equal(primitive.src, 'https://example.com/worlds/store/models/chair.glb')
    assert.equal(primitive.assetType, 'model')
    assert.equal(primitive.assetFormat, 'glb')
    world.dispose()
  } finally {
    globalThis.fetch = originalFetch
  }
})
