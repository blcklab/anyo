import test from 'node:test'
import assert from 'node:assert/strict'
import { Node, Scene } from '@blcklab/sekai64'
import { AssetLoaderRegistry } from '@blcklab/sekai64/assets'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import { createSekai64ResourceAdapter } from '../dist/esm/renderer-sekai64/Sekai64ResourceAdapter.js'
import { createResourceAssetLoaderOptions } from '../dist/esm/renderer-sekai64/resourceAssetHooks.js'

test('S20 Sekai64 ResourceGraph asset bridge uses registered model loaders for independent semantic instances', async () => {
  const registry = new AssetLoaderRegistry()
  const requests = []
  registry.register({
    type: 'model',
    formats: ['glb'],
    async load(request) {
      requests.push({ ...request })
      return new Node({ id: request.id, name: request.id })
    },
  })
  const builder = createResourceGraphBuilder()
  const asset = builder.addAsset({ type: 'model', format: 'glb', src: '/assets/console.glb', options: { quality: 'high' } })
  builder.addInstance({ id: 'console-a', source: asset, transform: { position: [-2, 0, 0] } })
  builder.addInstance({ id: 'console-b', source: asset, transform: { position: [2, 0, 0] } })

  const scene = new Scene()
  const adapter = createSekai64ResourceAdapter({ scene, ...createResourceAssetLoaderOptions(registry) })
  await adapter.transition(builder.build())

  assert.equal(requests.length, 2)
  assert.deepEqual(requests.map((request) => request.id), ['console-a', 'console-b'])
  assert.ok(scene.require('console-a') instanceof Node)
  assert.ok(scene.require('console-b') instanceof Node)
  assert.deepEqual(scene.require('console-a').position.toArray(), [-2, 0, 0])
  assert.deepEqual(scene.require('console-b').position.toArray(), [2, 0, 0])
  assert.deepEqual(requests[0].options, { quality: 'high' })

  await adapter.dispose()
  registry.dispose()
})
