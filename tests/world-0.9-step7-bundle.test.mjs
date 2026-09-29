import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  bundleResolvedWorldDocument,
  bundleWorldDocument,
  canonicalizeWorldDocument,
  createWorld,
  entitiesPlugin,
  inspectWorldDocument,
  instantiateResolvedWorldDocument,
  normalizeWorldDocument,
  resolveWorldDocumentImports,
  serializeWorldDocument,
} from '../dist/esm/index.js'

const BASE = 'https://example.test/world/'
const ROOT_URL = `${BASE}world.anyo.json`
const TREE_URL = `${BASE}models/tree.anyo.json`
const CROWN_URL = `${BASE}models/parts/crown.anyo.json`
const declarationsUrl = new URL('../dist/types/document/bundle.d.ts', import.meta.url)

function mapLoader(entries, calls = []) {
  return async (request) => {
    calls.push(request)
    if (!Object.prototype.hasOwnProperty.call(entries, request.url)) throw new Error(`missing ${request.url}`)
    return { document: structuredClone(entries[request.url]), documentUrl: request.url }
  }
}

function crownObject() {
  return {
    kind: 'anyo-object',
    version: '0.1',
    assets: {
      leafTex: { type: 'texture', src: './textures/crown.png' },
    },
    materials: {
      leaf: { baseColor: '#2f6d3a', baseColorTexture: 'leafTex' },
    },
    root: {
      children: [
        { id: 'crown', type: 'sphere', radius: 1.5, material: 'leaf', collision: true },
      ],
    },
  }
}

function treeObject() {
  return {
    kind: 'anyo-object',
    version: '0.1',
    imports: { crown: { src: './parts/crown.anyo.json' } },
    assets: {
      barkTex: { type: 'texture', src: './textures/bark.png' },
    },
    materials: {
      bark: { baseColor: '#6b4423', baseColorTexture: 'barkTex' },
    },
    geometries: {
      trunk: { kind: 'cylinder', radius: 0.35, height: 3, segments: 12 },
    },
    compositions: {
      crowned: {
        children: [
          { id: 'nested-crown', composition: 'crown', position: [0, 2.5, 0] },
        ],
      },
    },
    root: {
      children: [
        { id: 'trunk', type: 'geometry', geometry: 'trunk', material: 'bark', collision: true },
        { id: 'crowned-instance', composition: 'crowned' },
      ],
    },
  }
}

function worldDocument(reverseAssets = false) {
  const assets = reverseAssets
    ? {
        rootSecondary: { type: 'texture', src: './assets/secondary.png' },
        rootTex: { type: 'texture', src: './assets/root.png' },
      }
    : {
        rootTex: { type: 'texture', src: './assets/root.png' },
        rootSecondary: { type: 'texture', src: './assets/secondary.png' },
      }
  return {
    version: '0.9',
    metadata: { title: 'Bundle fixture' },
    assets,
    imports: { tree: { src: './models/tree.anyo.json' } },
    entities: [
      { id: 'oak-a', composition: 'tree', position: [1, 0, 0] },
      { id: 'oak-b', composition: 'tree', position: [-1, 0, 0] },
    ],
  }
}

function options(calls = [], root = worldDocument()) {
  return {
    sourceContext: { documentUrl: ROOT_URL, baseUrl: BASE },
    documentLoader: mapLoader({
      [TREE_URL]: treeObject(),
      [CROWN_URL]: crownObject(),
      [ROOT_URL]: root,
    }, calls),
  }
}

async function resolvedGraph(root = worldDocument()) {
  return resolveWorldDocumentImports(root, options([], root))
}

function normalizedSemantic(document, sourceContext) {
  const normalized = normalizeWorldDocument(document, sourceContext ? { sourceContext } : {})
  const output = structuredClone(normalized)
  delete output.imports
  delete output.sourceContext
  return canonicalizeWorldDocument(output)
}

function compiledFingerprint(world) {
  const graph = world.compiled.resourceGraph
  return {
    entities: world.compiled.entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
      parentId: entity.parentId ?? null,
      sourceDocumentUrl: entity.authoring?.sourceDocumentUrl ?? null,
    })),
    primitives: world.compiled.primitives.map((primitive) => ({
      entityId: primitive.entityId,
      type: primitive.type,
      material: primitive.material ?? null,
    })),
    colliders: world.compiled.colliders.map((collider) => ({
      entityId: collider.entityId,
      shape: collider.shape,
    })),
    resources: graph
      ? ['asset', 'material', 'geometry', 'instance'].flatMap((kind) => graph.list(kind).map((entry) => `${kind}:${entry.id}`)).sort()
      : [],
  }
}

