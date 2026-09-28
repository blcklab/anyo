import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  AnyoImportError,
  World,
  createFetchAnyoDocumentLoader,
  inspectAnyoObjectDocument,
  inspectWorldDocument,
  resolveWorldDocumentImports,
} from '../dist/esm/index.js'

const worldSchemaUrl = new URL('../schemas/world-0.9.schema.json', import.meta.url)
const objectSchemaUrl = new URL('../schemas/object-0.1.schema.json', import.meta.url)
const declarationsUrl = new URL('../dist/types/core/types.d.ts', import.meta.url)

function baseObject(extra = {}) {
  return {
    kind: 'anyo-object',
    version: '0.1',
    assets: {
      leaves: { type: 'texture', src: './textures/leaves.png' },
    },
    materials: {
      bark: { color: '#6b4423' },
    },
    root: { children: [{ id: 'trunk', type: 'box', material: 'bark' }] },
    ...extra,
  }
}

function baseWorld(extra = {}) {
  return {
    version: '0.9',
    entities: [],
    ...extra,
  }
}

function mapLoader(entries, calls = []) {
  return async (request) => {
    calls.push(request)
    if (!Object.prototype.hasOwnProperty.call(entries, request.url)) throw new Error(`missing ${request.url}`)
    const value = entries[request.url]
    if (typeof value === 'string') return { document: JSON.parse(value), sourceText: value, documentUrl: request.url }
    return { document: structuredClone(value), documentUrl: request.url }
  }
}

function assertImportError(error, code) {
  assert.ok(error instanceof AnyoImportError, `expected AnyoImportError, got ${error}`)
  assert.equal(error.code, code)
  return true
}

test('World 0.9 and Object 0.1 schemas share the same strict import definition', async () => {
  const world = JSON.parse(await readFile(worldSchemaUrl, 'utf8'))
  const object = JSON.parse(await readFile(objectSchemaUrl, 'utf8'))
  assert.equal(world.properties.imports.type, 'object')
  assert.equal(world.properties.imports.additionalProperties.$ref, '#/$defs/importDefinition')
  assert.deepEqual(world.$defs.importDefinition.required, ['src'])
  assert.deepEqual(Object.keys(world.$defs.importDefinition.properties).sort(), ['integrity', 'src'])
  assert.equal(world.$defs.importDefinition.additionalProperties, false)
  assert.equal(object.properties.imports.additionalProperties.$ref, './world-0.9.schema.json#/$defs/importDefinition')
})

test('World 0.9 semantic validation accepts imports while pre-0.9 worlds reject them', () => {
  const imports = { tree: { src: './models/tree.anyo.json' } }
  const current = inspectWorldDocument(baseWorld({ imports }))
  assert.equal(current.valid, true, current.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))

  const legacy = inspectWorldDocument({ version: '0.8', entities: [], imports })
  assert.equal(legacy.valid, false)
  assert.equal(legacy.errors.some((entry) => entry.code === 'ANYO_IMPORTS_REQUIRE_0_9'), true)
})

test('Object 0.1 accepts nested imports and validates alias/source/integrity shape', () => {
  const valid = inspectAnyoObjectDocument(baseObject({ imports: { crown: { src: './crown.anyo.json' } } }))
  assert.equal(valid.valid, true, valid.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))

  const invalid = inspectAnyoObjectDocument(baseObject({ imports: {
    'bad alias': { src: '' },
    ok: { src: './ok.anyo.json', integrity: 'md5-nope', extra: true },
  } }))
  const codes = new Set(invalid.errors.map((entry) => entry.code))
  for (const code of ['ANYO_IMPORT_ALIAS_INVALID', 'ANYO_IMPORT_SOURCE_REQUIRED', 'ANYO_IMPORT_INTEGRITY_INVALID', 'ANYO_IMPORT_FIELD_UNKNOWN']) {
    assert.equal(codes.has(code), true, `expected ${code}`)
  }
})

