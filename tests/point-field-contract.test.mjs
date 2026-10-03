import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

function pointWorld(component) {
  return {
    version: '0.9',
    units: 'meters',
    entities: [{ id: 'field', type: 'group', components: [component] }],
  }
}

async function compile(component) {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  try {
    await world.load(pointWorld(component))
    return world.compiled.entities[0]?.components[0]
  } finally {
    await world.disposeAsync()
  }
}

test('generic anyo.pointField validates and compiles directional point data with bounded defaults', async () => {
  const component = await compile({
    type: 'anyo.pointField',
    space: 'directional',
    defaultColor: '#dce8ff',
    defaultSize: 0.8,
    defaultIntensity: 0.6,
    points: [
      { position: [0, 1, 0] },
      { position: [1, 1, 0], color: '#ffffff', size: 1.4, intensity: 1.8 },
    ],
  })
  assert.equal(component.type, 'anyo.pointField')
  assert.equal(component.data.space, 'directional')
  assert.equal(component.data.points.length, 2)
  assert.deepEqual(component.data.points[0], { position: [0, 1, 0], color: '#dce8ff', size: 0.8, intensity: 0.6 })
  assert.deepEqual(component.data.points[1], { position: [1, 1, 0], color: '#ffffff', size: 1.4, intensity: 1.8 })
})

test('generic anyo.pointField rejects unsafe or invalid point data without changing World 0.9 schema', async () => {
  const cases = [
    [{ type: 'anyo.pointField', space: 'directional', points: [{ position: [0, 0, 0] }] }, /ANYO_POINT_FIELD_DIRECTION_ZERO/],
    [{ type: 'anyo.pointField', points: [{ position: [0, 1, 0], size: 0 }] }, /ANYO_POINT_FIELD_SIZE_INVALID/],
    [{ type: 'anyo.pointField', points: [{ position: [0, 1, 0], intensity: -1 }] }, /ANYO_POINT_FIELD_INTENSITY_INVALID/],
    [{ type: 'anyo.pointField', space: 'screen', points: [{ position: [0, 1, 0] }] }, /ANYO_POINT_FIELD_SPACE_INVALID/],
  ]
  for (const [component, expected] of cases) {
    const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
    try {
      await assert.rejects(() => world.load(pointWorld(component)), expected)
    } finally {
      await world.disposeAsync()
    }
  }
})

class RuntimePointCamera {
  position = [0, 1.65, 0]
  rotation = [0, 0]
  getPosition() { return this.position }
  setPosition(value) { this.position = [...value] }
  getRotation() { return this.rotation }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class RuntimePointRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new RuntimePointCamera()
  updates = []
  mounts = 0
  async mount() { this.mounts += 1 }
  applyRuntimePointFields(updates) { this.updates.push(...updates) }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

test('runtime point-field updates are provider-driven, document-neutral, resettable, and renderer-replacement safe', async () => {
  const renderer = new RuntimePointRenderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false })
  const authored = {
    type: 'anyo.pointField',
    id: 'stars',
    space: 'directional',
    defaultColor: '#dce8ff',
    defaultSize: 0.8,
    defaultIntensity: 0.6,
    points: [{ position: [0, 1, 0] }],
  }

  try {
    await world.load(pointWorld(authored))
    const serializedBefore = world.serialize()

    world.setPointFieldPoints('field', [
      { position: [0, 0, 2], color: '#ffffff', size: 1.4, intensity: 2 },
      { position: [2, 0, 0] },
    ], 'stars')

    assert.equal(renderer.updates.length, 1)
    assert.equal(renderer.updates[0].entityId, 'field')
    assert.equal(renderer.updates[0].componentId, 'stars')
    assert.equal(renderer.updates[0].space, 'directional')
    assert.deepEqual(renderer.updates[0].points[0], { position: [0, 0, 2], color: '#ffffff', size: 1.4, intensity: 2 })
    assert.deepEqual(renderer.updates[0].points[1], { position: [2, 0, 0], color: '#dce8ff', size: 0.8, intensity: 0.6 })
    assert.equal(world.serialize(), serializedBefore, 'runtime provider updates must not mutate authored JSON')

    world.setPointFieldPoints('field', [], 'stars')
    assert.equal(renderer.updates.at(-1).points.length, 0, 'runtime updates may temporarily clear a field')

    const replacement = new RuntimePointRenderer()
    await world.attachRenderer(replacement)
    assert.equal(replacement.updates.length, 1, 'runtime point override must be reapplied after renderer replacement')
    assert.equal(replacement.updates[0].points.length, 0)

    assert.equal(world.resetPointFieldPoints('field', 'stars'), true)
    assert.equal(replacement.updates.at(-1).points.length, 1)
    assert.deepEqual(replacement.updates.at(-1).points[0], { position: [0, 1, 0], color: '#dce8ff', size: 0.8, intensity: 0.6 })
    assert.equal(world.resetPointFieldPoints('field', 'stars'), false)
  } finally {
    await world.disposeAsync()
  }
})

test('runtime directional point-field updates reject invalid vectors and point bounds', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  try {
    await world.load(pointWorld({ type: 'anyo.pointField', id: 'stars', space: 'directional', points: [{ position: [0, 1, 0] }] }))
    assert.throws(() => world.setPointFieldPoints('field', [{ position: [0, 0, 0] }], 'stars'), /must be non-zero/)
    assert.throws(() => world.setPointFieldPoints('field', [{ position: [1, 0, 0], size: 0 }], 'stars'), /positive finite/)
    assert.throws(() => world.setPointFieldPoints('field', [{ position: [1, 0, 0], intensity: -1 }], 'stars'), /non-negative finite/)
  } finally {
    await world.disposeAsync()
  }
})
