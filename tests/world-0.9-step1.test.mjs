import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { createWorldSchema, inspectWorldDocument, normalizeWorldDocument } from '../dist/esm/schema/index.js'
import { migrateWorldDocument } from '../dist/esm/migrations/index.js'

const schema08Url = new URL('../schemas/world-0.8.schema.json', import.meta.url)
const schema09Url = new URL('../schemas/world-0.9.schema.json', import.meta.url)

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
  mounted = null
  async mount(compiled) { this.mounted = compiled }
  async applyChanges(_changes, compiled) { this.mounted = compiled }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

function baseline(version) {
  return {
    version,
    units: 'meters',
    materials: { graphite: { baseColor: '#20242b', roughness: 0.65 } },
    geometries: { desk: { kind: 'roundedBox', size: [5.4, 1.05, 1.1], radius: 0.08, segments: 4 } },
    compositions: { pair: { children: [{ id: 'left', type: 'geometry', geometry: 'desk', material: 'graphite' }] } },
    entities: [{ id: 'desk-a', type: 'geometry', geometry: 'desk', material: 'graphite' }],
  }
}

test('World 0.8 schema remains available with its original identity and version pattern', async () => {
  const schema08 = JSON.parse(await readFile(schema08Url, 'utf8'))
  assert.equal(schema08.$id, 'https://anyo.blcklab.dev/schemas/world-0.8.schema.json')
  assert.equal(schema08.title, 'Anyo World 0.8')
  assert.equal(schema08.properties.version.pattern, '^0\\.8(?:\\.|$)')
})

test('World 0.9 schema is a 0.8-equivalent baseline with its own identity and version pattern', async () => {
  const schema08 = JSON.parse(await readFile(schema08Url, 'utf8'))
  const schema09 = JSON.parse(await readFile(schema09Url, 'utf8'))
  assert.equal(schema09.$id, 'https://anyo.blcklab.dev/schemas/world-0.9.schema.json')
  assert.equal(schema09.title, 'Anyo World 0.9')
  assert.equal(schema09.properties.version.pattern, '^0\\.9(?:\\.|$)')
  const normalize = (schema) => {
    const copy = structuredClone(schema)
    delete copy.$id
    delete copy.title
    delete copy.description
    copy.properties.version.pattern = '<version>'
    return copy
  }
  assert.deepEqual(normalize(schema09), normalize(schema08))
})

test('World 0.9 passes semantic validation and normalization with the existing 0.8 authoring surface', () => {
  const document = baseline('0.9')
  const validation = inspectWorldDocument(document)
  assert.equal(validation.valid, true, validation.errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  const normalized = normalizeWorldDocument(document)
  assert.equal(normalized.version, '0.9')
  assert.equal(normalized.entities[0].geometry, 'desk')
  assert.ok(normalized.compositions.pair)
})

test('World 0.9 migration is pass-through except for the stable default revision', () => {
  const document = baseline('0.9')
  const result = migrateWorldDocument(document)
  assert.equal(result.from, '0.9')
  assert.equal(result.to, '0.9')
  assert.equal(result.document.version, '0.9')
  assert.equal(result.document.revision, 0)
  assert.equal(result.changed, true)
  const second = migrateWorldDocument(result.document)
  assert.equal(second.changed, false)
  assert.deepEqual(second.changes, [])
})

test('createWorldSchema supports World 0.9 and keeps procedural definitions enabled', () => {
  const schema = createWorldSchema({ version: '0.9' })
  assert.equal(schema.$id, 'https://anyo.blcklab.dev/schemas/world-0.9.schema.json')
  assert.equal(schema.properties.version.pattern, '^0\\.9(?:\\.|$)')
  assert.ok(schema.properties.geometries)
  assert.ok(schema.$defs.geometryDefinition)
})

test('World.load compiles World 0.9 procedural resources through the established 0.8 runtime path', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false })
  await world.load(baseline('0.9'))
  assert.equal(world.getSourceDocument().version, '0.9')
  assert.ok(world.compiled.resourceGraph)
  assert.equal(world.compiled.resourceGraph.list('geometry').length, 1)
  assert.equal(world.compiled.resourceGraph.list('material').length, 1)
  assert.equal(world.compiled.resourceGraph.list('instance').length, 1)
  world.dispose()
})
