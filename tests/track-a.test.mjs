import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ExtensionRegistry,
  applyStableTransaction,
  buildCompilerDependencyGraph,
  canonicalSnapshotString,
  canonicalWorldString,
  compileCameras,
  compileWorldChannels,
  createPortableWorldPackageDescriptor,
  createPortableWorldPackageManifest,
  createWorld,
  createWorldSchema,
  hashWorldDocument,
  inspectArchitectureDocument,
  inspectAssetManifest,
  inspectWorldDocument,
  migrateWorldDocument,
  normalizeWorldDocument,
  resolveChannelMask,
  resolveRenderingConfiguration,
  serializeWorldDocument,
} from '../dist/esm/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

const schemaUrl = new URL('../schemas/world-0.7.schema.json', import.meta.url)


class IncrementalRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = {
    position: [0, 0, 0], rotation: [0, 0],
    getPosition() { return [...this.position] }, setPosition(value) { this.position = [...value] },
    getRotation() { return [...this.rotation] }, setRotation(yaw, pitch) { this.rotation = [yaw, pitch] },
    getForward() { return [0, 0, -1] }, getRight() { return [1, 0, 0] },
  }
  mountCalls = 0
  changes = []
  async mount() { this.mountCalls += 1 }
  async applyChanges(changes) { this.changes.push(...changes) }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

test('A2 world 0.7 schema is draft 2020-12, root-strict, extension-aware, and prefab ids remain map-owned', async () => {
  const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.match(schema.$id, /world-0\.7\.schema\.json$/)
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.extensions.additionalProperties, true)
  assert.ok(!schema.$defs.prefab.required?.includes('id'))
})

test('A2 extension schema composition is deterministic and namespace-safe', () => {
  const first = createWorldSchema({ extensions: [
    { id: 'shop.product', root: { type: 'object' }, definitions: { product: { type: 'string' } } },
    { id: 'factory.sensor', root: { type: 'object' } },
  ] })
  const second = createWorldSchema({ extensions: [
    { id: 'factory.sensor', root: { type: 'object' } },
    { id: 'shop.product', root: { type: 'object' }, definitions: { product: { type: 'string' } } },
  ] })
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.ok(first.properties.extensions.properties['shop.product'])
  assert.ok(first.$defs.shop_product__product)
  assert.throws(() => createWorldSchema({ extensions: [{ id: 'x' }, { id: 'x' }] }), /duplicated/)
})

test('A3-A4 cameras and named channels compile to renderer-neutral records and masks', () => {
  const channels = compileWorldChannels({
    render: { world: 1, characters: 2 },
    picking: { interactive: 1 },
    editor: { selected: 1 },
  })
  assert.equal(resolveChannelMask(['world', 'characters'], channels.render), 3)
  const result = compileCameras({
    main: { type: 'perspective', position: [1, 2, 3], layers: ['world'], priority: 2 },
    map: { type: 'orthographic', position: [0, 100, 0], size: 80, layers: ['world', 'characters'], priority: 1 },
  }, undefined, channels)
  assert.equal(result.activeCameraId, 'main')
  assert.equal(result.cameras.find((camera) => camera.id === 'main').renderMask, 1)
  assert.equal(result.cameras.find((camera) => camera.id === 'map').renderMask, 3)
  assert.throws(() => compileCameras({ bad: { type: 'perspective', layers: ['missing'] } }, undefined, channels), /Unknown channel/)
})

