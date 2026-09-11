import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { buildingPlugin } from '../dist/esm/building/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

class Camera {
  getPosition() { return [0, 1.65, 0] }
  setPosition() {}
  getRotation() { return [0, 0] }
  setRotation() {}
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class Renderer {
  canvas = { getBoundingClientRect: () => ({ width: 1, height: 1 }) }
  camera = new Camera()
  mountCount = 0
  disposeCount = 0
  failNextMount = false
  failNextApply = false
  async mount() {
    this.mountCount += 1
    if (this.failNextMount) {
      this.failNextMount = false
      throw new Error('mount failed')
    }
  }
  async applyChanges() {
    if (this.failNextApply) {
      this.failNextApply = false
      throw new Error('incremental update failed')
    }
  }
  async updatePrimitive() {}
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() { this.disposeCount += 1 }
}

const document = {
  version: '0.3',
  building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [4, 4] }] }] },
  entities: [{ id: 'label', type: 'text', content: 'Safe' }],
}

test('Plugin lifecycle is balanced across reload and disposal', async () => {
  const renderer = new Renderer()
  let setups = 0
  let disposals = 0
  const lifecycle = {
    name: 'lifecycle-test',
    setup() { setups += 1 },
    dispose() { disposals += 1 },
  }
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin(), lifecycle], autoResize: false })
  await world.load(document)
  await world.reload()
  world.dispose()
  world.dispose()
  assert.equal(setups, 2)
  assert.equal(disposals, 2)
  assert.equal(renderer.disposeCount, 1)
})

test('Renderer mount failures roll the source document back', async () => {
  const renderer = new Renderer()
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false })
  await world.load(document)
  const before = world.serialize()
  renderer.failNextApply = true
  await assert.rejects(world.updateEntity('label', { content: 'Broken' }), /incremental update failed/)
  assert.equal(world.serialize(), before)
  assert.equal(world.document.entities.find((item) => item.id === 'label').content, 'Safe')
  world.dispose()
})


test('Loading a replacement world rolls back after renderer failure', async () => {
  const renderer = new Renderer()
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false })
  await world.load(document)
  const before = world.serialize()
  renderer.failNextMount = true
  await assert.rejects(world.load({
    version: '0.3',
    building: { floors: [{ id: 'other', elevation: 0, rooms: [{ id: 'other-room', size: [8, 8] }] }] },
  }), /mount failed/)
  assert.equal(world.serialize(), before)
  assert.ok(world.compiled.roomById.has('room'))
  world.dispose()
})

test('Runtime data rolls back after renderer failure', async () => {
  const renderer = new Renderer()
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false })
  await world.load({ ...document, data: { count: 'one' }, entities: [{ id: 'label', type: 'text', content: { $bind: 'count' } }] })
  renderer.failNextApply = true
  await assert.rejects(world.setData('count', 'two'), /incremental update failed/)
  assert.equal(world.getData('count'), 'one')
  world.dispose()
})

test('fast entity update rolls back source and compiled state after renderer failure', async () => {
  class FailIncrementalOnceRenderer extends Renderer {
    failNextIncremental = false
    async applyChanges() {
      if (this.failNextIncremental) {
        this.failNextIncremental = false
        throw new Error('incremental failed')
      }
    }
  }
  const renderer = new FailIncrementalOnceRenderer()
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false })
  await world.load({
    version: '0.6',
    entities: [{ id: 'cube', type: 'box', position: [0, 0, 0] }],
  })
  renderer.failNextIncremental = true
  await assert.rejects(world.updateEntity('cube', { position: [8, 0, 0] }), /incremental failed/)
  assert.deepEqual(world.getSourceDocument().entities[0].position, [0, 0, 0])
  assert.deepEqual(world.compiled.entityById.get('cube').transform.position, [0, 0, 0])
  assert.equal(world.canUndo, false)
  world.dispose()
})


test('Reusable plugin teardown survives replacement rollback and final disposal happens once', async () => {
  const renderer = new Renderer()
  let setups = 0
  let teardowns = 0
  let finalDisposals = 0
  let permanentlyDisposed = false
  const lifecycle = {
    name: 'reusable-lifecycle-test',
    setup() {
      if (permanentlyDisposed) throw new Error('plugin was permanently disposed')
      setups += 1
    },
    teardown() { teardowns += 1 },
    dispose() {
      permanentlyDisposed = true
      finalDisposals += 1
    },
  }
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin(), lifecycle], autoResize: false })
  await world.load(document)
  renderer.failNextMount = true
  await assert.rejects(world.load({
    version: '0.3',
    building: { floors: [{ id: 'other', elevation: 0, rooms: [{ id: 'other-room', size: [8, 8] }] }] },
  }), /mount failed/)
  await world.whenReady()
  assert.equal(world.document.building.floors[0].rooms[0].id, 'room')
  assert.equal(setups, 2)
  assert.equal(teardowns, 1)
  assert.equal(finalDisposals, 0)
  world.dispose()
  assert.equal(teardowns, 2)
  assert.equal(finalDisposals, 1)
})
