import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'

class MockCamera {
  getPosition() { return [0, 1.65, 0] }
  setPosition() {}
  getRotation() { return [0, 0] }
  setRotation() {}
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class MockRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  mounted = null
  runtimeUpdates = []
  async mount(compiled) { this.mounted = compiled }
  changes = []
  async applyChanges(changes, compiled) { this.changes.push(...changes); this.mounted = compiled }
  applyRuntimeTransforms(updates) { this.runtimeUpdates.push(...updates) }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

function makeWorld(renderer = new MockRenderer()) {
  return { renderer, world: createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false }) }
}

const base08 = {
  version: '0.8',
  materials: {
    graphite: { baseColor: '#20242b', roughness: 0.65 },
    cyan: { baseColor: '#64e8ff', roughness: 0.3 },
  },
  geometries: {
    desk: { kind: 'roundedBox', size: [5.4, 1.05, 1.1], radius: 0.08, segments: 4 },
  },
  entities: [],
}

test('S14 schema 0.8 compiles named geometry reuse into one geometry resource with stable instances', async () => {
  const { world } = makeWorld()
  await world.load({
    ...base08,
    entities: [
      { id: 'desk-a', type: 'geometry', geometry: 'desk', material: 'graphite', position: [0, 0.5, 0] },
      { id: 'desk-b', type: 'geometry', geometry: 'desk', material: 'graphite', position: [6, 0.5, 0] },
    ],
  })
  const graph = world.compiled.resourceGraph
  assert.ok(graph)
  assert.equal(graph.list('geometry').length, 1)
  assert.equal(graph.list('material').length, 1)
  assert.equal(graph.list('instance').length, 2)
  assert.deepEqual(graph.list('instance').map((item) => item.instanceId), ['desk-a', 'desk-b'])
  assert.deepEqual(world.compiled.entityById.get('desk-a').resourceInstanceIds, ['desk-a'])
  world.dispose()
})

test('S14 inline geometry and S13 semantic materialBindings compile through the existing ResourceGraph path', async () => {
  const { world } = makeWorld()
  await world.load({
    ...base08,
    entities: [{
      id: 'portal-frame',
      type: 'geometry',
      geometry: { kind: 'box', size: [3, 4, 0.2] },
      material: 'graphite',
      materialBindings: { front: 'cyan' },
    }],
  })
  const graph = world.compiled.resourceGraph
  const instance = graph.get('instance:portal-frame')
  assert.equal(instance.kind, 'instance')
  assert.equal(instance.materials.length, 1)
  assert.ok(instance.materialBindings.front.startsWith('material:'))
  assert.ok(instance.dependencies.includes(instance.materialBindings.front))
  world.dispose()
})


test('S22.1 regression: schema 0.8 multi-texture materials lower authored asset ids to explicit ResourceGraph asset ids', async () => {
  const { world } = makeWorld()
  await world.load({
    version: '0.8',
    assets: {
      'tex-normal': { type: 'texture', format: 'png', src: './normal.png', colorSpace: 'linear' },
      'tex-mr': { type: 'texture', format: 'png', src: './mr.png', colorSpace: 'linear' },
      'tex-ao': { type: 'texture', format: 'png', src: './ao.png', colorSpace: 'linear' },
    },
    materials: {
      floor: {
        baseColor: '#a7aaad',
        normalTexture: 'tex-normal',
        metallicRoughnessTexture: 'tex-mr',
        occlusionTexture: 'tex-ao',
      },
    },
    entities: [{ id: 'floor', type: 'geometry', geometry: { kind: 'box', size: [4, 0.2, 4] }, material: 'floor' }],
  })
  const graph = world.compiled.resourceGraph
  const assets = graph.list('asset')
  const material = graph.list('material')[0]
  assert.equal(assets.length, 3)
  assert.equal(material.assetDependencies.length, 3)
  assert.ok(material.definition.normalTexture.startsWith('asset:'))
  assert.ok(material.definition.metallicRoughnessTexture.startsWith('asset:'))
  assert.ok(material.definition.occlusionTexture.startsWith('asset:'))
  assert.ok(material.assetDependencies.includes(material.definition.normalTexture))
  assert.ok(material.assetDependencies.includes(material.definition.metallicRoughnessTexture))
  assert.ok(material.assetDependencies.includes(material.definition.occlusionTexture))
  world.dispose()
})

test('S14 exposes existing S7 construction lowering from JSON without renderer-specific wall types', async () => {
  const { world } = makeWorld()
  await world.load({
    ...base08,
    entities: [{
      id: 'south-wall',
      type: 'construction',
      material: 'graphite',
      construction: {
        type: 'wall',
        from: [-5, 0, 0],
        to: [5, 0, 0],
        height: 3.5,
        thickness: 0.2,
        openings: [{ kind: 'door', id: 'main-entry', offset: 4, width: 2, height: 2.6 }],
      },
    }],
  })
  const graph = world.compiled.resourceGraph
  assert.ok(graph.list('instance').length >= 2)
  assert.ok(graph.list('instance').every((item) => item.instanceId.startsWith('construction/south-wall/')))
  assert.equal(world.compiled.entityById.get('south-wall').primitiveIds.length, 0)
  assert.ok(world.compiled.entityById.get('south-wall').resourceInstanceIds.length >= 2)
  world.dispose()
})