test('A3 rendering intent resolves deterministically under host and device policy', () => {
  const resolved = resolveRenderingConfiguration(
    { quality: 'ultra', exposure: 99, pixelRatio: { mode: 'adaptive', maximum: 3 }, antialiasing: 'auto', capabilityRequirements: { hdrTargets: true } },
    { forcedBackend: 'webgpu', maximumQuality: 'high', maximumPixelRatio: 1.5, memoryBudgetMB: 512, accessibility: { reducedMotion: true } },
    { backend: 'webgl2', supportedQuality: ['low', 'medium', 'high'], maximumPixelRatio: 2, features: { hdrTargets: false } },
  )
  assert.equal(resolved.backend, 'webgpu')
  assert.equal(resolved.quality, 'high')
  assert.equal(resolved.exposure, 8)
  assert.equal(resolved.pixelRatio.maximum, 1.5)
  assert.equal(resolved.antialiasing, 'fxaa')
  assert.equal(resolved.memoryBudgetMB, 512)
  assert.equal(resolved.accessibility.reducedMotion, true)
  assert.ok(resolved.diagnostics.some((item) => item.code === 'RENDER_QUALITY_CLAMPED'))
  assert.ok(resolved.diagnostics.some((item) => item.code === 'RENDER_CAPABILITY_UNAVAILABLE'))
})

test('A6 extension manifests resolve capabilities, detect collisions, and run code-side hooks', () => {
  const registry = new ExtensionRegistry()
  registry.register({
    id: 'shop.product', version: '1.2.0', capabilities: ['catalog'], actions: ['shop.open'], schemaVersions: ['^0.7'],
    schema: { type: 'object' },
    validate: (document) => document.metadata?.shop ? [] : [{ severity: 'warning', code: 'SHOP_METADATA_MISSING', message: 'shop metadata is recommended' }],
    migrate: (document) => ({ ...document, metadata: { ...document.metadata, migratedByShop: true } }),
  })
  assert.deepEqual(registry.resolve({ 'shop.product': { version: '^1.0.0', capabilities: ['catalog'] } }, '0.7'), [])
  assert.equal(registry.resolve({ optional: { version: '^1.0.0', required: false } }, '0.7')[0].severity, 'warning')
  assert.equal(registry.validate({ version: '0.7' })[0].code, 'shop.product:SHOP_METADATA_MISSING')
  assert.equal(registry.migrate({ version: '0.7' }, '0.6', '0.7').metadata.migratedByShop, true)
  assert.equal(registry.schemaContributions()[0].id, 'shop.product')
  assert.throws(() => registry.register({ id: 'other', version: '1.0.0', actions: ['shop.open'] }), /collision/)
})

test('A6 registered extension migrations and snapshot hooks integrate through World without dynamic package loading', async () => {
  const registry = new ExtensionRegistry()
  registry.register({
    id: 'quest.state', version: '1.0.0', schemaVersions: ['^0.7'],
    migrate: (document) => ({ ...document, metadata: { ...document.metadata, questMigrated: true } }),
    snapshot: { id: 'quest.state', create: () => ({ active: 'intro' }) },
  })
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false, validation: { extensionRegistry: registry } })
  await world.load({ version: '0.6', entities: [{ id: 'marker', type: 'box' }] })
  assert.equal(world.getSourceDocument().version, '0.7')
  assert.equal(world.getSourceDocument().metadata.questMigrated, true)
  assert.deepEqual(world.createSnapshot().extensions['quest.state'], { active: 'intro' })
  world.dispose()
})

test('A5 safe declarative actions mutate state and activate cameras without executable strings', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await world.load({
    version: '0.7', revision: 0,
    data: { count: 1 },
    cameras: {
      main: { type: 'perspective', position: [0, 2, 5] },
      map: { type: 'orthographic', position: [0, 30, 0], size: 20 },
    },
    activeCamera: 'main',
    events: {
      ready: [{ type: 'sequence', actions: [
        { type: 'incrementVariable', path: 'count', amount: 2 },
        { type: 'activateCamera', camera: 'map' },
        { type: 'setVisibility', target: 'box', visible: false },
      ] }],
    },
    entities: [{ id: 'box', type: 'box' }],
  })
  await world.dispatchDocumentEvent('ready', { source: 'test' })
  assert.equal(world.getData('count'), 3)
  assert.equal(world.compiled.activeCameraId, 'map')
  assert.equal(world.document.entities.find((entity) => entity.id === 'box').visible, false)
  const invalidActions = inspectWorldDocument({ version: '0.7', events: { bad: [{ type: 'sequence', actions: [] }] } })
  assert.equal(invalidActions.valid, false)
  assert.ok(invalidActions.errors.some((issue) => issue.code === 'ACTION_SEQUENCE_REQUIRED'))
  world.dispose()
})



