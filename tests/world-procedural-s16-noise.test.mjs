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

const noiseShape = {
  kind: 'noise',
  source: { kind: 'sphere', radius: 3, segments: 24, rings: 12 },
  seed: 4242,
  frequency: 0.5,
  strength: 0.4,
  octaves: 3,
  lacunarity: 2,
  persistence: 0.5,
}

test('S16 JSON-native noise compiles through S14 ResourceGraph, reuses geometry, and remains runtime-transformable', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false })
  await world.load({
    version: '0.8',
    geometries: { organicShape: noiseShape },
    materials: { soft: { baseColor: '#eeeeee', roughness: 0.9 } },
    entities: [
      { id: 'organic-a', type: 'geometry', geometry: 'organicShape', material: 'soft', position: [-4, 5, 0] },
      { id: 'organic-b', type: 'geometry', geometry: 'organicShape', material: 'soft', position: [4, 6, 0] },
    ],
  })

  const graph = world.compiled.resourceGraph
  assert.ok(graph)
  const geometries = graph.list('geometry')
  assert.equal(geometries.length, 2, 'source sphere + noise wrapper should be explicit resources')
  const noiseResource = geometries.find((node) => node.definition.kind === 'noise')
  const sourceResource = geometries.find((node) => node.definition.kind === 'sphere')
  assert.ok(noiseResource)
  assert.ok(sourceResource)
  assert.deepEqual(noiseResource.dependencies, [sourceResource.id])
  const instances = graph.list('instance')
  assert.equal(instances.length, 2)
  assert.equal(instances[0].source, noiseResource.id)
  assert.equal(instances[1].source, noiseResource.id)

  const graphKey = graph.key
  world.transforms.set('organic-a', { position: [12, 7, -3] }, { source: 's16-test' })
  await world.flushRuntimeTransforms()
  assert.equal(world.compiled.resourceGraph.key, graphKey, 'moving organic geometry must not regenerate noise geometry')
  assert.ok(renderer.runtimeUpdates.some((update) => update.resourceInstanceId === 'organic-a'))
  world.dispose()
})

test('S16 noise geometry participates in existing S15 bounds collision without a new physics path', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await world.load({
    version: '0.8',
    entities: [{ id: 'organic-solid', type: 'geometry', geometry: noiseShape, collision: true }],
  })
  assert.equal(world.compiled.colliders.length, 1)
  assert.equal(world.compiled.colliders[0].entityId, 'organic-solid')
  assert.equal(world.compiled.colliders[0].id, 'procedural:organic-solid:bounds')
  assert.ok(world.compiled.colliders[0].bounds.max[0] > 3 || world.compiled.colliders[0].bounds.min[0] < -3)
  world.dispose()
})
