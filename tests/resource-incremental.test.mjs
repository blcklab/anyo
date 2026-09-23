import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ResourceGraph,
  createResourceGraphBuilder,
  diffResourceGraphs,
  planResourceGraphTransition,
} from '../dist/esm/resources/index.js'

function issue(error, code) {
  return error?.issues?.some?.((entry) => entry.code === code) === true
}

function simpleGraph(options = {}) {
  const builder = createResourceGraphBuilder()
  const source = builder.addGeometry(options.geometry ?? { kind: 'box', size: [1, 1, 1] })
  const material = options.material ? builder.addMaterial(options.material) : undefined
  builder.addInstance({
    id: options.id ?? 'scene/object',
    source,
    ...(material ? { materials: [material] } : {}),
    transform: options.transform,
    frame: options.frame,
    metadata: options.metadata,
  })
  return builder.build()
}

test('S10 identical graphs produce a no-op plan and reuse every resource', () => {
  const previous = simpleGraph({ material: { color: '#ffffff' } })
  const next = simpleGraph({ material: { color: '#ffffff' } })
  const plan = planResourceGraphTransition(previous, next)
  assert.equal(plan.noOp, true)
  assert.equal(plan.stats.actions, 0)
  assert.equal(plan.reuse.length, previous.size)
  assert.deepEqual(plan.compile, [])
  assert.deepEqual(plan.invalidate, [])
  assert.deepEqual(plan.release, [])
})

test('S10 transform-only edits update a stable instance without resource churn', () => {
  const previous = simpleGraph({ transform: { position: [0, 0, 0] } })
  const next = simpleGraph({ transform: { position: [4, 1, -2] } })
  const plan = planResourceGraphTransition(previous, next)
  assert.deepEqual(plan.compile, [])
  assert.deepEqual(plan.release, [])
  assert.deepEqual(plan.invalidate, ['instance:scene/object'])
  assert.equal(plan.updateInstances.length, 1)
  assert.equal(plan.updateInstances[0].kind, 'transform')
  assert.deepEqual(plan.updateInstances[0].fields, ['transform'])
  assert.deepEqual(plan.updateInstances[0].previous.transform.position, [0, 0, 0])
  assert.deepEqual(plan.updateInstances[0].next.transform.position, [4, 1, -2])
})

test('S10 geometry replacement compiles new content, updates the semantic instance, then releases old content', () => {
  const previous = simpleGraph({ geometry: { kind: 'box', size: [1, 1, 1] } })
  const next = simpleGraph({ geometry: { kind: 'box', size: [2, 1, 1] } })
  const plan = planResourceGraphTransition(previous, next)
  assert.equal(plan.compile.length, 1)
  assert.equal(plan.release.length, 1)
  assert.equal(plan.updateInstances.length, 1)
  assert.equal(plan.updateInstances[0].kind, 'source')
  assert.notEqual(plan.updateInstances[0].previous.source, plan.updateInstances[0].next.source)
  assert.equal(next.get(plan.compile[0]).kind, 'geometry')
  assert.equal(previous.get(plan.release[0]).kind, 'geometry')
})

test('S10 asset/material replacement is dependency ordered around one stable instance update', () => {
  const make = (src) => {
    const builder = createResourceGraphBuilder()
    const geometry = builder.addGeometry({ kind: 'box' })
    const asset = builder.addAsset({ id: 'albedo', type: 'image', src })
    const material = builder.addMaterial({ color: '#ffffff' }, { assets: [asset] })
    builder.addInstance({ id: 'scene/wall', source: geometry, materials: [material] })
    return builder.build()
  }
  const previous = make('/a.png')
  const next = make('/b.png')
  const plan = planResourceGraphTransition(previous, next)
  assert.deepEqual(plan.compile.map((id) => next.get(id).kind), ['asset', 'material'])
  assert.equal(plan.updateInstances[0].kind, 'materials')
  assert.deepEqual(plan.release.map((id) => previous.get(id).kind), ['material', 'asset'])
  assert.ok(plan.reuse.some((id) => next.get(id)?.kind === 'geometry'))
})

test('S10 initial mount and full disposal have deterministic compile/create/remove/release phases', () => {
  const graph = simpleGraph({ material: { color: '#abcdef' } })
  const mount = planResourceGraphTransition(null, graph)
  assert.deepEqual(mount.compile.map((id) => graph.get(id).kind), ['geometry', 'material'])
  assert.deepEqual(mount.createInstances, ['instance:scene/object'])
  assert.deepEqual(mount.removeInstances, [])
  assert.deepEqual(mount.release, [])

  const dispose = planResourceGraphTransition(graph, null)
  assert.deepEqual(dispose.compile, [])
  assert.deepEqual(dispose.removeInstances, ['instance:scene/object'])
  assert.deepEqual(dispose.release.map((id) => graph.get(id).kind).sort(), ['geometry', 'material'])
})