test('A5 built-in actions validate concrete entity and camera references before mount', () => {
  const result = inspectWorldDocument({
    version: '0.7',
    cameras: { main: { type: 'perspective' } },
    entities: [{ id: 'known', type: 'box' }],
    events: {
      invalid: [
        { type: 'setVisibility', target: 'missing', visible: false },
        { type: 'activateCamera', camera: 'missing-camera' },
      ],
      symbolic: [{ type: 'setVisibility', target: '$self', visible: true }],
    },
  })
  assert.ok(result.errors.some((issue) => issue.code === 'ACTION_TARGET_UNKNOWN'))
  assert.ok(result.errors.some((issue) => issue.code === 'ACTION_CAMERA_UNKNOWN'))
  assert.ok(!result.errors.some((issue) => issue.path?.includes('/symbolic/')))
})

test('A7 stable-id patch transactions are atomic, revisioned, and room-component aware', () => {
  const source = {
    version: '0.7', revision: 4,
    building: { floors: [{ id: 'f', elevation: 0, rooms: [{ id: 'r', size: [4, 4], entities: [{ id: 'sensor', type: 'box', components: [{ id: 'status', type: 'example.status', data: { value: 1 } }] }] }] }] },
    entities: [{ id: 'chair', authoringId: 'author:chair', type: 'box', position: [0, 0, 0] }],
  }
  const applied = applyStableTransaction(source, {
    id: 'tx-5', baseRevision: 4, revision: 5,
    operations: [
      { op: 'test', target: { authoringId: 'author:chair' }, path: '/position/0', value: 0 },
      { op: 'replace', target: { entityId: 'chair' }, path: '/position/0', value: 4 },
      { op: 'replace', target: { componentId: 'status' }, path: '/data/value', value: 2 },
    ],
  })
  assert.equal(source.revision, 4)
  assert.equal(applied.document.revision, 5)
  assert.equal(applied.document.entities[0].position[0], 4)
  assert.equal(applied.document.building.floors[0].rooms[0].entities[0].components[0].data.value, 2)
  assert.throws(() => applyStableTransaction(source, { id: 'stale', baseRevision: 3, operations: [{ op: 'remove', target: { entityId: 'chair' }, path: '/position' }] }), /Stale/)
  assert.throws(() => applyStableTransaction(source, { id: 'atomic', baseRevision: 4, operations: [{ op: 'replace', target: { entityId: 'chair' }, path: '/position/0', value: 9 }, { op: 'test', target: { entityId: 'chair' }, path: '/position/1', value: 9 }] }), /test failed/)
  assert.equal(source.entities[0].position[0], 0)

  const addedCollections = applyStableTransaction({ version: '0.7', revision: 0, entities: [] }, {
    id: 'add-architecture-records', baseRevision: 0,
    operations: [
      { op: 'add', target: { cameraId: 'main' }, path: '/', value: { type: 'perspective', position: [0, 2, 6], fov: 55, near: 0.1, far: 1000 } },
      { op: 'add', target: { assetId: 'town' }, path: '/', value: { type: 'model', src: './town.glb' } },
    ],
  })
  assert.equal(addedCollections.document.cameras.main.fov, 55)
  assert.equal(addedCollections.document.assets.town.src, './town.glb')
  assert.deepEqual(addedCollections.inverse.map((patch) => patch.path), ['/assets/town', '/assets', '/cameras/main', '/cameras'])
})

test('A8 dependency graph identifies selective material, asset, prefab, variable, and camera consumers', () => {
  const graph = buildCompilerDependencyGraph({
    version: '0.7',
    cameras: { follow: { type: 'perspective', follow: { entity: 'hero' } } },
    prefabs: { tree: { type: 'model', asset: 'treeModel', material: 'leaf' } },
    entities: [
      { id: 'hero', type: 'model', asset: 'heroModel', material: 'heroMat', visible: { $bind: 'ui.heroVisible' } },
      { id: 'tree-1', use: 'tree', instanceId: 'tree-instance-1' },
    ],
  })
  assert.ok(graph.materialConsumers.get('heroMat').has('hero'))
  assert.ok(graph.assetConsumers.get('heroModel').has('hero'))
  assert.ok(graph.prefabInstances.get('tree').has('tree-instance-1'))
  assert.ok(graph.variableBindings.get('ui.heroVisible').has('hero'))
  assert.ok(graph.cameraDependents.get('hero').has('follow'))
})

