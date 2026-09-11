import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorldDocument } from '../dist/esm/schema/index.js'
import { compileBuilding, decomposeWall } from '../dist/esm/building/index.js'

function output() {
  return { primitives: [], colliders: [], portals: [], rooms: [], triggers: [] }
}

test('wall decomposition subtracts a door and a window', () => {
  const cells = decomposeWall(10, 3, [
    { id: 'door', type: 'door', wall: 'north', offset: 0, width: 2, height: 2.4, elevation: 0, open: true, collision: false },
    { id: 'window', type: 'window', wall: 'north', offset: -3, width: 1.5, height: 1, elevation: 1, open: true, collision: false },
  ])
  assert.ok(cells.length > 4)
  for (const cell of cells) {
    const insideDoor = Math.abs(cell.tangentCenter) < 1 && cell.verticalCenter < 2.4
    const insideWindow = cell.tangentCenter > -3.75 && cell.tangentCenter < -2.25 && cell.verticalCenter > 1 && cell.verticalCenter < 2
    assert.equal(insideDoor || insideWindow, false)
  }
})

test('building compiler creates rooms, a portal, colliders, and no duplicate child shared wall', () => {
  const document = normalizeWorldDocument({
    version: '0.2',
    building: {
      floors: [{
        id: 'ground',
        elevation: 0,
        rooms: [
          { id: 'lobby', position: [0, 0], size: [10, 8] },
          { id: 'gallery', size: [6, 4], attachTo: { room: 'lobby', wall: 'north' } },
        ],
      }],
    },
  })
  const compiled = output()
  compileBuilding(document, compiled)
  assert.equal(compiled.rooms.length, 2)
  assert.equal(compiled.portals.length, 1)
  assert.ok(compiled.colliders.some((collider) => collider.kind === 'floor'))
  assert.equal(compiled.primitives.some((primitive) => primitive.id.startsWith('gallery:wall:south:')), false)
})

test('east and west walls use rotation for rendering but axis-aligned collider dimensions', () => {
  const document = normalizeWorldDocument({
    version: '0.2',
    building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [10, 6] }] }] },
  })
  const compiled = output()
  compileBuilding(document, compiled)
  const east = compiled.primitives.find((primitive) => primitive.id.startsWith('room:wall:east:'))
  const eastCollider = compiled.colliders.find((collider) => collider.id === `${east.id}:collider`)
  assert.deepEqual(east.size, [6, 3.2, 0.14])
  assert.equal(east.transform.rotation[1], -Math.PI / 2)
  assert.ok(eastCollider.bounds.max[2] - eastCollider.bounds.min[2] > 5.9)
  assert.ok(eastCollider.bounds.max[0] - eastCollider.bounds.min[0] < 0.2)
})

test('stairs cut openings through the upper floor and lower ceiling', () => {
  const document = normalizeWorldDocument({
    version: '0.2',
    building: {
      floors: [
        {
          id: 'ground',
          elevation: 0,
          rooms: [{ id: 'ground-room', position: [0, 0], size: [14, 12] }],
          stairs: [{ id: 'stairs', fromFloor: 'ground', toFloor: 'upper', position: [-5, 4], direction: 'north', run: 5, width: 1.4 }],
        },
        {
          id: 'upper',
          elevation: 3.6,
          rooms: [{ id: 'upper-room', position: [0, 0], size: [14, 12] }],
        },
      ],
    },
  })
  const compiled = output()
  compileBuilding(document, compiled)
  const upperFloor = compiled.primitives.filter((primitive) => primitive.id.startsWith('upper-room:floor'))
  const lowerCeiling = compiled.primitives.filter((primitive) => primitive.id.startsWith('ground-room:ceiling'))
  assert.ok(upperFloor.length > 1)
  assert.ok(lowerCeiling.length > 1)
  const footprintCenter = [-5, 1.5]
  const coveringFloor = compiled.colliders.find((collider) => (
    collider.kind === 'floor' &&
    collider.roomId === 'upper-room' &&
    footprintCenter[0] > collider.bounds.min[0] &&
    footprintCenter[0] < collider.bounds.max[0] &&
    footprintCenter[1] > collider.bounds.min[2] &&
    footprintCenter[1] < collider.bounds.max[2]
  ))
  assert.equal(coveringFloor, undefined)
  assert.ok(compiled.portals.some((portal) => portal.id === 'portal:stair:stairs'))
})

test('windows render as thin panes and remain solid by default', () => {
  const document = normalizeWorldDocument({
    version: '0.2',
    building: {
      floors: [{
        id: 'ground',
        elevation: 0,
        rooms: [{
          id: 'room',
          size: [8, 6],
          openings: [{ id: 'front-window', type: 'window', wall: 'south', offset: 'center', width: 2, height: 1.4, elevation: 0.8 }],
        }],
      }],
    },
  })
  const compiled = output()
  compileBuilding(document, compiled)
  const pane = compiled.primitives.find((primitive) => primitive.id === 'room:window:front-window')
  assert.ok(pane)
  assert.ok(pane.tags.includes('window'))
  assert.ok(compiled.colliders.some((collider) => collider.id === 'room:window:front-window:collider'))
})