test('resolver loads one object, preserves its own source context, and resolves its local URLs against itself', async () => {
  const world = baseWorld({ imports: { tree: { src: './models/tree.anyo.json' } } })
  const treeUrl = 'https://example.test/world/models/tree.anyo.json'
  const graph = await resolveWorldDocumentImports(world, {
    sourceContext: { documentUrl: 'https://example.test/world/world.anyo.json', baseUrl: 'https://example.test/world/' },
    documentLoader: mapLoader({ [treeUrl]: baseObject() }),
  })
  assert.deepEqual(Object.keys(graph.imports), ['tree'])
  assert.equal(graph.imports.tree.namespace, 'tree')
  assert.equal(graph.imports.tree.sourceUrl, treeUrl)
  assert.equal(graph.imports.tree.sourceContext.baseUrl, 'https://example.test/world/models/')
  assert.equal(graph.imports.tree.document.assets.leaves.src, 'https://example.test/world/models/textures/leaves.png')
})

test('resolver keeps equal local resource names isolated by deterministic alias namespaces', async () => {
  const world = baseWorld({ imports: {
    'tree-b': { src: './b.anyo.json' },
    'tree-a': { src: './a.anyo.json' },
  } })
  const base = 'https://example.test/world/'
  const graph = await resolveWorldDocumentImports(world, {
    sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
    documentLoader: mapLoader({
      [`${base}a.anyo.json`]: baseObject(),
      [`${base}b.anyo.json`]: baseObject(),
    }),
  })
  assert.deepEqual(Object.keys(graph.imports), ['tree-a', 'tree-b'])
  assert.equal(graph.imports['tree-a'].namespace, 'tree-a')
  assert.equal(graph.imports['tree-b'].namespace, 'tree-b')
  assert.ok(graph.imports['tree-a'].document.materials.bark)
  assert.ok(graph.imports['tree-b'].document.materials.bark)
})

test('nested object imports resolve relative to the declaring object and receive alias-path namespaces', async () => {
  const base = 'https://example.test/world/'
  const treeUrl = `${base}models/tree.anyo.json`
  const crownUrl = `${base}models/parts/crown.anyo.json`
  const graph = await resolveWorldDocumentImports(baseWorld({ imports: { tree: { src: './models/tree.anyo.json' } } }), {
    sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
    documentLoader: mapLoader({
      [treeUrl]: baseObject({ imports: { crown: { src: './parts/crown.anyo.json' } } }),
      [crownUrl]: baseObject({ assets: { leaf: { type: 'texture', src: './leaf.png' } } }),
    }),
  })
  const crown = graph.imports.tree.imports.crown
  assert.equal(crown.namespace, 'tree::crown')
  assert.equal(crown.sourceUrl, crownUrl)
  assert.equal(crown.document.assets.leaf.src, `${base}models/parts/leaf.png`)
})

test('resolver detects A -> B -> A cycles and reports the concrete source chain', async () => {
  const base = 'https://example.test/world/'
  const a = `${base}a.anyo.json`
  const b = `${base}b.anyo.json`
  await assert.rejects(
    resolveWorldDocumentImports(baseWorld({ imports: { a: { src: './a.anyo.json' } } }), {
      sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
      documentLoader: mapLoader({
        [a]: baseObject({ imports: { b: { src: './b.anyo.json' } } }),
        [b]: baseObject({ imports: { a: { src: './a.anyo.json' } } }),
      }),
    }),
    (error) => {
      assertImportError(error, 'ANYO_IMPORT_CYCLE')
      assert.deepEqual(error.chain, [`${base}world.anyo.json`, a, b, a])
      assert.match(error.message, /a\.anyo\.json.*b\.anyo\.json.*a\.anyo\.json/)
      return true
    },
  )
})

test('relative imports require a source context when resolving an in-memory world', async () => {
  await assert.rejects(
    resolveWorldDocumentImports(baseWorld({ imports: { tree: { src: './tree.anyo.json' } } }), { documentLoader: mapLoader({}) }),
    (error) => assertImportError(error, 'ANYO_IMPORT_BASE_URL_REQUIRED'),
  )
})

test('missing and invalid imported documents produce precise import errors', async () => {
  const base = 'https://example.test/'
  const world = baseWorld({ imports: { tree: { src: './tree.anyo.json' } } })
  await assert.rejects(
    resolveWorldDocumentImports(world, {
      sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
      documentLoader: async () => { throw new Error('ENOENT') },
    }),
    (error) => {
      assertImportError(error, 'ANYO_IMPORT_NOT_FOUND')
      assert.equal(error.alias, 'tree')
      assert.equal(error.source, `${base}tree.anyo.json`)
      return true
    },
  )

  await assert.rejects(
    resolveWorldDocumentImports(world, {
      sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
      documentLoader: mapLoader({ [`${base}tree.anyo.json`]: { kind: 'wrong', version: '9', root: {} } }),
    }),
    (error) => assertImportError(error, 'ANYO_IMPORT_INVALID_DOCUMENT'),
  )
})

