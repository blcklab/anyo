import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyJsonPatchValue,
  applyStableTransaction,
  buildCompilerDependencyGraph,
  canonicalWorldString,
  hashWorldDocument,
  inspectWorldDocument,
  normalizeWorldDocument,
} from '../dist/esm/index.js'

function createFixture(count = 10_000) {
  return {
    version: '0.7', revision: 10,
    channels: { render: { world: 1 }, picking: { interactive: 1 }, editor: { default: 1 } },
    cameras: { main: { type: 'perspective', position: [0, 3, 8], layers: ['world'] } }, activeCamera: 'main',
    materials: Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`material-${index}`, { baseColor: '#778899', roughness: 0.5 }])),
    assets: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`asset-${index}`, { type: 'model', src: `./asset-${index}.glb` }])),
    prefabs: { crate: { type: 'box', material: 'material-0', size: [1, 1, 1] } },
    data: { visibility: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`group${index}`, true])) },
    entities: Array.from({ length: count }, (_, index) => ({
      id: `entity-${index}`, authoringId: `track-f:${index}`,
      ...(index % 20 === 0 ? { use: 'crate', instanceId: `crate-${index}` } : { type: index % 100 === 0 ? 'model' : 'box' }),
      ...(index % 100 === 0 ? { asset: `asset-${index % 8}` } : {}),
      material: `material-${index % 32}`,
      position: [index % 100, 0, -Math.floor(index / 100)], layers: ['world'],
      pickLayers: index % 10 === 0 ? ['interactive'] : [],
      visible: index % 5 === 0 ? { $bind: `visibility.group${index % 12}`, fallback: true } : true,
    })),
    extensions: { 'track-f.fixture': { preserved: true } },
  }
}

test('Track F validates and normalizes a deterministic 10_000 entity world', () => {
  const document = createFixture(10_000)
  const report = inspectWorldDocument(document)
  assert.equal(report.valid, true, report.errors.map(item => item.message).join('\n'))
  const normalized = normalizeWorldDocument(document)
  assert.equal(normalized.entities.length, 10_000)
  const graph = buildCompilerDependencyGraph(document)
  assert.equal(graph.materialConsumers.size, 32)
  assert.ok(graph.assetConsumers.size >= 2)
  assert.equal(graph.variableBindings.size, 12)
})

test('Track F stable-ID updates are atomic, reversible, and deterministic', () => {
  const document = createFixture(1000)
  const beforeHash = hashWorldDocument(document)
  const result = applyStableTransaction(document, {
    id: 'move-one', baseRevision: 10, revision: 11,
    operations: [{ op: 'replace', target: { entityId: 'entity-500' }, path: '/position/0', value: 5000 }],
  })
  assert.equal(result.affectedEntities.size, 1)
  assert.equal(result.document.entities.find(item => item.id === 'entity-500').position[0], 5000)
  const restored = structuredClone(result.document)
  for (const patch of result.inverse) applyJsonPatchValue(restored, patch)
  restored.revision = 10
  assert.equal(canonicalWorldString(restored), canonicalWorldString(document))
  assert.equal(hashWorldDocument(document), beforeHash)
  assert.deepEqual(restored.extensions, document.extensions)
})

test('Track F security limits reject excessive authored documents without executing extension data', () => {
  const document = createFixture(150)
  document.extensions['untrusted.example'] = { constructor: 'not-code', __proto__: 'data-only' }
  const report = inspectWorldDocument(document, { limits: { maxEntities: 100 } })
  assert.equal(report.valid, false)
  assert.ok(report.errors.some(item => /ENTITY|LIMIT|COUNT/i.test(`${item.code} ${item.message}`)))
})