test('S14 nested procedural entities retain stable entity identity and runtime transforms emit resource-instance updates only', async () => {
  const { world, renderer } = makeWorld()
  await world.load({
    ...base08,
    entities: [{
      id: 'cluster', type: 'group', position: [2, 0, 0], children: [
        { id: 'feature', type: 'geometry', geometry: 'desk', material: 'graphite', position: [1, 0, 0] },
      ],
    }],
  })
  const child = world.compiled.entityById.get('cluster/feature')
  assert.deepEqual(child.resourceInstanceIds, ['cluster/feature'])
  const geometryKey = world.compiled.resourceGraph.key
  world.transforms.set('cluster/feature', { position: [8, 1, -2] }, { source: 's14-test' })
  await world.flushRuntimeTransforms()
  const update = renderer.runtimeUpdates.find((item) => item.resourceInstanceId === 'cluster/feature')
  assert.ok(update)
  assert.equal(update.primitive, undefined)
  assert.deepEqual(update.transform.position, [8, 1, -2])
  assert.equal(world.compiled.resourceGraph.key, geometryKey, 'runtime transforms must not rebuild procedural geometry')
  world.dispose()
})

test('S14 invalid named geometry references fail safely and 0.7 worlds stay on the legacy path', async () => {
  const { world } = makeWorld()
  await assert.rejects(world.load({ version: '0.8', entities: [{ id: 'bad', type: 'geometry', geometry: 'missing' }] }), /ANYO_PROCEDURAL_GEOMETRY_NOT_FOUND/)

  const legacy = makeWorld()
  await legacy.world.load({ version: '0.7', entities: [{ id: 'cube', type: 'box' }] })
  assert.equal(legacy.world.compiled.resourceGraph, undefined)
  assert.equal(legacy.world.compiled.primitives.length, 1)
  legacy.world.dispose()
})

test('S14 procedural root declarations are rejected on schema 0.7', () => {
  const result = inspectWorldDocument({ version: '0.7', geometries: { box: { kind: 'box' } }, entities: [] })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((item) => item.code === 'GEOMETRIES_REQUIRE_0_8'))
})

test('S14 construction runtime transforms preserve authored part offsets instead of collapsing instances', async () => {
  const { world, renderer } = makeWorld()
  await world.load({
    ...base08,
    entities: [{
      id: 'moving-wall',
      type: 'construction',
      position: [3, 0, 0],
      material: 'graphite',
      construction: {
        type: 'wall',
        from: [-5, 0, 0],
        to: [5, 0, 0],
        height: 3.5,
        thickness: 0.2,
        openings: [{ kind: 'door', id: 'entry', offset: 4, width: 2, height: 2.6 }],
      },
    }],
  })
  const node = world.compiled.entityById.get('moving-wall')
  assert.ok(node.resourceInstanceIds.length >= 2)
  const [firstId, secondId] = node.resourceInstanceIds
  const firstBase = node.resourceInstanceTransforms[firstId]
  const secondBase = node.resourceInstanceTransforms[secondId]
  const baseDelta = secondBase.position.map((value, index) => value - firstBase.position[index])

  world.transforms.set('moving-wall', { position: [13, 0, 0] }, { source: 's14-construction-move' })
  await world.flushRuntimeTransforms()
  const first = renderer.runtimeUpdates.find((item) => item.resourceInstanceId === firstId)
  const second = renderer.runtimeUpdates.find((item) => item.resourceInstanceId === secondId)
  assert.ok(first)
  assert.ok(second)
  assert.deepEqual(first.transform.position.map((value, index) => value - firstBase.position[index]), [10, 0, 0])
  assert.deepEqual(second.transform.position.map((value, index) => value - first.transform.position[index]), baseDelta)
  assert.notDeepEqual(first.transform.position, second.transform.position)
  world.dispose()
})

test('S14 validates procedural version boundaries, named geometry references, and material binding references', () => {
  const legacy = inspectWorldDocument({ version: '0.7', entities: [{ id: 'bad-procedural', type: 'geometry', geometry: { kind: 'box' } }] })
  assert.ok(legacy.errors.some((item) => item.code === 'PROCEDURAL_ENTITIES_REQUIRE_0_8'))

  const invalidRefs = inspectWorldDocument({
    version: '0.8',
    materials: { graphite: { baseColor: '#222' } },
    entities: [{ id: 'bad-refs', type: 'geometry', geometry: 'missing', materialBindings: { front: 'missing-material' } }],
  }, { mode: 'generator' })
  assert.ok(invalidRefs.errors.some((item) => item.code === 'ANYO_GEOMETRY_NOT_FOUND'))
  assert.ok(invalidRefs.errors.some((item) => item.code === 'ANYO_MATERIAL_NOT_FOUND' && item.path.includes('/materialBindings/front')))
})


test('S14 authored procedural edits produce ResourceGraph transitions while reusing unchanged geometry resources', async () => {
  const { world, renderer } = makeWorld()
  await world.load({
    ...base08,
    entities: [{ id: 'movable-desk', type: 'geometry', geometry: 'desk', material: 'graphite', position: [0, 0, 0] }],
  })
  const before = world.compiled.resourceGraph
  const geometryId = before.list('geometry')[0].id

  await world.updateEntity('movable-desk', { position: [5, 0, -2] })

  const after = world.compiled.resourceGraph
  assert.notEqual(after.key, before.key)
  assert.equal(after.list('geometry')[0].id, geometryId, 'authored transform changes must reuse content-addressed geometry')
  assert.ok(renderer.changes.some((change) => change.type === 'resource-graph'))
  assert.deepEqual(after.get('instance:movable-desk').transform.position, [5, 0, -2])
  world.dispose()
})