test('A8 material and camera transactions update the renderer incrementally without remounting geometry', async () => {
  const renderer = new IncrementalRenderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false })
  await world.load({
    version: '0.7', revision: 0,
    cameras: { main: { type: 'perspective', position: [0, 2, 5] } }, activeCamera: 'main',
    materials: { wall: { color: '#ffffff' } },
    entities: [{ id: 'wall', type: 'box', material: 'wall' }],
  })
  const materialResult = await world.applyTransaction({ id: 'material', baseRevision: 0, operations: [{ op: 'replace', target: { materialId: 'wall' }, path: '/color', value: '#ff0000' }] })
  assert.equal(materialResult.applied, true)
  assert.equal(materialResult.rebuildRequired, false)
  assert.ok(materialResult.rendererChanges.some((change) => change.type === 'primitive-material'))
  const cameraResult = await world.applyTransaction({ id: 'camera', baseRevision: 1, operations: [{ op: 'replace', target: { cameraId: 'main' }, path: '/position/0', value: 4 }] })
  assert.equal(cameraResult.applied, true)
  assert.ok(cameraResult.rendererChanges.some((change) => change.type === 'camera-update'))
  assert.equal(renderer.mountCalls, 1)
  world.dispose()
})

test('A9 prefabs keep source references, support inheritance and overrides, and generate stable instance identities', () => {
  const source = {
    version: '0.7',
    prefabs: {
      base: { type: 'box', size: [1, 1, 1], material: 'stone' },
      tall: { extends: 'base', size: [1, 2, 1] },
    },
    entities: [{ id: 'tower', use: 'tall', instanceId: 'tower-a', overrides: { '/size/0': 3 } }],
  }
  const first = normalizeWorldDocument(source)
  const second = normalizeWorldDocument(structuredClone(source))
  assert.equal(first.entities[0].size[0], 3)
  assert.equal(first.entities[0].size[1], 2)
  assert.equal(first.entities[0].authoringId, second.entities[0].authoringId)
  assert.match(serializeWorldDocument(source), /"use": "tall"/)
  assert.throws(() => normalizeWorldDocument({ version: '0.7', prefabs: { a: { extends: 'b' }, b: { extends: 'a' } }, entities: [{ id: 'x', use: 'a' }] }), /(cycle|circular)/i)
})

test('A10 runtime snapshots remain separate until explicit commit and extension state is deterministic', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  let extensionValue = { quest: 2 }
  world.registerSnapshotExtension({
    id: 'quest.state',
    create: () => extensionValue,
    restore: (value) => { extensionValue = value },
    commit: (value, document) => { document.extensions = { ...(document.extensions ?? {}), 'quest.state': value } },
  })
  await world.load({ version: '0.7', revision: 7, metadata: { id: 'snapshot-world' }, data: { coins: 10 }, entities: [{ id: 'hero', type: 'box', position: [0, 0, 0] }] })
  await world.setData('coins', 20)
  const snapshot = world.createSnapshot()
  assert.equal(snapshot.worldRevision, 7)
  assert.equal(snapshot.variables.coins, 20)
  assert.deepEqual(snapshot.extensions['quest.state'], { quest: 2 })
  assert.equal(JSON.parse(world.serialize()).data.coins, 10)
  const canonical = canonicalSnapshotString(snapshot)
  assert.equal(canonical, canonicalSnapshotString(structuredClone(snapshot)))
  await world.restoreSnapshot({ snapshotVersion: '1.0', worldRevision: 7, worldId: 'snapshot-world', variables: { coins: 25 } })
  assert.equal(world.getData('coins'), 25)
  await assert.rejects(world.restoreSnapshot({ snapshotVersion: '1.0', worldRevision: 7, worldId: 'other-world' }), /does not match/)
  await world.commitSnapshot(snapshot)
  assert.equal(JSON.parse(world.serialize()).data.coins, 20)
  assert.deepEqual(JSON.parse(world.serialize()).extensions['quest.state'], { quest: 2 })
  world.dispose()
})

