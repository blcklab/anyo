import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGeometryCompiler, GeometryValidationError } from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'
import { createWorld, entitiesPlugin } from '../dist/esm/index.js'
import { referenceGeometryProvider } from '../examples/geometry-extension-provider/provider.mjs'

const worldUrl = new URL('../examples/geometry-extension-provider/world.anyo.json', import.meta.url)
const providerUrl = new URL('../examples/geometry-extension-provider/provider.mjs', import.meta.url)

async function loadWorld() {
  return JSON.parse(await readFile(worldUrl, 'utf8'))
}

function snapshot(mesh) {
  return {
    positions: [...mesh.positions],
    indices: [...mesh.indices],
    bounds: mesh.bounds,
  }
}

test('Post-freeze Step 13: reference provider is strict namespaced external authoring and world JSON stays code-free', async () => {
  const document = await loadWorld()
  const result = inspectWorldDocument(document, { mode: 'strict' })
  assert.equal(result.valid, true, result.errors.map(issue => `${issue.code}: ${issue.message}`).join('\n'))
  assert.equal(referenceGeometryProvider.namespace, 'blcklab.reference')
  assert.equal(referenceGeometryProvider.version, '0.1.0')
  assert.deepEqual(referenceGeometryProvider.kinds.map(kind => kind.name), ['twisted-spire', 'stellated-prism'])
  assert.equal(JSON.stringify(document).includes('provider.mjs'), false)
  assert.equal(JSON.stringify(document).includes('import('), false)
})

test('Post-freeze Step 13: provider composes Core geometry and custom indexed topology through one canonical pipeline', async () => {
  const document = await loadWorld()
  const compiler = createGeometryCompiler({ extensions: [referenceGeometryProvider], cache: false })
  const spireA = compiler.build(document.geometries.spire)
  const spireB = compiler.build(structuredClone(document.geometries.spire))
  const crown = compiler.build(document.geometries.crown)
  assert.deepEqual(snapshot(spireA.mesh), snapshot(spireB.mesh))
  assert.equal(spireA.key, spireB.key)
  assert.ok(spireA.mesh.positions.length > 0)
  assert.ok(crown.mesh.positions.length > 0)
  assert.deepEqual(spireA.identity.extensions, [{ namespace: 'blcklab.reference', version: '0.1.0', kinds: ['blcklab.reference:twisted-spire'] }])
  assert.deepEqual(crown.identity.extensions, [{ namespace: 'blcklab.reference', version: '0.1.0', kinds: ['blcklab.reference:stellated-prism'] }])
})

test('Post-freeze Step 13: ResourceGraph bakes the external provider out before renderer realization', async () => {
  const document = await loadWorld()
  const builder = createResourceGraphBuilder({ extensions: [referenceGeometryProvider] })
  const ids = Object.values(document.geometries).map(definition => builder.addGeometry(definition))
  const graph = builder.build()
  for (const id of ids) assert.match(id, /^geometry:g2-/)
  const geometryNodes = graph.list('geometry')
  assert.ok(geometryNodes.length >= 2)
  assert.equal(geometryNodes.some(node => JSON.stringify(node.definition).includes('blcklab.reference:')), false)
  assert.equal(geometryNodes.every(node => node.definition.kind === 'mesh'), true)
})

test('Post-freeze Step 13: normal World path uses extension geometry for resources and procedural collision', async () => {
  const document = await loadWorld()
  const world = createWorld({ geometryExtensions: [referenceGeometryProvider], plugins: [entitiesPlugin()], autoResize: false })
  await world.load(document)
  assert.equal(world.geometryExtensions.hasKind('blcklab.reference:twisted-spire'), true)
  assert.equal(world.geometryExtensions.hasKind('blcklab.reference:stellated-prism'), true)
  assert.equal(world.compiled.colliders.filter(collider => collider.entityId?.startsWith('reference-')).length, 2)
  assert.equal(world.compiled.resourceGraph.list('geometry').some(node => JSON.stringify(node.definition).includes('blcklab.reference:')), false)
  await world.dispose()
})

test('Post-freeze Step 13: missing trusted provider fails cleanly rather than falling back to code execution', async () => {
  const document = await loadWorld()
  const compiler = createGeometryCompiler({ cache: false })
  assert.throws(
    () => compiler.compile(document.geometries.spire),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_EXTENSION_UNREGISTERED'),
  )
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await assert.rejects(() => world.load(document), error => error instanceof GeometryValidationError)
  await world.dispose()
})

test('Post-freeze Step 13: reference provider survives being copied outside the Anyo repository', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'anyo-reference-provider-test-'))
  try {
    const copiedProvider = path.join(temporary, 'provider.mjs')
    await cp(providerUrl, copiedProvider)
    const source = await readFile(copiedProvider, 'utf8')
    assert.equal(/(?:\.\.\/)+(?:src|dist)\//.test(source), false)
    const external = await import(`${pathToFileURL(copiedProvider).href}?step13=1`)
    assert.equal(external.referenceGeometryProvider.namespace, 'blcklab.reference')
    const compiler = createGeometryCompiler({ extensions: [external.referenceGeometryProvider], cache: false })
    const document = await loadWorld()
    assert.ok(compiler.compile(document.geometries.spire).positions.length > 0)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
