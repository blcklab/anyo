import test from 'node:test'
import assert from 'node:assert/strict'
import { Mesh, Scene, StandardMaterial, Texture } from '@blcklab/sekai64'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import {
  Sekai64ResourceAdapterError,
  createSekai64ResourceAdapter,
} from '../dist/esm/renderer-sekai64/index.js'

globalThis.createImageBitmap ??= async () => ({ width: 2, height: 2, close() {} })

function graphOf({ geometry = { kind: 'box', size: [1, 1, 1] }, material, transform, frame, metadata } = {}) {
  const builder = createResourceGraphBuilder()
  const source = builder.addGeometry(geometry)
  const materialId = material ? builder.addMaterial(material) : undefined
  builder.addInstance({
    id: 'scene/object', source,
    ...(materialId ? { materials: [materialId] } : {}),
    ...(transform ? { transform } : {}),
    ...(frame ? { frame } : {}),
    ...(metadata ? { metadata } : {}),
  })
  return builder.build()
}

test('S13 realizes procedural geometry and standard material into a non-owning Sekai64 Mesh', async () => {
  const scene = new Scene()
  const adapter = createSekai64ResourceAdapter({ scene })
  const graph = graphOf({
    geometry: { kind: 'roundedBox', size: [2, 3, 0.25], radius: 0.04, tangents: true },
    material: { baseColor: '#242424', roughness: 0.72, metalness: 0.15 },
    transform: { position: [3, 2, -4], rotation: [0.1, 0.2, 0.3], scale: [1, 2, 1] },
  })

  const result = await adapter.transition(graph)
  const mesh = scene.require('scene/object')
  assert.equal(result.committed, true)
  assert.ok(mesh instanceof Mesh)
  assert.ok(mesh.geometry.positions.length > 0)
  assert.ok(mesh.geometry.indices?.length > 0)
  assert.ok(mesh.geometry.tangents?.length > 0)
  assert.ok(mesh.material instanceof StandardMaterial)
  assert.equal(mesh.material.roughness, 0.72)
  assert.equal(mesh.material.metallic, 0.15)
  assert.equal(mesh.ownsResources, false)
  assert.deepEqual(mesh.position.toArray(), [3, 2, -4])
  assert.deepEqual(mesh.scale.toArray(), [1, 2, 1])

  await adapter.dispose()
  assert.equal(mesh.disposed, true)
})

test('S13 identical graph transitions reuse Sekai64 geometry, material, and mesh handles', async () => {
  const scene = new Scene()
  const adapter = createSekai64ResourceAdapter({ scene })
  const graph = graphOf({ material: { baseColor: '#ffffff' } })
  await adapter.transition(graph)
  const mesh = scene.require('scene/object')
  const geometry = mesh.geometry
  const material = mesh.material

  const result = await adapter.transition(graph)
  assert.equal(result.noOp, true)
  assert.equal(scene.require('scene/object'), mesh)
  assert.equal(mesh.geometry, geometry)
  assert.equal(mesh.material, material)
  await adapter.dispose()
})

test('S13 transform-only transitions update the stable Mesh in place with zero geometry churn', async () => {
  const scene = new Scene()
  const adapter = createSekai64ResourceAdapter({ scene })
  const previous = graphOf({ transform: { position: [0, 0, 0] } })
  const next = graphOf({ transform: { position: [5, 1, -2], scale: [2, 2, 2] } })
  await adapter.transition(previous)
  const mesh = scene.require('scene/object')
  const geometry = mesh.geometry

  const result = await adapter.transition(next)
  assert.equal(result.stats.prepared, 0)
  assert.equal(result.stats.updatedInstances, 1)
  assert.equal(scene.require('scene/object'), mesh)
  assert.equal(mesh.geometry, geometry)
  assert.deepEqual(mesh.position.toArray(), [5, 1, -2])
  assert.deepEqual(mesh.scale.toArray(), [2, 2, 2])
  await adapter.dispose()
})

