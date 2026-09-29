import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AnyoImportError,
  createWorld,
  entitiesPlugin,
  inspectAnyoObjectDocument,
  inspectWorldDocument,
  instantiateResolvedWorldDocument,
  resolveWorldDocumentImports,
} from '../dist/esm/index.js'

const BASE = 'https://example.test/world/'

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
    assets: { leafTex: { type: 'texture', src: './textures/crown.png' } },
    materials: { bark: { baseColor: '#2f6d3a', baseColorTexture: 'leafTex' } },
    root: {
      provenance: { license: 'MIT' },
      children: [
        { id: 'crown', type: 'sphere', radius: 1.5, material: 'bark', collision: true },
      ],
    },
  }
}

function treeObject() {
  return {
    kind: 'anyo-object',
    version: '0.1',
    metadata: { id: 'hero-tree' },
    imports: { crown: { src: './parts/crown.anyo.json' } },
    assets: {
      barkTex: { type: 'texture', src: './textures/bark.png' },
      barkPacked: { type: 'texture', src: './textures/bark-packed.png', dependencies: ['barkTex'], fallback: 'barkTex' },
    },
    materials: {
      bark: {
        baseColor: '#6b4423',
        baseColorTexture: 'barkTex',
        detail: { normalTexture: 'barkTex', roughnessTexture: 'barkPacked' },
        mtoon: { faceShadowTexture: 'barkTex' },
      },
    },
    geometries: {
      trunk: { kind: 'cylinder', radius: 0.35, height: 3, segments: 12 },
      branch: { kind: 'box', size: [0.2, 1.2, 0.2] },
    },
    compositions: {
      branch: {
        provenance: { package: '@demo/tree-parts' },
        children: [
          { id: 'branch-body', type: 'geometry', geometry: 'branch', material: 'bark' },
        ],
      },
      crowned: {
        children: [
          { id: 'nested-crown', composition: 'crown', position: [0, 2.5, 0] },
        ],
      },
    },
    root: {
      provenance: { license: 'MIT' },
      children: [
        {
          id: 'trunk',
          type: 'geometry',
          geometry: 'trunk',
          material: 'bark',
          materialBindings: { bark: 'bark' },
          collision: true,
          collisionPolicy: 'bounds',
          components: [{ type: 'anyo.vfx', material: 'bark', maxParticles: 8 }],
        },
        { id: 'branch-instance', composition: 'branch', position: [0, 1.5, 0] },
        { id: 'crowned-instance', composition: 'crowned' },
      ],
    },
  }
}

function worldDocument() {
  return {
    version: '0.9',
    imports: { tree: { src: './models/tree.anyo.json' } },
    entities: [
      { id: 'oak-a', composition: 'tree', position: [1, 0, 0] },
      { id: 'oak-b', composition: 'tree', position: [-1, 0, 0] },
    ],
  }
}

async function graph() {
  return resolveWorldDocumentImports(worldDocument(), {
    sourceContext: { documentUrl: `${BASE}world.anyo.json`, baseUrl: BASE },
    documentLoader: mapLoader({
      [`${BASE}models/tree.anyo.json`]: treeObject(),
      [`${BASE}models/parts/crown.anyo.json`]: crownObject(),
    }),
  })
}


