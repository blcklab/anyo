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
