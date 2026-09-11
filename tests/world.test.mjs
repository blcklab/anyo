import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { buildingPlugin } from '../dist/esm/building/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

class MockCamera {
  position = [0, 1.65, 0]
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
  disposed = false
  async mount(compiled) { this.mounted = compiled; this.mountCount += 1 }
  async applyChanges(_changes, compiled) { this.mounted = compiled }
  async updatePrimitive(primitive) {
    if (!this.mounted) return
    const index = this.mounted.primitives.findIndex((item) => item.id === primitive.id)
    if (index >= 0) this.mounted.primitives[index] = primitive
  }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() { this.disposed = true }
}

function createTestWorld(renderer = new MockRenderer()) {
  return {
    renderer,
    world: createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false }),
  }
}

const baseDocument = {
  version: '0.2',
  data: { profile: { title: 'Creator' } },
  building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [6, 6] }] }] },
  entities: [
    { id: 'title', type: 'text', room: 'room', position: [0, 2, 0], content: 'Before' },
    {
      id: 'bound-title',
      type: 'text',
      room: 'room',
      position: [0, 1, 0],
      content: { $bind: 'profile.title', format: 'Role: {value}' },
    },
  ],
}

test('World migrates 0.2, compiles, and updates entities atomically', async () => {
  const { world, renderer } = createTestWorld()
  await world.load(baseDocument)
  assert.ok(renderer.mounted)
  assert.equal(world.getSourceDocument().version, '0.7')
  await world.updateEntity('title', { content: 'After' })
  assert.equal(renderer.mounted.primitives.find((item) => item.entityId === 'title').text, 'After')
  assert.equal(world.canUndo, true)
  world.dispose()
  assert.equal(renderer.disposed, true)
})

test('Runtime data updates bindings without changing serialized data until committed', async () => {
  const { world, renderer } = createTestWorld()
  await world.load(baseDocument)
  await world.setData('profile.title', 'Engineer')
  assert.equal(renderer.mounted.primitives.find((item) => item.entityId === 'bound-title').text, 'Role: Engineer')
  assert.equal(world.getData('profile.title'), 'Engineer')
  assert.equal(JSON.parse(world.serialize()).data.profile.title, 'Creator')
  await world.commitRuntimeData()
  assert.equal(JSON.parse(world.serialize()).data.profile.title, 'Engineer')
  world.dispose()
})


test('Document edits preserve uncommitted runtime data', async () => {
  const { world, renderer } = createTestWorld()
  await world.load(baseDocument)
  await world.setData('profile.title', 'Runtime Engineer')
  await world.updateEntity('title', { content: 'Updated title' })
  assert.equal(world.getData('profile.title'), 'Runtime Engineer')
  assert.equal(renderer.mounted.primitives.find((item) => item.entityId === 'bound-title').text, 'Role: Runtime Engineer')
  world.dispose()
})

test('Transactions create one history entry and support undo and redo', async () => {
  const { world } = createTestWorld()
  await world.load(baseDocument)
  await world.transaction((document) => {
    document.entities[0].content = 'Changed'
    document.environment = { background: '#101010' }
  }, 'Change portfolio')
  assert.equal(world.document.entities.find((item) => item.id === 'title').content, 'Changed')
  assert.equal(world.canUndo, true)
  assert.equal(await world.undo(), true)
  assert.equal(world.document.entities.find((item) => item.id === 'title').content, 'Before')
  assert.equal(await world.redo(), true)
  assert.equal(world.document.entities.find((item) => item.id === 'title').content, 'Changed')
  world.dispose()
})

test('Invalid patches are atomic and preserve the mounted world', async () => {
  const { world, renderer } = createTestWorld()
  await world.load(baseDocument)
  const mountsBefore = renderer.mountCount
  const serializedBefore = world.serialize()
  await assert.rejects(
    world.patch({ operation: 'replace', path: '/building/floors/0/rooms/0/size', value: [-1, 5] }),
    /Room size must be/,
  )
  assert.equal(world.serialize(), serializedBefore)
  assert.equal(renderer.mountCount, mountsBefore)
  world.dispose()
})

test('Concurrent mutations are serialized in call order', async () => {
  const { world } = createTestWorld()
  await world.load(baseDocument)
  await Promise.all([
    world.updateEntity('title', { content: 'First' }),
    world.updateEntity('title', { content: 'Second' }),
  ])
  assert.equal(world.document.entities.find((item) => item.id === 'title').content, 'Second')
  world.dispose()
})

test('fast entity patch path preserves JSON Patch replace and remove existence rules', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false })
  await world.load({ version: '0.6', entities: [{ id: 'cube', type: 'box' }] })
  const before = world.serialize()
  await assert.rejects(
    world.patch({ operation: 'replace', path: '/entities/0/visible', value: false }),
    /Cannot replace missing path/,
  )
  await assert.rejects(
    world.patch({ operation: 'remove', path: '/entities/0/visible' }),
    /Cannot remove missing path/,
  )
  assert.equal(world.serialize(), before)
  assert.equal(world.canUndo, false)
  world.dispose()
})
