import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  inspectAnyoObjectDocument,
  inspectWorldDocument,
  instantiateResolvedWorldDocument,
  normalizeWorldDocument,
  resolveWorldDocumentImports,
  bundleResolvedWorldDocument,
} from '../dist/esm/index.js'

const schema = JSON.parse(readFileSync(new URL('../schemas/world-0.9.schema.json', import.meta.url), 'utf8'))
const objectSchema = JSON.parse(readFileSync(new URL('../schemas/object-0.1.schema.json', import.meta.url), 'utf8'))
const valid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-step11-composition-valid.json', import.meta.url), 'utf8'))
const invalid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-step11-composition-invalid.json', import.meta.url), 'utf8'))

function mapLoader(entries) {
  return async (request) => {
    if (!Object.prototype.hasOwnProperty.call(entries, request.url)) throw new Error(`missing ${request.url}`)
    return { document: structuredClone(entries[request.url]), documentUrl: request.url }
  }
}

function child(root, localId) {
  return root.children.find((entry) => entry.id.endsWith(`/${localId}`) || entry.id === localId)
}

test('Step 11 marks compositions canonical while prefabs/use remain deprecated compatibility syntax', () => {
  assert.equal(schema.properties.prefabs.deprecated, true)
  assert.match(schema.properties.prefabs.description, /Prefer compositions/i)
  assert.match(schema.properties.compositions.description, /Canonical/i)
  assert.equal(schema.$defs.entity.properties.use.deprecated, true)
  assert.match(schema.$defs.entity.properties.composition.description, /Canonical/i)
  assert.equal(schema.$defs.prefab.description.includes('backward compatibility'), true)
  assert.match(schema.$defs.composition.description, /Canonical/i)
})

test('Step 11 parameter schema is deliberately small, typed, deterministic, and non-scriptable', () => {
  const parameter = schema.$defs.compositionParameterDefinition
  assert.equal(parameter.oneOf.length, 7)
  assert.deepEqual(parameter.oneOf.map((entry) => entry.properties.type.const), [
    'string', 'number', 'boolean', 'vec2', 'vec3', 'material', 'asset',
  ])
  for (const variant of parameter.oneOf) {
    assert.deepEqual(variant.required, ['type', 'path'])
    assert.equal(variant.additionalProperties, false)
    assert.deepEqual(Object.keys(variant.properties), ['type', 'path', 'default'])
    assert.match(variant.properties.path.pattern, /^\^\//)
  }
  assert.equal(schema.$defs.composition.properties.parameters.additionalProperties.$ref, '#/$defs/compositionParameterDefinition')
  assert.equal(schema.$defs.entity.properties.arguments.additionalProperties.$ref, '#/$defs/compositionParameterValue')
  assert.deepEqual(schema.$defs.entity.dependentRequired.arguments, ['composition'])
})

test('composition defaults, inherited parameters, arguments, overrides, and instance fields use deterministic precedence', () => {
  const result = inspectWorldDocument(structuredClone(valid), { mode: 'generator' })
  assert.equal(result.valid, true, result.errors.map((entry) => `${entry.code}: ${entry.path}: ${entry.message}`).join('\n'))

  const normalized = normalizeWorldDocument(structuredClone(valid))
  const root = normalized.entities[0]
  const body = child(root, 'body')
  const art = child(root, 'art')
  assert.equal(root.position[0], 10, 'instance fields remain authoritative on the group root')
  assert.deepEqual(body.size, [2, 4, 0.1], 'argument applies width; advanced override wins over height argument')
  assert.deepEqual(body.position, [1, 2, 3])
  assert.equal(body.visible, false)
  assert.equal(body.material, 'accent')
  assert.equal(art.asset, 'panel-b')
  assert.equal(root.arguments, undefined, 'public arguments are consumed during normalization')
})

test('Step 11 validation rejects malformed parameter contracts and invalid arguments with actionable codes', () => {
  const result = inspectWorldDocument(structuredClone(invalid), { mode: 'generator' })
  const codes = new Set(result.errors.map((entry) => entry.code))
  for (const code of [
    'COMPOSITION_PARAMETER_NAME_INVALID',
    'COMPOSITION_PARAMETER_PATH_NOT_FOUND',
    'COMPOSITION_PARAMETER_DEFAULT_INVALID',
    'COMPOSITION_PARAMETER_MATERIAL_NOT_FOUND',
    'COMPOSITION_ARGUMENT_UNKNOWN',
    'COMPOSITION_ARGUMENT_TYPE_INVALID',
    'ANYO_COMPOSITION_ARGUMENT_MATERIAL_NOT_FOUND',
    'COMPOSITION_ARGUMENTS_REQUIRE_COMPOSITION',
  ]) assert.equal(codes.has(code), true, `expected ${code}`)
})

test('legacy prefab/use authoring remains functional and does not require composition migration', () => {
  const legacy = {
    version: '0.9',
    prefabs: { crate: { type: 'box', size: [1, 1, 1], material: 'crateMat' } },
    materials: { crateMat: { baseColor: '#885522' } },
    entities: [{ id: 'crate-a', use: 'crate', overrides: { '/size/0': 2 } }],
  }
  const inspection = inspectWorldDocument(legacy, { mode: 'generator' })
  assert.equal(inspection.valid, true, inspection.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))
  const normalized = normalizeWorldDocument(legacy)
  assert.deepEqual(normalized.entities[0].size, [2, 1, 1])
  assert.equal(normalized.entities[0].material, 'crateMat')
})

