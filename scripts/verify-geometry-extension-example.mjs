import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceExample = path.join(root, 'examples/geometry-extension-provider')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'anyo-geometry-extension-example-'))
const externalExample = path.join(temporary, 'provider-package')

try {
  await cp(sourceExample, externalExample, { recursive: true })
  const providerSource = await readFile(path.join(externalExample, 'provider.mjs'), 'utf8')
  assert.equal(/(?:\.\.\/)+(?:src|dist)\//.test(providerSource), false, 'Reference provider must not import Anyo private/build paths.')

  const [{ referenceGeometryProvider }, geometry, resources, schema, rootApi] = await Promise.all([
    import(pathToFileURL(path.join(externalExample, 'provider.mjs')).href),
    import(pathToFileURL(path.join(root, 'dist/esm/geometry/index.js')).href),
    import(pathToFileURL(path.join(root, 'dist/esm/resources/index.js')).href),
    import(pathToFileURL(path.join(root, 'dist/esm/schema/index.js')).href),
    import(pathToFileURL(path.join(root, 'dist/esm/index.js')).href),
  ])
  const document = JSON.parse(await readFile(path.join(externalExample, 'world.anyo.json'), 'utf8'))

  assert.equal(referenceGeometryProvider.namespace, 'blcklab.reference')
  assert.equal(referenceGeometryProvider.version, '0.1.0')
  assert.deepEqual(referenceGeometryProvider.kinds.map(kind => kind.name), ['twisted-spire', 'stellated-prism'])

  const inspection = schema.inspectWorldDocument(document, { mode: 'strict' })
  assert.equal(inspection.valid, true, inspection.errors.map(issue => `${issue.code}: ${issue.message}`).join('\n'))

  const compiler = geometry.createGeometryCompiler({ extensions: [referenceGeometryProvider], cache: false })
  for (const definition of Object.values(document.geometries)) {
    const result = compiler.build(definition)
    assert.match(result.key, /^g2-[0-9a-f]{16}$/)
    assert.ok(result.mesh.positions.length > 0)
    assert.ok(result.mesh.indices.length > 0)
    assert.deepEqual(result.identity.extensions, [{ namespace: 'blcklab.reference', version: '0.1.0', kinds: [definition.kind === 'pipeline' ? 'blcklab.reference:stellated-prism' : 'blcklab.reference:twisted-spire'] }])
  }

  const builder = resources.createResourceGraphBuilder({ extensions: [referenceGeometryProvider] })
  for (const definition of Object.values(document.geometries)) builder.addGeometry(definition)
  const graph = builder.build()
  const geometryNodes = graph.list('geometry')
  assert.ok(geometryNodes.length >= 2)
  assert.equal(geometryNodes.some(node => JSON.stringify(node.definition).includes('blcklab.reference:')), false)
  assert.equal(geometryNodes.every(node => node.definition.kind === 'mesh'), true)

  const world = rootApi.createWorld({ geometryExtensions: [referenceGeometryProvider], plugins: [rootApi.entitiesPlugin()], autoResize: false })
  await world.load(document)
  assert.equal(world.geometryExtensions.has('blcklab.reference'), true)
  assert.equal(world.compiled.colliders.filter(collider => collider.entityId?.startsWith('reference-')).length, 2)
  assert.equal(world.compiled.resourceGraph.list('geometry').some(node => JSON.stringify(node.definition).includes('blcklab.reference:')), false)
  await world.dispose()

  console.log('Verified external geometry-extension reference provider against public Anyo rc.37 build surfaces.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