test('bundleResolvedWorldDocument removes imports and preserves deterministic namespaced reusable resources', async () => {
  const bundled = bundleResolvedWorldDocument(await resolvedGraph())

  assert.equal(Object.prototype.hasOwnProperty.call(bundled, 'imports'), false)
  assert.deepEqual(bundled.entities.map((entity) => entity.composition), ['tree::root', 'tree::root'])
  assert.ok(bundled.assets['tree::asset::barkTex'])
  assert.ok(bundled.materials['tree::material::bark'])
  assert.ok(bundled.geometries['tree::geometry::trunk'])
  assert.ok(bundled.compositions['tree::composition::crowned'])
  assert.ok(bundled.compositions['tree::crown::root'])
  assert.ok(bundled.compositions['tree::root'])
  assert.equal(bundled.compositions['tree::composition::crowned'].children[0].composition, 'tree::crown::root')
  assert.equal(bundled.compositions['tree::root'].provenance.source, TREE_URL)
  assert.equal(bundled.compositions['tree::crown::root'].provenance.source, CROWN_URL)
  assert.equal(inspectWorldDocument(bundled).valid, true)
})

test('bundling materializes root and imported URL ownership so moving the standalone JSON does not change binary asset meaning', async () => {
  const bundled = await bundleWorldDocument(worldDocument(), options())
  assert.equal(bundled.assets.rootTex.src, `${BASE}assets/root.png`)
  assert.equal(bundled.assets.rootSecondary.src, `${BASE}assets/secondary.png`)
  assert.equal(bundled.assets['tree::asset::barkTex'].src, `${BASE}models/textures/bark.png`)
  assert.equal(bundled.assets['tree::crown::asset::leafTex'].src, `${BASE}models/parts/textures/crown.png`)
})

test('canonical bundled output is deterministic across equivalent resource-map insertion order', async () => {
  const first = await bundleWorldDocument(worldDocument(false), options([], worldDocument(false)))
  const second = await bundleWorldDocument(worldDocument(true), options([], worldDocument(true)))
  assert.equal(serializeWorldDocument(first), serializeWorldDocument(second))
})

test('modular and standalone bundled worlds normalize and compile equivalently', async () => {
  const graph = await resolvedGraph()
  const lowered = instantiateResolvedWorldDocument(graph)
  const bundled = bundleResolvedWorldDocument(graph)

  assert.deepEqual(
    normalizedSemantic(lowered, graph.sourceContext),
    normalizedSemantic(bundled),
  )

  const modularCalls = []
  const modularLoader = mapLoader({
    [ROOT_URL]: worldDocument(),
    [TREE_URL]: treeObject(),
    [CROWN_URL]: crownObject(),
  }, modularCalls)
  const modular = createWorld({ plugins: [entitiesPlugin()], documentLoader: modularLoader, autoResize: false })
  await modular.load(ROOT_URL)

  let standaloneLoaderCalls = 0
  const standalone = createWorld({
    plugins: [entitiesPlugin()],
    documentLoader: async () => {
      standaloneLoaderCalls += 1
      throw new Error('bundled world must not request external Anyo JSON documents')
    },
    autoResize: false,
  })
  await standalone.load(bundled)

  assert.deepEqual(compiledFingerprint(standalone), compiledFingerprint(modular))
  assert.equal(standaloneLoaderCalls, 0)
  assert.deepEqual(modularCalls.map((entry) => entry.url), [ROOT_URL, TREE_URL, CROWN_URL])

  await standalone.dispose()
  await modular.dispose()
})

test('bundleWorldDocument leaves no runtime dependency on imported Anyo JSON documents', async () => {
  const calls = []
  const bundled = await bundleWorldDocument(worldDocument(), options(calls))
  assert.deepEqual(calls.map((entry) => entry.url), [TREE_URL, CROWN_URL])
  assert.equal('imports' in bundled, false)
  assert.equal(JSON.stringify(bundled).includes('.anyo.json'), true, 'provenance may retain source URLs without creating a runtime dependency')

  const runtime = createWorld({ plugins: [entitiesPlugin()], documentLoader: async () => { throw new Error('should not load') }, autoResize: false })
  await runtime.load(bundled)
  assert.equal(runtime.document.version, '0.9')
  await runtime.dispose()
})

test('published declarations expose the Step 7 bundle APIs', async () => {
  const declarations = await readFile(declarationsUrl, 'utf8')
  assert.match(declarations, /bundleResolvedWorldDocument/)
  assert.match(declarations, /bundleWorldDocument/)
})