test('S13 geometry replacement swaps the stable Mesh source and retires old Sekai64 Geometry after commit', async () => {
  const scene = new Scene()
  const adapter = createSekai64ResourceAdapter({ scene })
  await adapter.transition(graphOf({ geometry: { kind: 'box', size: [1, 1, 1] } }))
  const mesh = scene.require('scene/object')
  const previousGeometry = mesh.geometry

  const result = await adapter.transition(graphOf({ geometry: { kind: 'sphere', radius: 0.75, segments: 16, rings: 8 } }))
  assert.equal(result.stats.prepared, 1)
  assert.equal(result.stats.updatedInstances, 1)
  assert.notEqual(mesh.geometry, previousGeometry)
  assert.equal(previousGeometry.disposed, true)
  assert.equal(mesh.disposed, false)
  await adapter.dispose()
})

test('S13 realizes an explicit texture AssetResource dependency and shares it with StandardMaterial without material ownership', async () => {
  const scene = new Scene()
  const builder = createResourceGraphBuilder()
  const textureId = builder.addAsset({ type: 'texture', src: 'data:image/png;base64,AA==', colorSpace: 'srgb' })
  const materialId = builder.addMaterial({ baseColorTexture: 'wall', roughness: 0.9 }, { assets: [textureId] })
  const geometryId = builder.addGeometry({ kind: 'box' })
  builder.addInstance({ id: 'scene/object', source: geometryId, materials: [materialId] })
  const adapter = createSekai64ResourceAdapter({ scene })

  await adapter.transition(builder.build())
  const mesh = scene.require('scene/object')
  assert.ok(mesh.material instanceof StandardMaterial)
  assert.ok(mesh.material.baseColorTexture instanceof Texture)
  assert.equal(mesh.material.baseColorTexture.ready, true)
  assert.equal(mesh.material.ownsTextures, false)
  const texture = mesh.material.baseColorTexture

  await adapter.dispose()
  assert.equal(texture.disposed, true)
})


test('S22.1 regression: explicit ResourceId texture references realize unambiguously with multiple material texture dependencies', async () => {
  const scene = new Scene()
  const builder = createResourceGraphBuilder()
  const data = 'data:image/png;base64,AA=='
  const normal = builder.addAsset({ type: 'texture', src: data, colorSpace: 'linear', options: { slot: 'normal' } })
  const mr = builder.addAsset({ type: 'texture', src: data, colorSpace: 'linear', options: { slot: 'mr' } })
  const ao = builder.addAsset({ type: 'texture', src: data, colorSpace: 'linear', options: { slot: 'ao' } })
  const materialId = builder.addMaterial({ normalTexture: normal, metallicRoughnessTexture: mr, occlusionTexture: ao }, { assets: [normal, mr, ao] })
  const geometryId = builder.addGeometry({ kind: 'box' })
  builder.addInstance({ id: 'scene/object', source: geometryId, materials: [materialId] })
  const adapter = createSekai64ResourceAdapter({ scene })

  await adapter.transition(builder.build())
  const mesh = scene.require('scene/object')
  assert.ok(mesh.material.normalTexture instanceof Texture)
  assert.ok(mesh.material.metallicRoughnessTexture instanceof Texture)
  assert.ok(mesh.material.occlusionTexture instanceof Texture)
  assert.notEqual(mesh.material.normalTexture, mesh.material.metallicRoughnessTexture)
  assert.notEqual(mesh.material.metallicRoughnessTexture, mesh.material.occlusionTexture)
  await adapter.dispose()
})

test('S13 preserves S5 transported frame orientation on path-aligned semantic instances', async () => {
  const scene = new Scene()
  const adapter = createSekai64ResourceAdapter({ scene })
  const graph = graphOf({
    frame: {
      tangent: [1, 0, 0],
      normal: [0, 0, -1],
      binormal: [0, 1, 0],
    },
  })
  await adapter.transition(graph)
  const mesh = scene.require('scene/object')
  assert.ok(Math.abs(mesh.rotation.y - Math.PI / 2) < 1e-5)
  await adapter.dispose()
})

