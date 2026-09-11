import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorldDocument } from '../dist/esm/schema/index.js'
import { compileBuilding } from '../dist/esm/building/index.js'
import { compileEntities, resolveSurfaceTransform } from '../dist/esm/entities/index.js'

function output() {
  return { primitives: [], colliders: [], portals: [], rooms: [], triggers: [] }
}

const document = normalizeWorldDocument({
  version: '0.2',
  building: {
    floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', position: [2, 3], size: [10, 8], height: 4 }] }],
  },
  entities: [
    {
      id: 'title',
      type: 'text',
      content: 'Hello',
      size: [3, 1],
      surface: { room: 'room', wall: 'north', anchor: 'center', offset: [1, 0.5] },
    },
    {
      id: 'zone',
      type: 'trigger',
      room: 'room',
      position: [0, 1, 0],
      trigger: { size: [2, 2, 2], onEnter: [{ event: 'hello' }] },
    },
  ],
})

test('surface attachment calculates wall position and orientation', () => {
  const transform = resolveSurfaceTransform(document.entities[0], document)
  assert.equal(transform.position[0], 3)
  assert.ok(transform.position[2] > -0.95 && transform.position[2] < -0.9)
  assert.equal(transform.position[1], 2.5)
  assert.equal(transform.rotation[1], 0)
})

test('entity compiler adds renderable entities and trigger bounds', () => {
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  assert.ok(compiled.primitives.some((primitive) => primitive.entityId === 'title' && primitive.kind === 'text'))
  assert.equal(compiled.triggers.length, 1)
  assert.ok(compiled.rooms[0].primitiveIds.includes('entity:title'))
})

test('groups compose child transforms without adding the room origin twice', () => {
  const grouped = normalizeWorldDocument({
    version: '0.2',
    assets: { model: { src: '/model.glb', scale: 2 } },
    building: {
      floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', position: [10, 10], size: [8, 8] }] }],
    },
    entities: [
      {
        id: 'display',
        type: 'group',
        room: 'room',
        position: [1, 0, 0],
        rotation: [0, Math.PI / 2, 0],
        children: [{ id: 'product', type: 'model', asset: 'model', position: [0, 1, -2] }],
      },
    ],
  })
  const compiled = output()
  compileBuilding(grouped, compiled)
  compileEntities(grouped, compiled)
  const product = compiled.primitives.find((primitive) => primitive.entityId === 'display/product')
  assert.ok(product)
  assert.ok(product.transform.position[0] > 8.9 && product.transform.position[0] < 9.1)
  assert.equal(product.transform.position[2], 10)
  assert.deepEqual(product.transform.scale, [2, 2, 2])
})
