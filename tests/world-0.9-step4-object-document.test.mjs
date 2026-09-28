import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { inspectAnyoObjectDocument, validateAnyoObjectDocument, AnyoValidationError } from '../dist/esm/index.js'

const read = promisify(readFile)
const validFixture = JSON.parse(readFileSync(new URL('./fixtures/object-0.1-valid.json', import.meta.url), 'utf8'))
const invalidFixture = JSON.parse(readFileSync(new URL('./fixtures/object-0.1-invalid.json', import.meta.url), 'utf8'))
const objectSchemaUrl = new URL('../schemas/object-0.1.schema.json', import.meta.url)
const worldSchemaUrl = new URL('../schemas/world-0.9.schema.json', import.meta.url)
const typesUrl = new URL('../dist/types/core/types.d.ts', import.meta.url)

function codes(result) {
  return new Set(result.errors.map((entry) => entry.code))
}

test('Object 0.1 schema reuses World 0.9 resource and composition definitions without imports', async () => {
  const objectSchema = JSON.parse(await read(objectSchemaUrl, 'utf8'))
  const worldSchema = JSON.parse(await read(worldSchemaUrl, 'utf8'))
  assert.equal(objectSchema.$id, 'https://anyo.blcklab.dev/schemas/object-0.1.schema.json')
  assert.deepEqual(objectSchema.required, ['kind', 'version', 'root'])
  assert.equal(objectSchema.properties.kind.const, 'anyo-object')
  assert.equal(objectSchema.properties.version.pattern, '^0\\.1(?:\\.|$)')
  assert.equal(objectSchema.properties.assets.additionalProperties.$ref, './world-0.9.schema.json#/$defs/asset')
  assert.equal(objectSchema.properties.materials.additionalProperties.$ref, './world-0.9.schema.json#/$defs/material')
  assert.equal(objectSchema.properties.geometries.additionalProperties.$ref, './world-0.9.schema.json#/$defs/geometryDefinition')
  assert.equal(objectSchema.properties.compositions.additionalProperties.$ref, './world-0.9.schema.json#/$defs/composition')
  assert.equal(objectSchema.properties.root.allOf[0].$ref, './world-0.9.schema.json#/$defs/composition')
  assert.deepEqual(objectSchema.properties.root.allOf[1].not.anyOf.map((entry) => entry.required[0]), ['use', 'composition', 'repeat', 'instanceId', 'overrides', 'loading'])
  assert.equal(objectSchema.properties.imports, undefined)
  assert.equal(objectSchema.additionalProperties, false)
  assert.ok(worldSchema.$defs.composition, 'World 0.9 composition definition remains the shared root vocabulary')
})

test('valid standalone Object 0.1 documents accept local assets, materials, geometries, and nested compositions', () => {
  const result = inspectAnyoObjectDocument(structuredClone(validFixture))
  assert.equal(result.valid, true, result.errors.map((entry) => `${entry.code}: ${entry.path}: ${entry.message}`).join('\n'))
  assert.doesNotThrow(() => validateAnyoObjectDocument(structuredClone(validFixture)))
})

test('Object 0.1 rejects unsupported versions, wrong kind, resource-map shape errors, and premature imports', () => {
  const result = inspectAnyoObjectDocument(structuredClone(invalidFixture))
  assert.equal(result.valid, false)
  const actual = codes(result)
  for (const code of [
    'ANYO_OBJECT_KIND_INVALID',
    'ANYO_OBJECT_VERSION_UNSUPPORTED',
    'ANYO_OBJECT_FIELD_UNKNOWN',
    'ANYO_OBJECT_RESOURCE_MAP_INVALID',
    'ANYO_OBJECT_ROOT_TYPE_INVALID',
  ]) assert.equal(actual.has(code), true, `expected ${code}`)
})

test('Object 0.1 requires a root composition document', () => {
  const document = structuredClone(validFixture)
  delete document.root
  const result = inspectAnyoObjectDocument(document)
  assert.equal(result.valid, false)
  assert.equal(result.errors.some((entry) => entry.code === 'ANYO_OBJECT_ROOT_REQUIRED' && entry.path === '/root'), true)
})

test('object semantic errors are reported using native /root paths', () => {
  const document = structuredClone(validFixture)
  document.root.children[0].material = 'missing-bark'
  document.root.children[1].composition = 'missing-crown'
  document.root.children[2].asset = 'missing-texture'
  const result = inspectAnyoObjectDocument(document, { mode: 'generator' })
  assert.equal(result.valid, false)
  assert.equal(result.errors.some((entry) => entry.code === 'ANYO_MATERIAL_NOT_FOUND' && entry.path === '/root/children/0/material'), true)
  assert.equal(result.errors.some((entry) => entry.code === 'COMPOSITION_NOT_FOUND' && entry.path === '/root/children/1/composition'), true)
  assert.equal(result.errors.some((entry) => entry.code === 'ANYO_ASSET_NOT_FOUND' && entry.path === '/root/children/2/asset'), true)
})

test('root extends may target a local composition but cannot target an unknown composition', () => {
  const valid = structuredClone(validFixture)
  valid.root = { extends: 'crown' }
  assert.equal(inspectAnyoObjectDocument(valid).valid, true)

  const invalid = structuredClone(validFixture)
  invalid.root = { extends: 'missing' }
  const result = inspectAnyoObjectDocument(invalid)
  assert.equal(result.valid, false)
  assert.equal(result.errors.some((entry) => entry.code === 'ANYO_OBJECT_ROOT_EXTENDS_UNKNOWN'), true)
})

test('object roots reject entity-instance-only template fields', () => {
  const document = structuredClone(validFixture)
  document.root = { use: 'legacy-prefab' }
  const result = inspectAnyoObjectDocument(document)
  assert.equal(result.valid, false)
  assert.equal(result.errors.some((entry) => entry.code === 'ANYO_OBJECT_ROOT_FIELD_INVALID' && entry.path === '/root/use'), true)
})

test('validateAnyoObjectDocument throws the existing AnyoValidationError type', () => {
  assert.throws(() => validateAnyoObjectDocument(structuredClone(invalidFixture)), (error) => {
    assert.ok(error instanceof AnyoValidationError)
    return true
  })
})

test('published TypeScript declarations expose the Object 0.1 contract', async () => {
  const declarations = await read(typesUrl, 'utf8')
  for (const fragment of [
    "export type AnyoObjectDocumentVersion = '0.1' | `0.1.${string}`",
    'export interface AnyoObjectDocument',
    "kind: 'anyo-object';",
    'root: CompositionDefinition;',
  ]) assert.equal(declarations.includes(fragment), true, `missing declaration: ${fragment}`)
})
