import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { buildingPlugin } from '../dist/esm/building/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

class Camera {
  position = [3, 1.7, 2]
  rotation = [0.4, -0.1]
  getPosition() { return [...this.position] }
  setPosition(value) { this.position = [...value] }
  getRotation() { return [...this.rotation] }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}
class IncrementalRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new Camera()
  mountCount = 0
  applyCount = 0
  changes = []
  mounted = null
  async mount(compiled) { this.mountCount++; this.mounted = compiled }
  async applyChanges(changes, compiled) { this.applyCount++; this.changes.push(...changes); this.mounted = compiled }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}
class LegacyRenderer extends IncrementalRenderer { constructor() { super(); this.applyChanges = undefined } async updatePrimitive() {} }
const document = {
  version: '0.3.1', data: { title: 'Before' },
  materials: { display: { color: '#ffffff' } },
  building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [8, 8] }] }] },
  entities: [{ id: 'label', type: 'text', room: 'room', position: [0, 2, 0], material: 'display', content: { $bind: 'title' }, visible: true }],
}
function make(renderer) { return createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false }) }

test('bound content updates incrementally without remounting or resetting runtime state', async () => {
  const renderer = new IncrementalRenderer()
  const world = make(renderer)
  await world.load(document)
  renderer.camera.setPosition([5, 1.8, 4])
  renderer.camera.setRotation(1, 0.2)
  world.setCurrentRoom('room')
  await world.setData('title', 'After')
  assert.equal(renderer.mountCount, 1)
  assert.equal(renderer.applyCount, 1)
  assert.ok(renderer.changes.some((change) => change.type === 'primitive-content' && change.primitive.text === 'After'))
  assert.deepEqual(renderer.camera.getPosition(), [5, 1.8, 4])
  assert.deepEqual(renderer.camera.getRotation(), [1, 0.2])
  assert.equal(world.getCurrentRoom(), 'room')
  world.dispose()
})

test('transform, visibility, and material changes classify incrementally', async () => {
  const renderer = new IncrementalRenderer()
  const world = make(renderer)
  await world.load(document)
  await world.updateEntity('label', { position: [2, 2, 0], visible: false })
  await world.transaction((next) => { next.materials.display.color = '#ff0000' }, 'Change material')
  const types = new Set(renderer.changes.map((change) => change.type))
  assert.ok(types.has('primitive-transform'))
  assert.ok(types.has('primitive-visibility'))
  assert.ok(types.has('primitive-material'))
  assert.equal(renderer.mountCount, 1)
  world.dispose()
})

test('structural room updates fall back to a full remount while preserving camera', async () => {
  const renderer = new IncrementalRenderer()
  const world = make(renderer)
  await world.load(document)
  renderer.camera.setPosition([2, 1.7, 2])
  await world.transaction((next) => { next.building.floors[0].rooms[0].size = [12, 8] }, 'Resize room')
  assert.equal(renderer.mountCount, 2)
  assert.deepEqual(renderer.camera.getPosition(), [2, 1.7, 2])
  world.dispose()
})

test('legacy renderers without applyChanges retain safe fallback behavior', async () => {
  const renderer = new LegacyRenderer()
  const world = make(renderer)
  await world.load(document)
  await world.setData('title', 'Legacy')
  assert.ok(renderer.mountCount >= 1)
  world.dispose()
})

test('door state changes update visibility, portal, and collision without remounting', async () => {
  const renderer = new IncrementalRenderer()
  const world = make(renderer)
  const doors = {
    version: '0.3.1',
    building: {
      floors: [{
        id: 'ground', elevation: 0,
        rooms: [
          {
            id: 'a', position: [0, 0], size: [8, 8],
            openings: [{ id: 'door-a-b', type: 'door', wall: 'north', offset: 'center', width: 1.2, height: 2.2, targetRoom: 'b', open: false }],
          },
          { id: 'b', size: [8, 4], attachTo: { room: 'a', wall: 'north' } },
        ],
      }],
    },
  }
  await world.load(doors)
  renderer.camera.setPosition([1, 1.7, 1])
  await world.patch({ operation: 'replace', path: '/building/floors/0/rooms/0/openings/0/open', value: true })
  const types = renderer.changes.map((change) => change.type)
  assert.ok(types.includes('primitive-visibility'))
  assert.ok(types.includes('portal-state'))
  assert.ok(types.includes('collider-state'))
  assert.equal(renderer.mountCount, 1)
  assert.deepEqual(renderer.camera.getPosition(), [1, 1.7, 1])
  assert.equal(world.compiled.portals[0].open, true)
  assert.equal(world.compiled.colliders.find((collider) => collider.kind === 'door').enabled, false)
  world.dispose()
})

