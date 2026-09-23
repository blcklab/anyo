import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

class MockCamera {
  getPosition() { return [0, 1.65, 0] }
  setPosition() {}
  getRotation() { return [0, 0] }
  setRotation() {}
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}
class MockRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  runtimeUpdates = []
  async mount(compiled) { this.compiled = compiled }
  async applyChanges(_changes, compiled) { this.compiled = compiled }
  applyRuntimeTransforms(updates) { this.runtimeUpdates.push(...updates) }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}
function makeWorld() {
  const renderer = new MockRenderer()
  return { renderer, world: createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false }) }
}

test('S20 schema-0.8 static GLB model entities become shared AssetResource instances alongside procedural geometry', async () => {
  const { world } = makeWorld()
  await world.load({
    version: '0.8',
    assets: {
      console: { type: 'model', format: 'glb', src: './assets/console.glb' },
    },
    geometries: { plinth: { kind: 'roundedBox', size: [2.4, 0.3, 1.4], radius: 0.08 } },
    entities: [
      { id: 'plinth', type: 'geometry', geometry: 'plinth', position: [0, 0.15, 0] },
      { id: 'console-a', type: 'model', asset: 'console', position: [-2, 0.4, 0] },
      { id: 'console-b', type: 'model', asset: 'console', position: [2, 0.4, 0] },
    ],
  })
  const graph = world.compiled.resourceGraph
  assert.ok(graph)
  assert.equal(graph.list('asset').length, 1)
  assert.equal(graph.list('geometry').length, 1)
  assert.equal(graph.list('instance').length, 3)
  const a = graph.get('instance:console-a')
  const b = graph.get('instance:console-b')
  assert.equal(a.kind, 'instance')
  assert.equal(b.kind, 'instance')
  assert.equal(a.source, b.source, 'both model instances must reuse one content-addressed AssetResource')
  assert.equal(graph.get(a.source).kind, 'asset')
  assert.equal(world.compiled.entityById.get('console-a').primitiveIds.length, 0)
  assert.deepEqual(world.compiled.entityById.get('console-a').resourceInstanceIds, ['console-a'])
  assert.equal(world.compiled.primitives.filter((primitive) => primitive.kind === 'model').length, 0)
  world.dispose()
})

test('S20 ResourceGraph-backed model transforms use the existing runtime-transform path without graph rebuilds', async () => {
  const { world, renderer } = makeWorld()
  await world.load({
    version: '0.8',
    assets: { prop: { type: 'model', format: 'glb', src: './prop.glb' } },
    entities: [{ id: 'prop', type: 'model', asset: 'prop', position: [1, 0, 2] }],
  })
  const graph = world.compiled.resourceGraph
  const key = graph.key
  world.transforms.set('prop', { position: [7, 1, -3] }, { source: 's20-test' })
  await world.flushRuntimeTransforms()
  const update = renderer.runtimeUpdates.find((entry) => entry.resourceInstanceId === 'prop')
  assert.ok(update)
  assert.deepEqual(update.transform.position, [7, 1, -3])
  assert.equal(world.compiled.resourceGraph.key, key)
  world.dispose()
})

test('S20 VRM and animated model assets remain on the proven legacy/Player ownership path', async () => {
  const vrm = makeWorld()
  await vrm.world.load({
    version: '0.8',
    assets: { avatar: { type: 'model', format: 'vrm', src: './avatar.vrm' } },
    entities: [{ id: 'avatar', type: 'model', asset: 'avatar' }],
  })
  assert.equal(vrm.world.compiled.resourceGraph, undefined)
  assert.equal(vrm.world.compiled.primitives.length, 1)
  assert.equal(vrm.world.compiled.primitives[0].assetFormat, 'vrm')
  vrm.world.dispose()

  const animated = makeWorld()
  await animated.world.load({
    version: '0.8',
    assets: { actor: { type: 'animated-model', format: 'glb', src: './actor.glb' } },
    entities: [{ id: 'actor', type: 'model', asset: 'actor' }],
  })
  assert.equal(animated.world.compiled.resourceGraph, undefined)
  assert.equal(animated.world.compiled.primitives.length, 1)
  assert.equal(animated.world.compiled.primitives[0].assetType, 'animated-model')
  animated.world.dispose()
})

test('S20 existing 0.7 static models retain legacy primitive semantics', async () => {
  const { world } = makeWorld()
  await world.load({
    version: '0.7',
    assets: { prop: { type: 'model', format: 'glb', src: './prop.glb' } },
    entities: [{ id: 'prop', type: 'model', asset: 'prop' }],
  })
  assert.equal(world.compiled.resourceGraph, undefined)
  assert.equal(world.compiled.primitives.length, 1)
  assert.equal(world.compiled.primitives[0].kind, 'model')
  world.dispose()
})

test('S20 ResourceGraph-backed static model collision remains an explicit authored bounds collider', async () => {
  const { world } = makeWorld()
  await world.load({
    version: '0.8',
    assets: { prop: { type: 'model', format: 'glb', src: './prop.glb' } },
    entities: [{ id: 'prop', type: 'model', asset: 'prop', size: [3, 2, 4], position: [2, 1, -1], collision: true }],
  })
  const collider = world.compiled.colliders.find((entry) => entry.entityId === 'prop')
  assert.ok(collider)
  assert.deepEqual(collider.bounds.min, [0.5, 0, -3])
  assert.deepEqual(collider.bounds.max, [3.5, 2, 1])
  world.dispose()
})
