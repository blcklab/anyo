import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld, entitiesPlugin, inspectWorldDocument } from '../dist/esm/index.js'

test('map components preserve geographic and editable source data', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()] })
  try {
    await world.load({
      version: '0.7', units: 'meters',
      entities: [
        { id: 'cell', type: 'group', components: [{
          type: 'anyo.map', provider: 'openstreetmap',
          origin: { latitude: 14.6, longitude: 120.98 },
          cell: { zoom: 17, x: 109000, y: 52000 },
          attribution: '© OpenStreetMap contributors'
        }] },
        { id: 'building', type: 'group', components: [{
          type: 'anyo.mapFeature', featureType: 'building', source: 'openstreetmap',
          sourceId: 'way/1', footprint: [[0, 0], [10, 0], [10, 8], [0, 8]],
          height: 9, minHeight: 0, generated: true, layer: 'base'
        }] }
      ]
    })
    assert.equal(world.compiled.entities[0]?.components[0]?.type, 'anyo.map')
    assert.equal(world.compiled.entities[1]?.components[0]?.data.sourceId, 'way/1')
  } finally {
    await world.disposeAsync()
  }
})

test('map validation rejects invalid coordinates, footprints, and heights', () => {
  const result = inspectWorldDocument({
    version: '0.7',
    entities: [
      { id: 'cell', type: 'group', components: [{ type: 'anyo.map', origin: { latitude: 100, longitude: 0 } }] },
      { id: 'bad', type: 'group', components: [{ type: 'anyo.mapFeature', featureType: 'building', footprint: [[0, 0], [1, 0]], height: -1 }] }
    ]
  })
  assert.equal(result.valid, false)
  const codes = result.errors.map(issue => issue.code)
  assert.ok(codes.includes('MAP_LATITUDE_INVALID'))
  assert.ok(codes.includes('MAP_FOOTPRINT_INVALID'))
  assert.ok(codes.includes('MAP_HEIGHT_INVALID'))
})