test('renderer capability negotiation rejects unsupported required primitives before mount', async () => {
  class LimitedRenderer extends IncrementalRenderer {
    info = {
      name: 'limited',
      capabilities: {
        text: true, images: true, models: false, lights: true, picking: true,
        roomVisibility: true, incrementalUpdates: true, instancing: false, shadows: false, xr: false,
      },
    }
    async initialize() {}
  }
  const renderer = new LimitedRenderer()
  const world = make(renderer)
  await assert.rejects(() => world.load({
    version: '0.3.1',
    building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [4, 4] }] }] },
    entities: [{ id: 'product-model', type: 'model', room: 'room', src: '/product.glb' }],
  }), /Renderer "limited" does not support required capability "models"[\s\S]*product-model/)
  assert.equal(renderer.mountCount, 0)
  world.dispose()
})

test('renderer capability negotiation checks the requested light type', async () => {
  class LimitedLightRenderer extends IncrementalRenderer {
    info = {
      name: 'limited-lights',
      capabilities: {
        text: true, images: true, models: true, lights: true,
        ambientLights: true, directionalLights: true, pointLights: false,
        picking: true, roomVisibility: true, incrementalUpdates: true,
        instancing: false, shadows: false, xr: false,
      },
    }
    async initialize() {}
  }
  const renderer = new LimitedLightRenderer()
  const world = make(renderer)
  await assert.rejects(() => world.load({
    version: '0.3.1',
    building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [4, 4] }] }] },
    entities: [{ id: 'spotlight', type: 'light', lightType: 'point', room: 'room', position: [0, 2, 0] }],
  }), /required capability "pointLights"[\s\S]*spotlight/)
  assert.equal(renderer.mountCount, 0)
  world.dispose()
})

test('fast visibility patches preserve source, compiled state, history, undo, and redo', async () => {
  const renderer = new IncrementalRenderer()
  const world = make(renderer)
  await world.load(document)
  await world.patch({ operation: 'replace', path: '/entities/0/visible', value: false })
  assert.equal(world.getSourceDocument().entities[0].visible, false)
  assert.equal(world.compiled.primitiveById.get('entity:label').visible, false)
  assert.equal(world.getHistory().undo.at(-1).operationCount, 1)
  assert.equal(renderer.mountCount, 1)
  assert.equal(await world.undo(), true)
  assert.equal(world.compiled.primitiveById.get('entity:label').visible, true)
  assert.equal(await world.redo(), true)
  assert.equal(world.compiled.primitiveById.get('entity:label').visible, false)
  assert.equal(renderer.mountCount, 1)
  world.dispose()
})

test('fast transform updates preserve room-relative world coordinates', async () => {
  const renderer = new IncrementalRenderer()
  const world = make(renderer)
  await world.load({
    version: '0.6',
    building: { floors: [{ id: 'ground', elevation: 2, rooms: [{ id: 'room', position: [10, 20], size: [8, 8] }] }] },
    entities: [{ id: 'room-box', type: 'box', room: 'room', position: [1, 0.5, 2] }],
  })
  await world.updateEntity('room-box', { position: [3, 1, 4] })
  assert.deepEqual(world.compiled.entityById.get('room-box').transform.position, [13, 3, 24])
  assert.equal(renderer.mountCount, 1)
  assert.ok(renderer.changes.some((change) => change.type === 'primitive-transform'))
  world.dispose()
})

test('collidable transform edits fall back to full compilation and update collider bounds', async () => {
  const renderer = new IncrementalRenderer()
  const world = make(renderer)
  await world.load({
    version: '0.6',
    entities: [{ id: 'solid', type: 'box', position: [0, 0, 0], size: [2, 2, 2], collision: true }],
  })
  await world.updateEntity('solid', { position: [5, 0, 0] })
  const collider = world.compiled.colliders.find((item) => item.entityId === 'solid')
  assert.deepEqual(collider.bounds.min, [4, -1, -1])
  assert.deepEqual(collider.bounds.max, [6, 1, 1])
  world.dispose()
})
