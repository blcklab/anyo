import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createWorldSchema,
  inspectAnyoObjectDocument,
  inspectWorldDocument,
} from '../dist/esm/schema/index.js'

const schema = JSON.parse(readFileSync(new URL('../schemas/world-0.9.schema.json', import.meta.url), 'utf8'))
const objectSchema = JSON.parse(readFileSync(new URL('../schemas/object-0.1.schema.json', import.meta.url), 'utf8'))
const valid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-step10-strict-valid.json', import.meta.url), 'utf8'))
const invalid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-step10-strict-invalid.json', import.meta.url), 'utf8'))

const strictBuiltinDefs = [
  'asset', 'audio', 'building', 'environment', 'exploration', 'floor', 'interaction', 'lod',
  'material', 'opening', 'room', 'stair', 'trigger', 'visibility',
]

function registry(values) {
  const set = new Set(values)
  return { has(value) { return set.has(value) } }
}

test('Step 10 standardizes a small extensible metadata core shared by World 0.9 and Object 0.1', () => {
  const metadata = schema.$defs.metadata
  assert.equal(schema.properties.metadata.$ref, '#/$defs/metadata')
  assert.equal(objectSchema.properties.metadata.$ref, './world-0.9.schema.json#/$defs/metadata')
  assert.equal(metadata.type, 'object')
  assert.equal(metadata.additionalProperties, true)
  assert.deepEqual(Object.keys(metadata.properties), [
    'id', 'title', 'description', 'author', 'license', 'tags', 'thumbnail', 'repository', 'homepage',
  ])
  assert.equal(metadata.properties.tags.uniqueItems, true)
})

test('Step 10 makes proven built-in World 0.9 structures typo-resistant without closing intentional payload containers', () => {
  for (const name of strictBuiltinDefs) assert.equal(schema.$defs[name].additionalProperties, false, `${name} must be strict`)
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.data.additionalProperties, true)
  assert.equal(schema.properties.extensions.additionalProperties, true)
  assert.equal(schema.$defs.asset.properties.options.additionalProperties, true)
  assert.equal(schema.$defs.room.properties.data.additionalProperties, true)
  assert.equal(schema.$defs.entity.properties.data.additionalProperties, true)
  assert.equal(schema.$defs.entity.properties.extensions.additionalProperties, true)
  assert.equal(schema.$defs.component.additionalProperties, true, 'custom/plugin component payloads remain open until the dedicated component-schema pass')
  assert.equal(schema.$defs.entity.additionalProperties, true, 'entity schema stays extension-aware; generator semantics enforce built-in fields')
})

test('generator semantics reject built-in entity typos but allow registered custom entity payloads', () => {
  const builtIn = inspectWorldDocument({ version: '0.9', entities: [{ id: 'bad', type: 'box', positon: [0, 0, 0] }] }, { mode: 'generator' })
  assert.ok(builtIn.errors.some((issue) => issue.code === 'ANYO_UNKNOWN_FIELD' && issue.path === '/entities/0/positon'))

  const custom = inspectWorldDocument({
    version: '0.9',
    entities: [{ id: 'widget', type: 'project.widget', widgetMode: 'hero', widgetPayload: { x: 1 } }],
  }, {
    mode: 'generator',
    entityTypeRegistry: registry(['project.widget']),
  })
  assert.equal(custom.valid, true, custom.errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  assert.equal(custom.errors.some((issue) => issue.code === 'ANYO_UNKNOWN_FIELD'), false)
})

test('runtime metadata validation checks standardized keys while preserving custom metadata', () => {
  const ok = inspectWorldDocument(valid, { mode: 'generator' })
  assert.equal(ok.valid, true, ok.errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))

  const bad = inspectWorldDocument(invalid, { mode: 'generator' })
  const codes = new Set(bad.errors.map((issue) => issue.code))
  assert.ok(codes.has('METADATA_FIELD_INVALID'))
  assert.ok(codes.has('METADATA_TAGS_DUPLICATED'))
  assert.ok(codes.has('ANYO_UNKNOWN_FIELD'))
})

test('Object 0.1 reuses Step 10 metadata validation but remains metadata-extensible', () => {
  const ok = inspectAnyoObjectDocument({
    kind: 'anyo-object',
    version: '0.1',
    metadata: { id: 'hero-tree', title: 'Hero Tree', tags: ['tree'], catalogWeight: 5 },
    root: { children: [] },
  }, { mode: 'generator' })
  assert.equal(ok.valid, true, ok.errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))

  const bad = inspectAnyoObjectDocument({
    kind: 'anyo-object',
    version: '0.1',
    metadata: { title: '', tags: ['tree', 'tree'] },
    root: { children: [] },
  }, { mode: 'generator' })
  assert.ok(bad.errors.some((issue) => issue.code === 'METADATA_FIELD_INVALID'))
  assert.ok(bad.errors.some((issue) => issue.code === 'METADATA_TAGS_DUPLICATED'))
})

test('extension schema composition still preserves namespaced root/custom component/custom entity contributions', () => {
  const composed = createWorldSchema({
    baseSchema: schema,
    extensions: [{
      id: 'project.widgets',
      root: { type: 'object', properties: { enabled: { type: 'boolean' } }, additionalProperties: false },
      definitions: { widgetMode: { enum: ['hero', 'compact'] } },
      components: [{ type: 'object', required: ['type', 'strength'], properties: { type: { const: 'project.glow' }, strength: { type: 'number' } }, additionalProperties: false }],
      entities: [{ type: 'object', required: ['id', 'type', 'widgetMode'], properties: { id: { type: 'string' }, type: { const: 'project.widget' }, widgetMode: { $ref: '#/$defs/project_widgets__widgetMode' } }, additionalProperties: false }],
    }],
  })
  assert.deepEqual(composed.properties.extensions.properties['project.widgets'].properties.enabled, { type: 'boolean' })
  assert.deepEqual(composed.$defs.project_widgets__widgetMode, { enum: ['hero', 'compact'] })
  assert.equal(composed.$defs.component.oneOf.length, 2)
  assert.equal(composed.$defs.entity.oneOf.length, 2)
})

test('World 0.8 compatibility remains untouched by Step 10 metadata strictness', () => {
  const legacy = inspectWorldDocument({ version: '0.8', metadata: { title: 123, arbitraryLegacyMetadata: true }, entities: [{ id: 'legacy', type: 'box' }] })
  assert.equal(legacy.valid, true, legacy.errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
})
test('published TypeScript declarations expose the standardized metadata contract', () => {
  const declarations = readFileSync(new URL('../dist/types/core/types.d.ts', import.meta.url), 'utf8')
  assert.match(declarations, /export interface WorldMetadataDefinition/)
  assert.match(declarations, /id\?: string;/)
  assert.match(declarations, /tags\?: string\[\];/)
  assert.match(declarations, /metadata\?: WorldMetadataDefinition;/)
})
