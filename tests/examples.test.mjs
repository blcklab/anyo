import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeWorldDocument } from '../dist/esm/schema/index.js'
import { compileBuilding } from '../dist/esm/building/index.js'
import { compileEntities } from '../dist/esm/entities/index.js'

function output() {
  return { primitives: [], colliders: [], portals: [], rooms: [], triggers: [] }
}

for (const name of ['portfolio', 'virtual-store', 'vr-room', 'web-surface', 'web-surface-targets', 'runtime-systems']) {
  test(`${name} example validates and compiles`, async () => {
    const source = JSON.parse(await readFile(new URL(`../examples/${name}/world.json`, import.meta.url), 'utf8'))
    const document = normalizeWorldDocument(source)
    const compiled = output()
    compileBuilding(document, compiled)
    compileEntities(document, compiled)
    assert.equal(document.version, '0.6')
    assert.ok(compiled.rooms.length > 0)
    assert.ok(compiled.primitives.length > 0)
    assert.ok(compiled.colliders.length > 0)
  })
}

test('a repeated catalog compiles into unique entity primitives', () => {
  const document = normalizeWorldDocument({
    version: '0.3',
    prefabs: { product: { type: 'box', size: [0.4, 0.4, 0.4] } },
    building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'store', size: [40, 40] }] }] },
    entities: [{
      id: 'catalog',
      use: 'product',
      room: 'store',
      repeat: { count: 500, axis: 'x', spacing: 0.5, start: -20 },
    }],
  })
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  const products = compiled.primitives.filter((primitive) => primitive.entityId?.startsWith('catalog:'))
  assert.equal(products.length, 500)
  assert.equal(new Set(products.map((primitive) => primitive.id)).size, 500)
})
