import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { buildingPlugin } from '../dist/esm/building/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { migrateWorldDocument } from '../dist/esm/migrations/index.js'

class Camera {
  position = [0, 1.65, 0]
  rotation = [0, 0]
  getPosition() { return [...this.position] }
  setPosition(value) { this.position = [...value] }
  getRotation() { return [...this.rotation] }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}
class Renderer {
  canvas = { getBoundingClientRect: () => ({ width: 1, height: 1 }) }
  camera = new Camera()
  async mount() {}
  async applyChanges() {}
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}
const document = {
  version: '0.3.1',
  data: { safe: { value: 1 } },
  building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [4, 4] }] }] },
  entities: [{ id: 'label', type: 'text', content: { $bind: 'safe.value' } }],
}
function makeWorld() {
  const renderer = new Renderer()
  return createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false })
}

test('JSON patches reject prototype-pollution paths atomically', async () => {
  const world = makeWorld()
  await world.load(document)
  const before = world.serialize()
  for (const path of ['/__proto__/polluted', '/data/constructor/prototype/polluted', '/data/prototype/polluted']) {
    await assert.rejects(world.patch({ operation: 'add', path, value: true }), /forbidden|Unsafe/)
    assert.equal(world.serialize(), before)
    assert.equal(world.canUndo, false)
    assert.equal(({}).polluted, undefined)
  }
  await assert.rejects(world.patch({ operation: 'add', path: '/data/~2bad', value: true }), /Malformed JSON Pointer/)
  world.dispose()
})

test('runtime data and reads reject dangerous paths without pollution', async () => {
  const world = makeWorld()
  await world.load(document)
  for (const path of ['__proto__.polluted', 'constructor.prototype.polluted', 'safe.prototype.value']) {
    await assert.rejects(world.setData(path, true), /forbidden|Unsafe/)
    assert.throws(() => world.getData(path), /forbidden|Unsafe/)
    assert.equal(({}).polluted, undefined)
  }
  assert.equal(world.getData('safe.value'), 1)
  world.dispose()
})

test('transactions, entity updates, and migrations reject unsafe object graphs', async () => {
  const world = makeWorld()
  await world.load(document)
  const malicious = JSON.parse('{"__proto__":{"polluted":true}}')
  await assert.rejects(world.transaction((next) => { next.data = malicious }), /forbidden|Unsafe/)
  await assert.rejects(world.updateEntity('label', { data: malicious }), /forbidden|Unsafe/)
  assert.throws(() => migrateWorldDocument({ ...document, data: malicious }), /forbidden|Unsafe/)
  assert.equal(({}).polluted, undefined)
  assert.equal(world.canUndo, false)
  world.dispose()
})