test('Object 0.1 roots may expose parameters but still reject instance-only arguments', () => {
  const object = {
    kind: 'anyo-object',
    version: '0.1',
    materials: { bark: { baseColor: '#6b4423' } },
    root: {
      children: [{ id: 'trunk', type: 'box', size: [1, 2, 1], material: 'bark' }],
      parameters: { height: { type: 'number', path: '/children/0/size/1', default: 2 } },
    },
  }
  const ok = inspectAnyoObjectDocument(object, { mode: 'generator' })
  assert.equal(ok.valid, true, ok.errors.map((entry) => `${entry.code}: ${entry.path}: ${entry.message}`).join('\n'))
  assert.equal(objectSchema.properties.root.allOf[1].not.anyOf.some((entry) => entry.required?.[0] === 'arguments'), true)

  const bad = structuredClone(object)
  bad.root.arguments = { height: 4 }
  const result = inspectAnyoObjectDocument(bad, { mode: 'generator' })
  assert.equal(result.valid, false)
  assert.equal(result.errors.some((entry) => entry.code === 'ANYO_OBJECT_ROOT_FIELD_INVALID' && entry.path === '/root/arguments'), true)
})

test('import instantiation rewrites resource-typed parameter defaults while root-world arguments keep root resource ownership', async () => {
  const base = 'https://example.test/world/'
  const treeUrl = `${base}models/tree.anyo.json`
  const object = {
    kind: 'anyo-object',
    version: '0.1',
    materials: { leaf: { baseColor: '#228844' } },
    assets: { badge: { type: 'image', src: './badge.webp' } },
    root: {
      children: [
        { id: 'crown', type: 'sphere', radius: 1, material: 'leaf' },
        { id: 'badge', type: 'image', asset: 'badge', size: [1, 1] },
      ],
      parameters: {
        foliage: { type: 'material', path: '/children/0/material', default: 'leaf' },
        badge: { type: 'asset', path: '/children/1/asset', default: 'badge' },
      },
    },
  }
  const world = {
    version: '0.9',
    materials: { autumn: { baseColor: '#cc6622' } },
    assets: { rootBadge: { type: 'image', src: './root-badge.webp' } },
    imports: { tree: { src: './models/tree.anyo.json' } },
    entities: [{ id: 'tree-a', composition: 'tree', arguments: { foliage: 'autumn', badge: 'rootBadge' } }],
  }
  const graph = await resolveWorldDocumentImports(world, {
    sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
    documentLoader: mapLoader({ [treeUrl]: object }),
  })
  const instantiated = instantiateResolvedWorldDocument(graph)
  assert.equal(instantiated.compositions['tree::root'].parameters.foliage.default, 'tree::material::leaf')
  assert.equal(instantiated.compositions['tree::root'].parameters.badge.default, 'tree::asset::badge')
  assert.deepEqual(instantiated.entities[0].arguments, { foliage: 'autumn', badge: 'rootBadge' })

  const normalized = normalizeWorldDocument(instantiated)
  assert.equal(child(normalized.entities[0], 'crown').material, 'autumn')
  assert.equal(child(normalized.entities[0], 'badge').asset, 'rootBadge')

  const bundled = bundleResolvedWorldDocument(graph)
  assert.equal(bundled.imports, undefined)
  const bundledNormalized = normalizeWorldDocument(bundled)
  assert.equal(child(bundledNormalized.entities[0], 'crown').material, 'autumn')
  assert.equal(child(bundledNormalized.entities[0], 'badge').asset, 'rootBadge')
})

test('published TypeScript declarations expose composition parameters/arguments and preserve prefab compatibility', () => {
  const declarations = readFileSync(new URL('../dist/types/core/types.d.ts', import.meta.url), 'utf8')
  for (const fragment of [
    "export type CompositionParameterType = 'string' | 'number' | 'boolean' | 'vec2' | 'vec3' | 'material' | 'asset';",
    'export interface CompositionParameterDefinition',
    'parameters?: Record<string, CompositionParameterDefinition>;',
    'arguments?: Record<string, CompositionParameterValue>;',
    '@deprecated Prefer CompositionDefinition for new reusable authoring.',
  ]) assert.equal(declarations.includes(fragment), true, `missing declaration: ${fragment}`)
})