test('resolver enforces a bounded recursive import depth', async () => {
  const base = 'https://example.test/'
  await assert.rejects(
    resolveWorldDocumentImports(baseWorld({ imports: { a: { src: './a.anyo.json' } } }), {
      sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
      maxDepth: 1,
      documentLoader: mapLoader({
        [`${base}a.anyo.json`]: baseObject({ imports: { b: { src: './b.anyo.json' } } }),
        [`${base}b.anyo.json`]: baseObject(),
      }),
    }),
    (error) => assertImportError(error, 'ANYO_IMPORT_DEPTH_EXCEEDED'),
  )
})

test('default fetch loader rejects duplicate import aliases before JSON.parse can discard them', async () => {
  const raw = '{"kind":"anyo-object","version":"0.1","imports":{"leaf":{"src":"./a.json"},"leaf":{"src":"./b.json"}},"root":{"children":[]}}'
  const loader = createFetchAnyoDocumentLoader(async () => new Response(raw, { status: 200 }))
  await assert.rejects(
    loader({ url: 'https://example.test/object.anyo.json' }),
    (error) => assertImportError(error, 'ANYO_IMPORT_ALIAS_DUPLICATE'),
  )
})

test('sha256 integrity succeeds for exact source text and fails deterministically when content differs', async () => {
  const base = 'https://example.test/'
  const sourceText = JSON.stringify(baseObject())
  const integrity = `sha256-${createHash('sha256').update(sourceText).digest('base64')}`
  const world = baseWorld({ imports: { tree: { src: './tree.anyo.json', integrity } } })
  const goodLoader = async (request) => ({ document: JSON.parse(sourceText), sourceText, documentUrl: request.url })
  const graph = await resolveWorldDocumentImports(world, {
    sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
    documentLoader: goodLoader,
  })
  assert.equal(graph.imports.tree.sourceUrl, `${base}tree.anyo.json`)

  await assert.rejects(
    resolveWorldDocumentImports(world, {
      sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
      documentLoader: async (request) => ({ document: baseObject(), sourceText: `${sourceText} `, documentUrl: request.url }),
    }),
    (error) => assertImportError(error, 'ANYO_IMPORT_INTEGRITY_MISMATCH'),
  )
})

test('same source URL is loaded once per integrity contract but can be namespaced by multiple aliases', async () => {
  const base = 'https://example.test/'
  const calls = []
  const world = baseWorld({ imports: { first: { src: './shared.anyo.json' }, second: { src: './shared.anyo.json' } } })
  const graph = await resolveWorldDocumentImports(world, {
    sourceContext: { documentUrl: `${base}world.anyo.json`, baseUrl: base },
    documentLoader: mapLoader({ [`${base}shared.anyo.json`]: baseObject() }, calls),
  })
  assert.equal(calls.length, 1)
  assert.equal(graph.imports.first.namespace, 'first')
  assert.equal(graph.imports.second.namespace, 'second')
})

test('World.load uses the injected document loader for root URL and imports without renderer-side import logic', async () => {
  const base = 'https://example.test/world/'
  const calls = []
  const loader = mapLoader({
    [`${base}world.anyo.json`]: baseWorld({ imports: { tree: { src: './tree.anyo.json' } } }),
    [`${base}tree.anyo.json`]: baseObject(),
  }, calls)
  const world = new World({ documentLoader: loader })
  await world.load(`${base}world.anyo.json`)
  assert.deepEqual(calls.map((entry) => entry.url), [`${base}world.anyo.json`, `${base}tree.anyo.json`])
  assert.equal(world.document.version, '0.9')
  await world.dispose()
})

test('published TypeScript declarations expose the import/resolver contracts', async () => {
  const declarations = await readFile(declarationsUrl, 'utf8')
  for (const fragment of [
    'export interface AnyoImportDefinition',
    'export type AnyoImportMap = Record<string, AnyoImportDefinition>',
    'export type AnyoDocumentLoader =',
    'export interface ResolvedAnyoImport',
    'export interface ResolvedWorldDocumentGraph',
    'documentLoader?: AnyoDocumentLoader',
    'imports?: AnyoImportMap',
  ]) assert.equal(declarations.includes(fragment), true, `missing declaration: ${fragment}`)
})