test('S13 realizes semantic geometry regions as Sekai64 material-group slots without duplicating geometry', async () => {
  const scene = new Scene()
  const builder = createResourceGraphBuilder()
  const source = builder.addGeometry({ kind: 'box' })
  const base = builder.addMaterial({ baseColor: '#222222', roughness: 0.9 })
  const front = builder.addMaterial({ baseColor: '#ff0000', roughness: 0.4 })
  const top = builder.addMaterial({ baseColor: '#00ff00', roughness: 0.6 })
  builder.addInstance({
    id: 'scene/object', source, materials: [base],
    materialBindings: { front, top },
  })
  const adapter = createSekai64ResourceAdapter({ scene })

  await adapter.transition(builder.build())
  const mesh = scene.require('scene/object')
  assert.ok(mesh instanceof Mesh)
  assert.equal(mesh.geometry.groups.length, 6)
  assert.equal(mesh.materials.length, 3)
  assert.equal(mesh.materialGroupSlots.front, 1)
  assert.equal(mesh.materialGroupSlots.top, 2)
  assert.equal(mesh.materialForGroup(0, 'front'), mesh.materials[1])
  assert.equal(mesh.materialForGroup(0, 'top'), mesh.materials[2])
  assert.equal(mesh.materialForGroup(0, 'left'), mesh.materials[0])
  await adapter.dispose()
})

test('S13 material-region changes update one stable Mesh in place while reusing Geometry', async () => {
  const scene = new Scene()
  const make = (frontColor) => {
    const builder = createResourceGraphBuilder()
    const source = builder.addGeometry({ kind: 'box' })
    const base = builder.addMaterial({ baseColor: '#222222' })
    const front = builder.addMaterial({ baseColor: frontColor })
    builder.addInstance({ id: 'scene/object', source, materials: [base], materialBindings: { front } })
    return builder.build()
  }
  const adapter = createSekai64ResourceAdapter({ scene })
  await adapter.transition(make('#ff0000'))
  const mesh = scene.require('scene/object')
  const geometry = mesh.geometry
  const previousFront = mesh.materialForGroup(0, 'front')

  const result = await adapter.transition(make('#0000ff'))
  assert.equal(result.stats.updatedInstances, 1)
  assert.equal(scene.require('scene/object'), mesh)
  assert.equal(mesh.geometry, geometry)
  assert.notEqual(mesh.materialForGroup(0, 'front'), previousFront)
  assert.equal(previousFront.disposed, true)
  await adapter.dispose()
})

test('S13 rejects unknown semantic material-region bindings instead of silently falling back', async () => {
  const scene = new Scene()
  const builder = createResourceGraphBuilder()
  const source = builder.addGeometry({ kind: 'box' })
  const material = builder.addMaterial({ baseColor: '#ff00ff' })
  builder.addInstance({ id: 'scene/object', source, materialBindings: { typoRegion: material } })
  const adapter = createSekai64ResourceAdapter({ scene })

  await assert.rejects(
    adapter.transition(builder.build()),
    (error) => error?.cause instanceof Sekai64ResourceAdapterError || String(error).includes('unknown geometry region'),
  )
  assert.equal(scene.get('scene/object'), undefined)
  assert.equal(adapter.graph, null)
  await adapter.dispose()
})

test('S13 custom asset instance hooks bridge model-like AssetResources without making Sekai64 depend on Anyo', async () => {
  const scene = new Scene()
  const builder = createResourceGraphBuilder()
  const source = builder.addAsset({ type: 'model', format: 'glb', src: '/hq.glb' })
  builder.addInstance({ id: 'scene/model', source, transform: { position: [1, 2, 3] } })
  let released = false
  const adapter = createSekai64ResourceAdapter({
    scene,
    prepareAsset: ({ resource }) => ({ url: resource.definition.src }),
    createAssetInstance: ({ instance, prepared }) => {
      assert.equal(prepared.url, '/hq.glb')
      return new Mesh({ id: instance.instanceId, geometry: new (class DummyGeometry { disposed = false; dispose(){this.disposed=true} })(), material: new StandardMaterial(), ownsResources: true })
    },
    releaseAsset: () => { released = true },
  })

  await adapter.transition(builder.build())
  const node = scene.require('scene/model')
  assert.deepEqual(node.position.toArray(), [1, 2, 3])
  await adapter.dispose()
  assert.equal(node.disposed, true)
  assert.equal(released, true)
})
