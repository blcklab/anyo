import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { inspectWorldDocument, normalizeWorldDocument } from '../dist/esm/schema/index.js'

const schema08Url = new URL('../schemas/world-0.8.schema.json', import.meta.url)
const schema09Url = new URL('../schemas/world-0.9.schema.json', import.meta.url)
const typesUrl = new URL('../dist/types/core/types.d.ts', import.meta.url)

const validFixture = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-public-fields-valid.json', import.meta.url), 'utf8'))
const invalidFixture = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-public-fields-invalid.json', import.meta.url), 'utf8'))

function alignedWorld() {
  return structuredClone(validFixture)
}

test('World 0.9 schema explicitly models the existing stable entity and exploration fields', async () => {
  const schema = JSON.parse(await readFile(schema09Url, 'utf8'))
  const entity = schema.$defs.entity
  const exploration = schema.$defs.exploration

  assert.deepEqual(entity.properties.instanceId, { type: 'string', minLength: 1 })
  assert.equal(entity.properties.overrides.type, 'object')
  assert.equal(entity.properties.overrides.additionalProperties, true)
  assert.equal(typeof entity.properties.overrides.propertyNames.pattern, 'string')
  assert.deepEqual(entity.properties.loading, { enum: ['eager', 'lazy'] })
  assert.deepEqual(entity.properties.extensions, { type: 'object', additionalProperties: true })
  assert.deepEqual(entity.anyOf.map((variant) => variant.required?.[0]), ['type', 'use', 'composition'])
  assert.deepEqual(exploration.properties.mode, { enum: ['first-person', 'third-person'] })
  assert.deepEqual(exploration.properties.character, { type: 'string', minLength: 1 })

  const pointerPattern = new RegExp(entity.properties.overrides.propertyNames.pattern)
  assert.equal(pointerPattern.test('/children/0/material'), true)
  assert.equal(pointerPattern.test('/style/~0token/~1path'), true)
  assert.equal(pointerPattern.test('children/0/material'), false)
  assert.equal(pointerPattern.test('/children//material'), false)
  assert.equal(pointerPattern.test('/children/~2bad'), false)
})

test('World 0.8 schema remains unchanged by the World 0.9 drift alignment', async () => {
  const schema = JSON.parse(await readFile(schema08Url, 'utf8'))
  assert.equal(schema.$id, 'https://anyo.blcklab.dev/schemas/world-0.8.schema.json')
  assert.equal(schema.properties.version.pattern, '^0\\.8(?:\\.|$)')
  assert.equal(schema.$defs.entity.properties.instanceId, undefined)
  assert.equal(schema.$defs.entity.properties.overrides, undefined)
  assert.equal(schema.$defs.entity.properties.loading, undefined)
  assert.deepEqual(schema.$defs.entity.anyOf.map((variant) => variant.required?.[0]), ['type', 'use'])
  assert.equal(schema.$defs.exploration.properties.mode, undefined)
  assert.equal(schema.$defs.exploration.properties.character, undefined)
})

test('aligned World 0.9 fields pass semantic validation and normalize with their intended meaning', () => {
  const document = alignedWorld()
  const validation = inspectWorldDocument(document)
  assert.equal(validation.valid, true, validation.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))

  const normalized = normalizeWorldDocument(document)
  assert.equal(normalized.exploration.mode, 'third-person')
  assert.equal(normalized.exploration.character, 'hero-tree-a')
  assert.equal(normalized.entities.length, 1)

  const instance = normalized.entities[0]
  assert.equal(instance.id, 'hero-tree-a')
  assert.equal(instance.instanceId, 'hero-tree-instance-a')
  assert.equal(instance.loading, 'lazy')
  assert.deepEqual(instance.extensions, { 'blcklab.authoring': { selected: true } })
  assert.equal(instance.overrides, undefined, 'template overrides are consumed during normalization')
  assert.equal(instance.children?.[0]?.material, 'autumn', 'override effect survives normalization')
})

test('pure composition instances satisfy the established runtime authoring contract', () => {
  const document = alignedWorld()
  delete document.entities[0].instanceId
  delete document.entities[0].overrides
  delete document.entities[0].loading
  delete document.entities[0].extensions
  const validation = inspectWorldDocument(document)
  assert.equal(validation.valid, true, validation.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))
  assert.equal(normalizeWorldDocument(document).entities[0].type, 'group')
})

test('detailed validation rejects malformed aligned public fields with actionable diagnostics', () => {
  const document = structuredClone(invalidFixture)
  document.entities[0].overrides['/unsafe/~2escape'] = 2
  const result = inspectWorldDocument(document)
  assert.equal(result.valid, false)
  const codes = new Set(result.errors.map((entry) => entry.code))
  for (const code of [
    'ENTITY_INSTANCE_ID_INVALID',
    'ENTITY_OVERRIDE_PATH_INVALID',
    'ENTITY_LOADING_INVALID',
    'ENTITY_EXTENSIONS_INVALID',
    'EXPLORATION_MODE_INVALID',
    'EXPLORATION_CHARACTER_INVALID',
  ]) assert.equal(codes.has(code), true, `expected ${code}`)
})

test('published TypeScript declarations expose every aligned stable field', async () => {
  const declarations = await readFile(typesUrl, 'utf8')
  for (const fragment of [
    'instanceId?: string',
    'overrides?: Record<string, JsonValue>',
    "loading?: 'eager' | 'lazy'",
    'extensions?: Record<string, unknown>',
    "export type ExplorationCameraMode = 'first-person' | 'third-person'",
    'mode?: ExplorationCameraMode',
    'character?: string',
  ]) assert.equal(declarations.includes(fragment), true, `missing declaration: ${fragment}`)
})
