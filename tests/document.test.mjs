import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneWorldDocument, serializeWorldDocument, findEntityInDocument } from '../dist/esm/document/index.js'
import { migrateWorldDocument } from '../dist/esm/migrations/index.js'
import { inspectWorldDocument, AnyoValidationError, validateWorldDocument } from '../dist/esm/schema/index.js'

const legacy = {
  $schema: 'https://example.com/world-0.2.schema.json',
  version: '0.2',
  extensions: { 'com.example': { keep: true } },
  building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [5, 5] }] }] },
  entities: [{ id: 'group', type: 'group', children: [{ id: 'child', type: 'box' }] }],
}

test('Migration upgrades 0.2 while preserving extension data', () => {
  const result = migrateWorldDocument(legacy)
  assert.equal(result.document.version, '0.7')
  assert.match(result.document.$schema, /world-0\.7/)
  assert.deepEqual(result.document.extensions, legacy.extensions)
  assert.equal(result.changed, true)
})

test('Stable serialization is deterministic without reordering arrays', () => {
  const first = serializeWorldDocument({ ...legacy, version: '0.3' })
  const second = serializeWorldDocument({ building: legacy.building, version: '0.3', entities: legacy.entities, extensions: legacy.extensions, $schema: legacy.$schema })
  assert.equal(first, second)
  assert.ok(first.endsWith('\n'))
})

test('Entity lookup searches nested children', () => {
  assert.equal(findEntityInDocument(legacy, 'child')?.type, 'box')
})

test('Structured validation returns codes and paths', () => {
  const invalid = structuredClone(legacy)
  invalid.version = '0.3'
  invalid.building.floors[0].rooms[0].size = [-1, 5]
  const result = inspectWorldDocument(invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((item) => item.code === 'ROOM_SIZE_INVALID' && item.path.endsWith('/size')))
  assert.throws(() => validateWorldDocument(invalid), AnyoValidationError)
})


test('World document cloning accepts reactive proxy-shaped documents', () => {
  const proxied = new Proxy({
    version: '0.6',
    metadata: { title: 'Proxy-safe world' },
    entities: [{ id: 'box', type: 'box', transform: { position: [1, 2, 3] } }],
  }, {})

  assert.throws(() => structuredClone(proxied), { name: 'DataCloneError' })
  const cloned = cloneWorldDocument(proxied)

  assert.deepEqual(cloned, {
    entities: [{ id: 'box', transform: { position: [1, 2, 3] }, type: 'box' }],
    metadata: { title: 'Proxy-safe world' },
    version: '0.6',
  })
  assert.notEqual(cloned, proxied)
  assert.notEqual(cloned.entities, proxied.entities)
})