test('A11 asset manifests validate dependencies and produce deterministic portable package descriptors', () => {
  const document = {
    version: '0.7', revision: 1,
    assets: {
      texture: { type: 'image', src: './textures/wall.png', sizeBytes: 100, integrity: 'sha256-YWJj' },
      town: { type: 'model', src: './models/town.glb', sizeBytes: 900, dependencies: ['texture'], variants: { low: './models/town-low.glb' } },
    },
  }
  const report = inspectAssetManifest(document)
  assert.equal(report.valid, true)
  assert.deepEqual(report.dependencyOrder, ['texture', 'town'])
  assert.equal(report.totalDeclaredBytes, 1000)
  const manifest = createPortableWorldPackageManifest(document)
  assert.equal(manifest.documentHash, hashWorldDocument(document))
  const descriptor = createPortableWorldPackageDescriptor(document)
  assert.ok(descriptor.files['world.anyo.json'])
  assert.ok(descriptor.files['manifest.json'])
  assert.equal(descriptor.requiredAssets.length, 2)
  assert.throws(() => createPortableWorldPackageDescriptor(document, { assetDirectory: '../escape' }), /safe relative/)
  assert.equal(inspectAssetManifest({ assets: { a: { src: 'a', dependencies: ['b'] }, b: { src: 'b', dependencies: ['a'] } } }).valid, false)
})

test('A12 canonical serialization and security limits are deterministic and reject unsafe worlds', () => {
  const a = { version: '0.7', revision: -0, metadata: { b: 2, a: 1 }, entities: [{ id: 'x', type: 'box' }] }
  const b = { entities: [{ type: 'box', id: 'x' }], metadata: { a: 1, b: 2 }, revision: 0, version: '0.7' }
  assert.equal(canonicalWorldString(a), canonicalWorldString(b))
  assert.equal(hashWorldDocument(a), hashWorldDocument(b))
  const limited = inspectWorldDocument({ version: '0.7', entities: [{ id: 'a', type: 'box' }, { id: 'b', type: 'box' }] }, { limits: { maxEntities: 1 } })
  assert.ok(limited.errors.some((issue) => issue.code === 'ENTITY_LIMIT_EXCEEDED'))
  const blocked = inspectArchitectureDocument({ version: '0.7', assets: { remote: { src: 'javascript:alert(1)' } } }, { assetUrlPolicy: (src) => !src.startsWith('javascript:') || 'Unsafe URL scheme.' })
  assert.ok(blocked.some((issue) => issue.code === 'ASSET_URL_REJECTED'))
  assert.throws(() => canonicalWorldString({ version: '0.7', metadata: { __proto__: { polluted: true } } }), /unsafe|forbidden|prototype/i)
})

test('A12 migration to world 0.7 is deterministic, idempotent, and preserves unknown legacy root data', () => {
  const legacy = {
    version: '0.6',
    metadata: { id: 'legacy-world' },
    customLegacyFeature: { enabled: true },
    entities: [{ id: 'box', type: 'box' }],
  }
  const first = migrateWorldDocument(legacy)
  const second = migrateWorldDocument(first.document)
  assert.equal(first.document.version, '0.7')
  assert.equal(first.document.revision, 0)
  assert.deepEqual(first.document.extensions['anyo.legacyRoot'].customLegacyFeature, { enabled: true })
  assert.equal(canonicalWorldString(first.document), canonicalWorldString(second.document))
  assert.deepEqual(second.changes, [])
})

test('A12 future document versions fail with structured diagnostics instead of silent downgrade', () => {
  const result = inspectWorldDocument({ version: '99.0', entities: [] })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((issue) => /version/i.test(issue.code) || /version/i.test(issue.message)))
})