test('S10 adding/removing shared instances does not recompile or release a retained geometry resource', () => {
  const make = (ids) => {
    const builder = createResourceGraphBuilder()
    const source = builder.addGeometry({ kind: 'roundedBox', size: [0.1, 1, 0.1], radius: 0.01 })
    for (const id of ids) builder.addInstance({ id, source })
    return builder.build()
  }
  const previous = make(['posts/0', 'posts/1'])
  const next = make(['posts/1', 'posts/2'])
  const plan = planResourceGraphTransition(previous, next)
  assert.deepEqual(plan.compile, [])
  assert.deepEqual(plan.release, [])
  assert.deepEqual(plan.createInstances, ['instance:posts/2'])
  assert.deepEqual(plan.removeInstances, ['instance:posts/0'])
  assert.ok(plan.reuse.includes('instance:posts/1'))
  assert.ok(plan.reuse.some((id) => next.get(id)?.kind === 'geometry'))
})

test('S10 frame and metadata changes are represented losslessly as a composite instance delta', () => {
  const previous = simpleGraph({
    frame: { tangent: [1, 0, 0], normal: [0, 1, 0], binormal: [0, 0, 1] },
    metadata: { pathDistance: 1 },
  })
  const next = simpleGraph({
    frame: { tangent: [0, 0, 1], normal: [0, 1, 0], binormal: [-1, 0, 0] },
    metadata: { pathDistance: 2 },
  })
  const delta = planResourceGraphTransition(previous, next).updateInstances[0]
  assert.equal(delta.kind, 'composite')
  assert.deepEqual(delta.fields, ['frame', 'metadata'])
})

test('S10 nested geometry is released dependents-first after its instance is removed', () => {
  const builder = createResourceGraphBuilder()
  const source = builder.addGeometry({
    kind: 'subtract',
    left: { kind: 'box', size: [2, 2, 2] },
    right: { kind: 'sphere', radius: 0.5, segments: 12, rings: 6 },
  })
  builder.addInstance({ id: 'scene/cut', source })
  const graph = builder.build()
  const plan = planResourceGraphTransition(graph, null)
  assert.deepEqual(plan.removeInstances, ['instance:scene/cut'])
  const release = plan.release
  assert.equal(release[0], source)
  const children = graph.get(source).dependencies
  for (const child of children) assert.ok(release.indexOf(child) > release.indexOf(source))
})

test('S10 graph diff lists added in next dependency order and removed in previous dependency order', () => {
  const previous = simpleGraph({ geometry: { kind: 'box' } })
  const next = simpleGraph({ geometry: { kind: 'sphere', radius: 1, segments: 12, rings: 6 } })
  const diff = diffResourceGraphs(previous, next)
  assert.equal(next.get(diff.added[0]).kind, 'geometry')
  assert.ok(!diff.added.includes('instance:scene/object'), 'updated stable instance is not classified as added')
  assert.equal(previous.get(diff.removed[0]).kind, 'geometry')
  assert.equal(diff.instanceUpdates.length, 1)
})

test('S10 graph planning is deterministic across insertion order', () => {
  const make = (reverse, moved) => {
    const builder = createResourceGraphBuilder()
    const definitions = reverse
      ? [{ id: 'b', geometry: { kind: 'sphere', radius: 1 } }, { id: 'a', geometry: { kind: 'box' } }]
      : [{ id: 'a', geometry: { kind: 'box' } }, { id: 'b', geometry: { kind: 'sphere', radius: 1 } }]
    for (const entry of definitions) builder.addGeometryInstance(entry.id, entry.geometry, { transform: entry.id === 'a' && moved ? { position: [2, 0, 0] } : undefined })
    return builder.build()
  }
  const previousA = make(false, false)
  const previousB = make(true, false)
  const nextA = make(false, true)
  const nextB = make(true, true)
  assert.deepEqual(planResourceGraphTransition(previousA, nextA), planResourceGraphTransition(previousB, nextB))
})

test('S10 material and transform edits on one stable instance classify as composite', () => {
  const make = (color, x) => {
    const builder = createResourceGraphBuilder()
    const source = builder.addGeometry({ kind: 'box' })
    const material = builder.addMaterial({ color })
    builder.addInstance({ id: 'scene/object', source, materials: [material], transform: { position: [x, 0, 0] } })
    return builder.build()
  }
  const delta = planResourceGraphTransition(make('#ffffff', 0), make('#ff0000', 2)).updateInstances[0]
  assert.equal(delta.kind, 'composite')
  assert.deepEqual(delta.fields, ['materials', 'transform'])
})

