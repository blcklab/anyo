import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeWorldDocument,
  inspectWorldDocument,
  buildCompilerDependencyGraph,
  applyStableTransaction,
} from '../dist/esm/index.js'

test('S23 basic compositions expand as implicit group roots with stable namespaced children', () => {
  const source = {
    version: '0.8',
    compositions: {
      bench: {
        children: [
          { id: 'seat', type: 'box', size: [2, 0.2, 0.6], material: 'wood' },
          { id: 'leg', type: 'box', size: [0.15, 0.8, 0.15], position: [-0.7, -0.5, 0] },
        ],
      },
    },
    entities: [
      { id: 'bench-west', composition: 'bench', position: [-3, 0, 0] },
      { id: 'bench-east', composition: 'bench', position: [3, 0, 0] },
    ],
  }
  const normalized = normalizeWorldDocument(source)
  assert.equal(normalized.entities.length, 2)
  assert.equal(normalized.entities[0].type, 'group')
  assert.deepEqual(normalized.entities[0].children.map((child) => child.id), ['bench-west/seat', 'bench-west/leg'])
  assert.deepEqual(normalized.entities[1].children.map((child) => child.id), ['bench-east/seat', 'bench-east/leg'])
  assert.notEqual(normalized.entities[0].children[0].__authoring.id, normalized.entities[1].children[0].__authoring.id)
})

test('S23 compositions can nest compositions and legacy prefabs without duplicate authoring identities', () => {
  const source = {
    version: '0.8',
    prefabs: { lamp: { type: 'box', size: [0.2, 1, 0.2] } },
    compositions: {
      planter: { children: [{ id: 'pot', type: 'cylinder', radius: 0.4, height: 0.5 }] },
      garden: {
        children: [
          { id: 'planter-a', composition: 'planter', position: [-1, 0, 0] },
          { id: 'planter-b', composition: 'planter', position: [1, 0, 0] },
          { id: 'lamp', use: 'lamp', position: [0, 0, 1] },
        ],
      },
    },
    entities: [{ id: 'garden-1', composition: 'garden' }, { id: 'garden-2', composition: 'garden', position: [5, 0, 0] }],
  }
  const normalized = normalizeWorldDocument(source)
  const ids = []
  const authoring = []
  const walk = (entity) => { ids.push(entity.id); authoring.push(entity.__authoring?.id); entity.children?.forEach(walk) }
  normalized.entities.forEach(walk)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(new Set(authoring).size, authoring.length)
  assert.ok(ids.includes('garden-1/planter-a/pot'))
  assert.ok(ids.includes('garden-2/planter-b/pot'))
})

test('S23 composition instances reuse JSON-pointer overrides and repeat expansion', () => {
  const normalized = normalizeWorldDocument({
    version: '0.8',
    compositions: {
      marker: { children: [{ id: 'body', type: 'box', size: [1, 1, 1], material: 'base' }] },
    },
    entities: [{
      id: 'markers', composition: 'marker', position: [0, 0, 0],
      overrides: { '/children/0/material': 'accent' },
      repeat: { count: 3, axis: 'x', spacing: 2 },
    }],
  })
  assert.deepEqual(normalized.entities.map((entity) => entity.id), ['markers:0', 'markers:1', 'markers:2'])
  assert.deepEqual(normalized.entities.map((entity) => entity.position), [[0,0,0],[2,0,0],[4,0,0]])
  assert.ok(normalized.entities.every((entity) => entity.children[0].material === 'accent'))
})

test('S23 composition inheritance is deterministic and keeps an implicit group root', () => {
  const normalized = normalizeWorldDocument({
    version: '0.8',
    compositions: {
      base: { style: { role: 'base' }, data: { a: 1 }, children: [{ id: 'one', type: 'box', size: [1,1,1] }] },
      derived: { extends: 'base', style: { variant: 'derived' }, data: { b: 2 } },
    },
    entities: [{ id: 'instance', composition: 'derived' }],
  })
  const entity = normalized.entities[0]
  assert.equal(entity.type, 'group')
  assert.deepEqual(entity.style, { role: 'base', variant: 'derived' })
  assert.deepEqual(entity.data, { a: 1, b: 2 })
  assert.equal(entity.children[0].id, 'instance/one')
})

test('S23 validation rejects unknown, conflicting, legacy-version, and cyclic composition references', () => {
  const unknown = inspectWorldDocument({ version: '0.8', entities: [{ id: 'x', composition: 'missing' }] })
  assert.ok(unknown.errors.some((issue) => issue.code === 'COMPOSITION_NOT_FOUND'))
  const conflict = inspectWorldDocument({ version: '0.8', prefabs: { a: { type: 'box' } }, compositions: { b: { children: [] } }, entities: [{ id: 'x', use: 'a', composition: 'b' }] })
  assert.ok(conflict.errors.some((issue) => issue.code === 'ENTITY_TEMPLATE_REFERENCE_CONFLICT'))
  const legacy = inspectWorldDocument({ version: '0.7', compositions: { a: { children: [] } }, entities: [{ id: 'x', composition: 'a' }] })
  assert.ok(legacy.errors.some((issue) => issue.code === 'COMPOSITIONS_REQUIRE_0_8'))
  const cyclic = inspectWorldDocument({ version: '0.8', compositions: { a: { children: [{ id: 'b', composition: 'b' }] }, b: { children: [{ id: 'a', composition: 'a' }] } }, entities: [{ id: 'x', composition: 'a' }] })
  assert.ok(cyclic.errors.some((issue) => issue.code === 'COMPOSITION_CYCLE'))
})

test('S23 dependency graph tracks composition instances and nested composition dependencies', () => {
  const graph = buildCompilerDependencyGraph({
    version: '0.8',
    compositions: {
      leaf: { children: [{ id: 'mesh', type: 'box', material: 'green' }] },
      tree: { children: [{ id: 'leaf', composition: 'leaf' }] },
    },
    entities: [{ id: 'tree-a', composition: 'tree', instanceId: 'tree-instance-a' }],
  })
  assert.ok(graph.compositionInstances.get('tree').has('tree-instance-a'))
  assert.ok(graph.compositionInstances.get('leaf').has('composition:tree/leaf'))
  assert.ok(graph.materialConsumers.get('green').has('composition:leaf/mesh'))
})

test('S23 stable transactions can target a composition definition by compositionId', () => {
  const source = {
    version: '0.8', revision: 2,
    compositions: { bench: { children: [{ id: 'seat', type: 'box', size: [2, 0.2, 0.5] }] } },
    entities: [{ id: 'bench-a', composition: 'bench' }],
  }
  const result = applyStableTransaction(source, {
    id: 'resize-composition', baseRevision: 2,
    operations: [{ op: 'replace', target: { compositionId: 'bench' }, path: '/children/0/size/0', value: 3 }],
  })
  assert.equal(result.document.compositions.bench.children[0].size[0], 3)
  assert.ok(result.affectedPrefabs.has('bench'))
})

test('S23 identical composition definitions normalize deterministically across runs', () => {
  const source = {
    version: '0.8',
    compositions: { pair: { children: [{ id: 'a', type: 'box' }, { id: 'b', type: 'sphere' }] } },
    entities: [{ id: 'pair-a', composition: 'pair', instanceId: 'stable-pair-a' }],
  }
  const a = normalizeWorldDocument(source)
  const b = normalizeWorldDocument(structuredClone(source))
  const collect = (entity) => [entity.__authoring?.id, ...(entity.children ?? []).flatMap(collect)]
  assert.deepEqual(collect(a.entities[0]), collect(b.entities[0]))
})
