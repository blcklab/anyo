import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorldDocument } from '../dist/esm/schema/index.js'

const document = {
  version: '0.2',
  building: {
    floors: [
      {
        id: 'ground',
        elevation: 0,
        rooms: [
          { id: 'lobby', position: [0, 0], size: [10, 8] },
          {
            id: 'gallery',
            size: [6, 4],
            attachTo: { room: 'lobby', wall: 'north', align: 'end' },
          },
        ],
      },
    ],
  },
}

test('normalization solves attached room positions and creates a connection', () => {
  const normalized = normalizeWorldDocument(document)
  const [lobby, gallery] = normalized.building.floors[0].rooms
  assert.deepEqual(lobby.position, [0, 0])
  assert.deepEqual(gallery.position, [2, -6])
  assert.equal(gallery.height, 3.2)
  assert.equal(gallery.wallThickness, 0.14)
  assert.ok(gallery.openings.some((opening) => opening.targetRoom === 'lobby'))
  assert.ok(lobby.openings.some((opening) => opening.targetRoom === 'gallery'))
})

test('numeric opening offsets are measured from the wall start', () => {
  const withDoor = structuredClone(document)
  withDoor.building.floors[0].rooms[0].openings = [
    { type: 'door', wall: 'south', offset: 5, width: 2, height: 2.4 },
  ]
  const normalized = normalizeWorldDocument(withDoor)
  assert.equal(normalized.building.floors[0].rooms[0].openings[0].offset, 0)
})

test('prefabs and repeat expand into uniquely positioned entities', () => {
  const normalized = normalizeWorldDocument({
    version: '0.2',
    prefabs: {
      shelf: { type: 'box', size: [2, 2, 0.5], material: 'metal' },
    },
    building: {
      floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'store', size: [12, 8] }] }],
    },
    entities: [
      {
        id: 'shelf-row',
        use: 'shelf',
        room: 'store',
        position: [-2, 1, 0],
        repeat: { count: 3, axis: 'x', spacing: 2 },
      },
    ],
  })
  assert.deepEqual(normalized.entities.map((entity) => entity.id), ['shelf-row:0', 'shelf-row:1', 'shelf-row:2'])
  assert.deepEqual(normalized.entities.map((entity) => entity.position), [[-2, 1, 0], [0, 1, 0], [2, 1, 0]])
  assert.ok(normalized.entities.every((entity) => entity.type === 'box'))
})
