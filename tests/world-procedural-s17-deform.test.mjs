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
  async mount() {}
  async applyChanges() {}
  applyRuntimeTransforms(updates) { this.runtimeUpdates.push(...updates) }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

const sculpted = {
  kind: 'bend',
  source: {
    kind: 'twist',
    source: {
      kind: 'taper',
      source: { kind: 'lathe', profile: [[0.35, 0], [0.65, 0.45], [0.45, 1.5], [0.2, 2.4]], segments: 32 },
      axis: 'y', startScale: 1, endScale: 0.7,
    },
    axis: 'y', angle: 0.45,
  },
  axis: 'y', direction: 'x', angle: 0.3,
}

test('S17 schema-0.8 JSON composes lathe+taper+twist+bend through ResourceGraph and shares the final resource', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false })
  await world.load({
    version: '0.8',
    geometries: { sculpted },
    materials: { ceramic: { baseColor: '#d6d0c4', roughness: 0.65 } },
    entities: [
      { id: 'sculpture-a', type: 'geometry', geometry: 'sculpted', material: 'ceramic', position: [-2, 0, 0] },
      { id: 'sculpture-b', type: 'geometry', geometry: 'sculpted', material: 'ceramic', position: [2, 0, 0] },
    ],
  })
  const graph = world.compiled.resourceGraph
  assert.ok(graph)
  const geometries = graph.list('geometry')
  assert.deepEqual(geometries.map(node => node.definition.kind).sort(), ['bend', 'lathe', 'taper', 'twist'])
  const instances = graph.list('instance')
  assert.equal(instances.length, 2)
  assert.equal(instances[0].source, instances[1].source)
  const key = graph.key
  world.transforms.set('sculpture-a', { position: [10, 0, 0] }, { source: 's17-test' })
  await world.flushRuntimeTransforms()
  assert.equal(world.compiled.resourceGraph.key, key)
  assert.ok(renderer.runtimeUpdates.some(update => update.resourceInstanceId === 'sculpture-a'))
  world.dispose()
})

test('S17 composed geometry continues to use S15 bounds collision without a special collider path', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await world.load({ version: '0.8', entities: [{ id: 'sculpted-solid', type: 'geometry', geometry: sculpted, collision: true }] })
  assert.equal(world.compiled.colliders.length, 1)
  assert.equal(world.compiled.colliders[0].id, 'procedural:sculpted-solid:bounds')
  world.dispose()
})
