import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  createGeometryCompiler,
} from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'
import { createWorld, entitiesPlugin } from '../dist/esm/index.js'

const showcaseUrl = new URL('../examples/universal-geometry-showcase/world.anyo.json', import.meta.url)
const requiredObjects = [
  'spiral-tower',
  'curved-bridge',
  'tree-like-form',
  'twisted-sculpture',
  'arched-doorway',
  'rocky-formation',
  'pipe-cable-network',
  'procedural-pavilion',
]
const forbiddenSemanticKinds = new Set([
  'tower', 'bridge', 'tree', 'sculpture', 'doorway', 'rock', 'pipe', 'cable', 'pavilion',
  'spiralTower', 'curvedBridge', 'treeLike', 'archedDoorway', 'rockyFormation', 'pipeNetwork', 'proceduralPavilion',
])

async function loadShowcase() {
  return JSON.parse(await readFile(showcaseUrl, 'utf8'))
}
function collectKinds(value, out = []) {
  if (Array.isArray(value)) for (const entry of value) collectKinds(entry, out)
  else if (value && typeof value === 'object') {
    if (typeof value.kind === 'string') out.push(value.kind)
    for (const entry of Object.values(value)) collectKinds(entry, out)
  }
  return out
}
function snapshot(mesh) {
  return {
    positions:[...mesh.positions], indices:[...mesh.indices],
    normals:mesh.normals ? [...mesh.normals] : undefined,
    uvs:mesh.uvs ? [...mesh.uvs] : undefined,
    bounds:mesh.bounds,
  }
}

test('Universal Geometry Step 11: showcase is strict World 0.9 and contains all eight required proof forms', async () => {
  const document = await loadShowcase()
  const result = inspectWorldDocument(document, { mode:'strict' })
  assert.equal(result.valid, true, result.errors.map(issue => `${issue.code}: ${issue.message}`).join('\n'))
  const ids = new Set(document.entities.map(entity => entity.id))
  for (const id of requiredObjects) assert.ok(ids.has(id), `missing showcase object ${id}`)

  const kinds = collectKinds(document)
  for (const semantic of forbiddenSemanticKinds) assert.equal(kinds.includes(semantic), false, `semantic geometry kind leaked into showcase: ${semantic}`)
  for (const definition of Object.values(document.geometries)) assert.ok(BUILTIN_GEOMETRY_KIND_NAMES.includes(definition.kind), definition.kind)
})

test('Universal Geometry Step 11: all showcase geometry compiles deterministically with healthy bounded meshes and zero diagnostics', async () => {
  const document = await loadShowcase()
  const diagnostics = []
  const compiler = createGeometryCompiler({
    curves:document.curves, profiles:document.profiles, fields:document.fields,
    cache:false, onDiagnostic:diagnostic => diagnostics.push(diagnostic),
  })
  let totalVertices = 0
  let totalTriangles = 0
  for (const [id, definition] of Object.entries(document.geometries)) {
    const keyA = compiler.keyFor(definition)
    const keyB = compiler.keyFor(structuredClone(definition))
    assert.match(keyA, /^g2-[0-9a-f]{16}$/)
    assert.equal(keyA, keyB, id)
    const meshA = compiler.compile(definition)
    const meshB = compiler.compile(structuredClone(definition))
    assert.deepEqual(snapshot(meshA), snapshot(meshB), id)
    assert.ok(meshA.positions.length >= 9, id)
    assert.ok(meshA.indices.length >= 3 && meshA.indices.length % 3 === 0, id)
    assert.ok([...meshA.positions].every(Number.isFinite), id)
    assert.ok([...meshA.indices].every(index => index < meshA.positions.length / 3), id)
    totalVertices += meshA.positions.length / 3
    totalTriangles += meshA.indices.length / 3
  }
  assert.equal(diagnostics.length, 0, diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'))
  assert.ok(totalVertices > 8_000, 'showcase should be non-trivial')
  assert.ok(totalVertices < 20_000, 'showcase should remain lightweight')
  assert.ok(totalTriangles > 4_000)
  assert.ok(totalTriangles < 10_000)
})

test('Universal Geometry Step 11: showcase exercises the universal composition stack instead of feature-specific primitives', async () => {
  const document = await loadShowcase()
  assert.equal(document.geometries['tower-ribbon'].kind, 'sweep')
  assert.equal(document.geometries['tree-trunk'].source.kind, 'loft')
  assert.equal(document.geometries['tree-branches'].modifiers[0].kind, 'mirror')
  assert.deepEqual(document.geometries['twisted-sculpture'].modifiers.map(item => item.kind), ['twist','taper','bend','transform'])
  assert.equal(document.geometries['arched-doorway'].kind, 'subtract')
  assert.equal(document.geometries['door-keystone'].kind, 'mesh')
  assert.equal(document.geometries['rocky-formation'].modifiers[0].kind, 'displace')
  assert.equal(document.geometries['rocky-formation'].modifiers[0].field, 'rock-noise')
  assert.equal(document.geometries['pavilion-column-row'].modifiers[0].kind, 'array')
  assert.equal(document.geometries['pavilion-roof'].source.kind, 'loft')
  assert.equal(typeof document.geometries['cable-a'].path, 'string')
  assert.ok(Object.keys(document.curves).length >= 8)
  assert.ok(Object.keys(document.profiles).length >= 8)
  assert.ok(Object.keys(document.fields).length >= 1)
})

test('Universal Geometry Step 11: ResourceGraph keeps the showcase renderer-neutral and authoring resources out of renderer nodes', async () => {
  const document = await loadShowcase()
  const builder = createResourceGraphBuilder({ curves:document.curves, profiles:document.profiles, fields:document.fields })
  const rootIds = Object.fromEntries(Object.entries(document.geometries).map(([id, definition]) => [id, builder.addGeometry(definition)]))
  const graph = builder.build()
  for (const id of Object.values(rootIds)) assert.match(id, /^geometry:g2-/)
  assert.equal(graph.list().some(node => ['curve','profile','field','extension'].includes(node.kind)), false)
  assert.ok(graph.list('geometry').length >= Object.keys(document.geometries).length)
})

test('Universal Geometry Step 11: the complete showcase loads through the normal headless World 0.9 path', async () => {
  const document = await loadShowcase()
  const world = createWorld({ plugins:[entitiesPlugin()], autoResize:false })
  try {
    await world.load(document)
    const ids = new Set(world.compiled.entities.map(entity => entity.id))
    for (const id of requiredObjects) assert.ok(ids.has(id), id)
    assert.ok(world.compiled.resourceGraph.list('geometry').length >= Object.keys(document.geometries).length)
  } finally {
    await world.dispose()
  }
})