test('instantiation is a structural no-op when a resolved graph has no imports', () => {
  const legacy = {
    version: '0.2',
    entities: [{ id: 'legacy-box', type: 'box', size: [1, 1, 1] }],
  }
  const instantiated = instantiateResolvedWorldDocument({ document: legacy, imports: {} })
  assert.deepEqual(instantiated, legacy)
  assert.equal(Object.prototype.hasOwnProperty.call(instantiated, 'assets'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(instantiated, 'materials'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(instantiated, 'geometries'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(instantiated, 'compositions'), false)
})

test('import aliases are valid composition targets while alias/local composition ambiguity is rejected', () => {
  const valid = inspectWorldDocument(worldDocument())
  assert.equal(valid.valid, true, valid.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))

  const object = inspectAnyoObjectDocument({
    ...treeObject(),
    root: { children: [{ id: 'external', composition: 'crown' }] },
  })
  assert.equal(object.valid, true, object.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))

  const conflict = inspectWorldDocument({
    version: '0.9',
    imports: { tree: { src: './tree.anyo.json' } },
    compositions: { tree: { children: [] } },
    entities: [],
  })
  assert.equal(conflict.valid, false)
  assert.equal(conflict.errors.some((entry) => entry.code === 'ANYO_IMPORT_ALIAS_COMPOSITION_CONFLICT'), true)
})

test('resolved object graphs lower to ordinary deterministic namespaced Anyo resources and compositions', async () => {
  const instantiated = instantiateResolvedWorldDocument(await graph())

  assert.deepEqual(instantiated.entities.map((entity) => entity.composition), ['tree::root', 'tree::root'])
  assert.ok(instantiated.assets['tree::asset::barkTex'])
  assert.ok(instantiated.assets['tree::asset::barkPacked'])
  assert.ok(instantiated.assets['tree::crown::asset::leafTex'])
  assert.ok(instantiated.materials['tree::material::bark'])
  assert.ok(instantiated.materials['tree::crown::material::bark'])
  assert.ok(instantiated.geometries['tree::geometry::trunk'])
  assert.ok(instantiated.geometries['tree::geometry::branch'])
  assert.ok(instantiated.compositions['tree::composition::branch'])
  assert.ok(instantiated.compositions['tree::composition::crowned'])
  assert.ok(instantiated.compositions['tree::crown::root'])
  assert.ok(instantiated.compositions['tree::root'])

  assert.equal(instantiated.assets['tree::asset::barkPacked'].fallback, 'tree::asset::barkTex')
  assert.deepEqual(instantiated.assets['tree::asset::barkPacked'].dependencies, ['tree::asset::barkTex'])
  const bark = instantiated.materials['tree::material::bark']
  assert.equal(bark.baseColorTexture, 'tree::asset::barkTex')
  assert.equal(bark.detail.normalTexture, 'tree::asset::barkTex')
  assert.equal(bark.detail.roughnessTexture, 'tree::asset::barkPacked')
  assert.equal(bark.mtoon.faceShadowTexture, 'tree::asset::barkTex')

  const root = instantiated.compositions['tree::root']
  const trunk = root.children.find((entry) => entry.id === 'trunk')
  assert.equal(trunk.geometry, 'tree::geometry::trunk')
  assert.equal(trunk.material, 'tree::material::bark')
  assert.equal(trunk.materialBindings.bark, 'tree::material::bark')
  assert.equal(trunk.components[0].material, 'tree::material::bark')
  assert.equal(root.children.find((entry) => entry.id === 'branch-instance').composition, 'tree::composition::branch')
  assert.equal(instantiated.compositions['tree::composition::crowned'].children[0].composition, 'tree::crown::root')

  assert.equal(root.provenance.license, 'MIT')
  assert.equal(root.provenance.source, `${BASE}models/tree.anyo.json`)
  assert.equal(instantiated.compositions['tree::composition::branch'].provenance.package, '@demo/tree-parts')
  assert.equal(instantiated.compositions['tree::composition::branch'].provenance.source, `${BASE}models/tree.anyo.json`)
  assert.equal(instantiated.compositions['tree::crown::root'].provenance.source, `${BASE}models/parts/crown.anyo.json`)

  // Step 6 is runtime lowering, not Step 7 bundling: the authoring import declaration remains.
  assert.deepEqual(instantiated.imports, { tree: { src: './models/tree.anyo.json' } })
  assert.equal(inspectWorldDocument(instantiated).valid, true)
})

test('World.load instantiates imported objects through normal composition, component, resource, and collision machinery', async () => {
  const calls = []
  const loader = mapLoader({
    [`${BASE}world.anyo.json`]: worldDocument(),
    [`${BASE}models/tree.anyo.json`]: treeObject(),
    [`${BASE}models/parts/crown.anyo.json`]: crownObject(),
  }, calls)
  const world = createWorld({ plugins: [entitiesPlugin()], documentLoader: loader, autoResize: false })
  await world.load(`${BASE}world.anyo.json`)

  assert.deepEqual(calls.map((entry) => entry.url), [
    `${BASE}world.anyo.json`,
    `${BASE}models/tree.anyo.json`,
    `${BASE}models/parts/crown.anyo.json`,
  ])
  assert.equal(world.document.entities.length, 2)
  assert.ok(world.compiled.entityById.has('oak-a/trunk'))
  assert.ok(world.compiled.entityById.has('oak-a/branch-instance/branch-body'))
  assert.ok(world.compiled.entityById.has('oak-a/crowned-instance/nested-crown/crown'))
  assert.ok(world.compiled.entityById.has('oak-b/trunk'))
  assert.equal(world.compiled.entityById.get('oak-a/trunk').authoring.sourceDocumentUrl, `${BASE}models/tree.anyo.json`)
  assert.equal(
    world.compiled.entityById.get('oak-a/crowned-instance/nested-crown/crown').authoring.sourceDocumentUrl,
    `${BASE}models/parts/crown.anyo.json`,
  )

  const trunk = world.document.entities[0].children.find((entry) => entry.id === 'oak-a/trunk')
  assert.equal(trunk.material, 'tree::material::bark')
  assert.equal(trunk.geometry, 'tree::geometry::trunk')
  assert.equal(trunk.components.find((component) => component.type === 'anyo.vfx').material, 'tree::material::bark')

  const graph = world.compiled.resourceGraph
  assert.ok(graph)
  assert.ok(graph.list('geometry').length >= 2)
  assert.ok(graph.list('material').length >= 1)
  assert.ok(graph.list('instance').length >= 4)
  assert.equal(world.compiled.colliders.some((collider) => collider.entityId === 'oak-a/trunk'), true)
  assert.equal(world.compiled.colliders.some((collider) => collider.entityId === 'oak-b/trunk'), true)

  // No renderer/import-special entity type leaks through compilation.
  assert.equal(world.compiled.entities.some((entity) => entity.type === 'anyo-object' || entity.type === 'import'), false)
  await world.dispose()
})

test('independent aliases of the same object remain resource-isolated after instantiation', async () => {
  const doc = {
    version: '0.9',
    imports: {
      a: { src: './shared.anyo.json' },
      b: { src: './shared.anyo.json' },
    },
    entities: [
      { id: 'a-instance', composition: 'a' },
      { id: 'b-instance', composition: 'b' },
    ],
  }
  // Use a minimal shared object so the assertion isolates alias/resource namespacing.
  const shared = {
    kind: 'anyo-object', version: '0.1',
    materials: { bark: { color: '#654321' } },
    root: { children: [{ id: 'body', type: 'box', material: 'bark' }] },
  }
  const graph = await resolveWorldDocumentImports(doc, {
    sourceContext: { documentUrl: `${BASE}world.anyo.json`, baseUrl: BASE },
    documentLoader: mapLoader({ [`${BASE}shared.anyo.json`]: shared }),
  })
  const instantiated = instantiateResolvedWorldDocument(graph)
  assert.ok(instantiated.materials['a::material::bark'])
  assert.ok(instantiated.materials['b::material::bark'])
  assert.equal(instantiated.compositions['a::root'].children[0].material, 'a::material::bark')
  assert.equal(instantiated.compositions['b::root'].children[0].material, 'b::material::bark')
})

test('generated namespace collisions fail deterministically instead of overwriting root-world resources', async () => {
  const graph = await resolveWorldDocumentImports({
    version: '0.9',
    imports: { tree: { src: './tree.anyo.json' } },
    materials: { 'tree::material::bark': { color: '#000000' } },
    entities: [{ id: 'tree', composition: 'tree' }],
  }, {
    sourceContext: { documentUrl: `${BASE}world.anyo.json`, baseUrl: BASE },
    documentLoader: mapLoader({ [`${BASE}tree.anyo.json`]: {
      kind: 'anyo-object', version: '0.1', materials: { bark: { color: '#ffffff' } }, root: { children: [] },
    } }),
  })
  assert.throws(
    () => instantiateResolvedWorldDocument(graph),
    (error) => {
      assert.ok(error instanceof AnyoImportError)
      assert.equal(error.code, 'ANYO_IMPORTED_RESOURCE_CONFLICT')
      assert.match(error.message, /tree::material::bark/)
      return true
    },
  )
})