test('S10 rejects in-place mutation of a content-addressed resource id', () => {
  const previous = new ResourceGraph([{
    id: 'geometry:manual', kind: 'geometry', key: 'g-a', dependencies: [], definition: { kind: 'box' },
  }])
  const next = new ResourceGraph([{
    id: 'geometry:manual', kind: 'geometry', key: 'g-b', dependencies: [], definition: { kind: 'sphere', radius: 1 },
  }])
  assert.throws(() => planResourceGraphTransition(previous, next), (error) => issue(error, 'RESOURCE_DIFF_IDENTITY_MISMATCH'))
})

test('S10 rejects same-key resources whose canonical content differs', () => {
  const previous = new ResourceGraph([{
    id: 'geometry:manual', kind: 'geometry', key: 'g-same', dependencies: [], definition: { kind: 'box' },
  }])
  const next = new ResourceGraph([{
    id: 'geometry:manual', kind: 'geometry', key: 'g-same', dependencies: [], definition: { kind: 'box', size: [2, 2, 2] },
  }])
  assert.throws(() => diffResourceGraphs(previous, next), (error) => issue(error, 'RESOURCE_DIFF_IDENTITY_MISMATCH'))
})



test('S10 nested geometry compilation is dependencies-first on initial mount', () => {
  const builder = createResourceGraphBuilder()
  const parent = builder.addGeometry({
    kind: 'union',
    left: { kind: 'transform', source: { kind: 'box' }, position: [1, 0, 0] },
    right: { kind: 'sphere', radius: 0.5, segments: 12, rings: 6 },
  })
  builder.addInstance({ id: 'scene/combined', source: parent })
  const graph = builder.build()
  const compile = planResourceGraphTransition(null, graph).compile
  for (const dependency of graph.get(parent).dependencies) {
    assert.ok(compile.indexOf(dependency) < compile.indexOf(parent))
  }
})

test('S10 S5 path-array edits become stable instance deltas plus precise removals without geometry churn', () => {
  const make = (spacing) => {
    const builder = createResourceGraphBuilder()
    builder.addPathArray(
      { kind: 'cylinder', radius: 0.04, height: 1, segments: 12 },
      { path: { kind: 'line', points: [[0, 0, 0], [4, 0, 0]], segments: 4 }, spacing },
      { idPrefix: 'rail/posts' },
    )
    return builder.build()
  }
  const previous = make(1)
  const next = make(2)
  const plan = planResourceGraphTransition(previous, next)
  assert.deepEqual(plan.compile, [])
  assert.deepEqual(plan.release, [])
  assert.deepEqual(plan.removeInstances, ['instance:rail/posts/4', 'instance:rail/posts/3'])
  assert.deepEqual(plan.updateInstances.map((delta) => delta.id), ['instance:rail/posts/1', 'instance:rail/posts/2'])
  assert.ok(plan.updateInstances.every((delta) => delta.fields.includes('transform') && delta.fields.includes('metadata')))
  assert.ok(plan.reuse.includes('instance:rail/posts/0'))
})

test('S10 transition plans are deeply frozen at the public planning boundary', () => {
  const previous = simpleGraph({ transform: { position: [0, 0, 0] } })
  const next = simpleGraph({ transform: { position: [1, 0, 0] } })
  const plan = planResourceGraphTransition(previous, next)
  assert.ok(Object.isFrozen(plan))
  assert.ok(Object.isFrozen(plan.compile))
  assert.ok(Object.isFrozen(plan.updateInstances))
  assert.ok(Object.isFrozen(plan.updateInstances[0]))
  assert.ok(Object.isFrozen(plan.updateInstances[0].fields))
  assert.ok(Object.isFrozen(plan.stats))
})


test('S13 semantic region material changes remain stable instance material deltas', () => {
  const make = (color) => {
    const builder = createResourceGraphBuilder()
    const source = builder.addGeometry({ kind: 'box' })
    const base = builder.addMaterial({ baseColor: '#222222' })
    const front = builder.addMaterial({ baseColor: color })
    builder.addInstance({ id: 'scene/panel', source, materials: [base], materialBindings: { front } })
    return builder.build()
  }
  const plan = planResourceGraphTransition(make('#ff0000'), make('#00ff00'))
  assert.equal(plan.updateInstances.length, 1)
  assert.deepEqual(plan.updateInstances[0].fields, ['materials'])
  assert.equal(plan.compile.filter((id) => id.startsWith('geometry:')).length, 0)
  assert.equal(plan.release.filter((id) => id.startsWith('geometry:')).length, 0)
})
