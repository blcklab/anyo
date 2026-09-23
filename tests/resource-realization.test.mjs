import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ResourceRealizationError,
  createResourceGraphBuilder,
  createResourceRealizer,
} from '../dist/esm/resources/index.js'

function simpleGraph(options = {}) {
  const builder = createResourceGraphBuilder()
  const source = builder.addGeometry(options.geometry ?? { kind: 'box', size: [1, 1, 1] })
  const material = options.material ? builder.addMaterial(options.material) : undefined
  builder.addInstance({
    id: options.id ?? 'scene/object',
    source,
    ...(material ? { materials: [material] } : {}),
    transform: options.transform,
    metadata: options.metadata,
  })
  return builder.build()
}

function realizationIssue(error, code) {
  return error instanceof ResourceRealizationError && error.issue.code === code
}

function createHarness(overrides = {}) {
  const events = []
  let serial = 0
  const hooks = {
    async prepare(resource, context) {
      events.push(`prepare:${resource.id}`)
      const handle = { type: 'resource', id: resource.id, serial: ++serial }
      if (overrides.prepare) return await overrides.prepare(resource, context, handle, events)
      return handle
    },
    async createInstance(instance, context) {
      events.push(`create:${instance.id}`)
      const handle = { type: 'instance', id: instance.id, serial: ++serial, state: instance }
      if (overrides.createInstance) return await overrides.createInstance(instance, context, handle, events)
      return handle
    },
    async updateInstance(delta, handle, context) {
      events.push(`update:${delta.id}:${delta.fields.join('+')}`)
      if (overrides.updateInstance) return await overrides.updateInstance(delta, handle, context, events)
      handle.state = delta.next
      return handle
    },
    async removeInstance(instance, handle, context) {
      events.push(`remove:${instance.id}`)
      if (overrides.removeInstance) return await overrides.removeInstance(instance, handle, context, events)
    },
    async release(resource, handle, context) {
      events.push(`release:${resource.id}`)
      if (overrides.release) return await overrides.release(resource, handle, context, events)
    },
  }
  return { realizer: createResourceRealizer(hooks), events }
}

test('S11 initial realization prepares dependency resources before creating semantic instances', async () => {
  const builder = createResourceGraphBuilder()
  const texture = builder.addAsset({ type: 'texture', src: '/wall.png' })
  const material = builder.addMaterial({ baseColorTexture: 'wall' }, { assets: [texture] })
  const geometry = builder.addGeometry({ kind: 'box', size: [4, 3, 0.2] })
  const instance = builder.addInstance({ id: 'wall', source: geometry, materials: [material] })
  const graph = builder.build()

  const { realizer, events } = createHarness({
    prepare(resource, context, handle) {
      for (const dependency of resource.dependencies) {
        assert.ok(context.getResourceHandle(dependency), `dependency ${dependency} must be prepared before ${resource.id}`)
      }
      return handle
    },
    createInstance(node, context, handle) {
      assert.ok(context.getResourceHandle(node.source))
      for (const dependency of node.materials) assert.ok(context.getResourceHandle(dependency))
      return handle
    },
  })

  const result = await realizer.transition(graph)
  assert.equal(result.committed, true)
  assert.equal(result.stats.prepared, 3)
  assert.equal(result.stats.createdInstances, 1)
  assert.equal(realizer.graphKey, graph.key)
  assert.equal(realizer.resourceCount, 3)
  assert.equal(realizer.instanceCount, 1)
  assert.ok(events.indexOf(`prepare:${texture}`) < events.indexOf(`prepare:${material}`))
  assert.ok(events.indexOf(`create:${instance}`) > events.lastIndexOf(`prepare:${geometry}`))
})

test('S11 identical transitions are true no-ops and reuse active opaque handles', async () => {
  const graph = simpleGraph({ material: { color: '#ffffff' } })
  const { realizer, events } = createHarness()
  await realizer.transition(graph)
  const beforeResource = realizer.getResourceHandle(graph.list('geometry')[0].id)
  const beforeInstance = realizer.getInstanceHandle('instance:scene/object')
  events.length = 0

  const result = await realizer.transition(graph)
  assert.equal(result.noOp, true)
  assert.equal(result.stats.reused, graph.size)
  assert.deepEqual(events, [])
  assert.equal(realizer.getResourceHandle(graph.list('geometry')[0].id), beforeResource)
  assert.equal(realizer.getInstanceHandle('instance:scene/object'), beforeInstance)
})

test('S11 stable transform edits update an instance in place with zero resource churn', async () => {
  const previous = simpleGraph({ transform: { position: [0, 0, 0] } })
  const next = simpleGraph({ transform: { position: [2, 1, -3] } })
  const { realizer, events } = createHarness()
  await realizer.transition(previous)
  const handle = realizer.getInstanceHandle('instance:scene/object')
  events.length = 0

  const result = await realizer.transition(next)
  assert.equal(result.stats.prepared, 0)
  assert.equal(result.stats.releasedResources, 0)
  assert.equal(result.stats.updatedInstances, 1)
  assert.equal(realizer.getInstanceHandle('instance:scene/object'), handle)
  assert.deepEqual(handle.state.transform.position, [2, 1, -3])
  assert.deepEqual(events, ['update:instance:scene/object:transform'])
})

test('S11 geometry replacement stages new content, updates the stable instance, then retires old content', async () => {
  const previous = simpleGraph({ geometry: { kind: 'box', size: [1, 1, 1] } })
  const next = simpleGraph({ geometry: { kind: 'box', size: [2, 1, 1] } })
  let sawBothHandles = false
  const { realizer, events } = createHarness({
    updateInstance(delta, handle, context) {
      sawBothHandles = Boolean(context.getResourceHandle(delta.previous.source) && context.getResourceHandle(delta.next.source))
      handle.state = delta.next
      return handle
    },
  })
  await realizer.transition(previous)
  events.length = 0

  const result = await realizer.transition(next)
  assert.equal(sawBothHandles, true)
  assert.equal(result.stats.prepared, 1)
  assert.equal(result.stats.updatedInstances, 1)
  assert.equal(result.stats.releasedResources, 1)
  assert.ok(events[0].startsWith('prepare:'))
  assert.ok(events[1].startsWith('update:instance:scene/object:source'))
  assert.ok(events[2].startsWith('release:'))
})

test('S11 prepare failure rolls back already-staged dependency resources and preserves the previous active graph', async () => {
  const previous = simpleGraph()
  const nextBuilder = createResourceGraphBuilder()
  const parent = nextBuilder.addGeometry({ kind: 'transform', source: { kind: 'sphere', radius: 0.75, segments: 12, rings: 6 }, position: [1, 0, 0] })
  nextBuilder.addInstance({ id: 'scene/object', source: parent })
  const next = nextBuilder.build()

  let failId
  const { realizer, events } = createHarness({
    prepare(resource, _context, handle) {
      if (resource.id === failId) throw new Error('prepare exploded')
      return handle
    },
  })
  await realizer.transition(previous)
  failId = parent
  events.length = 0

  await assert.rejects(realizer.transition(next), (error) => realizationIssue(error, 'RESOURCE_REALIZATION_PREPARE_FAILED'))
  assert.equal(realizer.graphKey, previous.key)
  assert.equal(realizer.faulted, false)
  assert.ok(events.some((entry) => entry.startsWith('release:')), 'staged child resources should be rolled back')
  assert.equal(realizer.instanceCount, 1)
})

test('S11 create failure removes earlier staged instances and releases staged resources before aborting the mount', async () => {
  const builder = createResourceGraphBuilder()
  const source = builder.addGeometry({ kind: 'box' })
  builder.addInstance({ id: 'scene/a', source })
  builder.addInstance({ id: 'scene/b', source })
  const graph = builder.build()
  const { realizer, events } = createHarness({
    createInstance(instance, _context, handle) {
      if (instance.id === 'instance:scene/b') throw new Error('create exploded')
      return handle
    },
  })

  await assert.rejects(realizer.transition(graph), (error) => realizationIssue(error, 'RESOURCE_REALIZATION_CREATE_FAILED'))
  assert.equal(realizer.graph, null)
  assert.equal(realizer.resourceCount, 0)
  assert.equal(realizer.instanceCount, 0)
  assert.ok(events.includes('remove:instance:scene/a'))
  assert.ok(events.some((entry) => entry.startsWith('release:')))
})

test('S11 failed stable instance updates are reversed before the previous graph remains active', async () => {
  const previous = simpleGraph({ transform: { position: [0, 0, 0] } })
  const next = simpleGraph({ transform: { position: [5, 0, 0] } })
  let failForward = true
  const { realizer, events } = createHarness({
    updateInstance(delta, handle) {
      handle.state = delta.next
      if (failForward && delta.next.transform.position[0] === 5) {
        failForward = false
        throw new Error('update exploded after mutation')
      }
      return handle
    },
  })
  await realizer.transition(previous)
  const handle = realizer.getInstanceHandle('instance:scene/object')
  events.length = 0

  await assert.rejects(realizer.transition(next), (error) => realizationIssue(error, 'RESOURCE_REALIZATION_UPDATE_FAILED'))
  assert.equal(realizer.graphKey, previous.key)
  assert.deepEqual(handle.state.transform.position, [0, 0, 0])
  assert.equal(events.filter((entry) => entry.startsWith('update:')).length, 2, 'forward update plus reverse rollback update')
})

test('S11 rollback failure faults the realizer and blocks future transitions', async () => {
  const graph = simpleGraph()
  const { realizer } = createHarness({
    createInstance() { throw new Error('create failed') },
    release() { throw new Error('rollback release failed') },
  })

  await assert.rejects(realizer.transition(graph), (error) => {
    assert.ok(realizationIssue(error, 'RESOURCE_REALIZATION_ROLLBACK_FAILED'))
    assert.ok(error.rollbackIssues.length > 0)
    return true
  })
  assert.equal(realizer.faulted, true)
  await assert.rejects(realizer.transition(graph), (error) => realizationIssue(error, 'RESOURCE_REALIZATION_FAULTED'))
})

test('S11 cleanup failures happen after commit, remain retryable, and do not fault the realizer', async () => {
  const graph = simpleGraph()
  let failRemove = true
  const { realizer } = createHarness({
    removeInstance() {
      if (failRemove) {
        failRemove = false
        throw new Error('temporary remove failure')
      }
    },
  })
  await realizer.transition(graph)

  const result = await realizer.dispose()
  assert.equal(result.committed, true)
  assert.equal(result.cleanup.issue?.code, 'RESOURCE_REALIZATION_CLEANUP_FAILED')
  assert.equal(realizer.graph, null)
  assert.equal(realizer.faulted, false)
  assert.ok(realizer.retiredCount > 0)

  const cleanup = await realizer.flushRetired()
  assert.equal(cleanup.pending, 0)
  assert.equal(realizer.retiredCount, 0)
})

test('S11 a new transition first retries pending retired cleanup and refuses to advance while cleanup still fails', async () => {
  const graph = simpleGraph()
  let fail = true
  const { realizer } = createHarness({
    removeInstance() {
      if (fail) throw new Error('persistent remove failure')
    },
  })
  await realizer.transition(graph)
  const disposal = await realizer.dispose()
  assert.ok(disposal.cleanup.issue)
  assert.equal(realizer.graph, null)

  await assert.rejects(realizer.transition(graph), (error) => realizationIssue(error, 'RESOURCE_REALIZATION_CLEANUP_FAILED'))
  assert.equal(realizer.graph, null)
  fail = false
  await realizer.transition(graph)
  assert.equal(realizer.graphKey, graph.key)
})

test('S11 full disposal removes instances before releasing dependency-safe resource order', async () => {
  const builder = createResourceGraphBuilder()
  const root = builder.addGeometry({
    kind: 'subtract',
    left: { kind: 'box', size: [2, 2, 2] },
    right: { kind: 'sphere', radius: 0.5, segments: 12, rings: 6 },
  })
  builder.addInstance({ id: 'scene/cut', source: root })
  const graph = builder.build()
  const { realizer, events } = createHarness({
    release(resource, _handle, context) {
      for (const dependency of resource.dependencies) {
        assert.ok(context.getResourceHandle(dependency), `dependency handle ${dependency} should remain available while releasing ${resource.id}`)
      }
    },
  })
  await realizer.transition(graph)
  events.length = 0
  await realizer.dispose()

  assert.ok(events[0].startsWith('remove:instance:scene/cut'))
  const releaseIds = events.filter((entry) => entry.startsWith('release:')).map((entry) => entry.slice('release:'.length))
  assert.equal(releaseIds[0], root)
  for (const dependency of graph.get(root).dependencies) assert.ok(releaseIds.indexOf(dependency) > releaseIds.indexOf(root))
})

test('S11 busy guard rejects overlapping transitions instead of interleaving adapter mutations', async () => {
  const graph = simpleGraph()
  let unblock
  const gate = new Promise((resolve) => { unblock = resolve })
  let entered
  const enteredPromise = new Promise((resolve) => { entered = resolve })
  const { realizer } = createHarness({
    async prepare(_resource, _context, handle) {
      entered()
      await gate
      return handle
    },
  })

  const first = realizer.transition(graph)
  await enteredPromise
  await assert.rejects(realizer.transition(graph), (error) => realizationIssue(error, 'RESOURCE_REALIZATION_BUSY'))
  unblock()
  await first
  assert.equal(realizer.graphKey, graph.key)
})

test('S11 snapshots are deterministic, sorted, and deeply immutable at the public boundary', async () => {
  const builder = createResourceGraphBuilder()
  const b = builder.addGeometry({ kind: 'sphere', radius: 1 })
  const a = builder.addGeometry({ kind: 'box' })
  builder.addInstance({ id: 'z', source: b })
  builder.addInstance({ id: 'a', source: a })
  const graph = builder.build()
  const { realizer } = createHarness()
  await realizer.transition(graph)
  const snapshot = realizer.snapshot()
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.resourceIds))
  assert.ok(Object.isFrozen(snapshot.instanceIds))
  assert.deepEqual(snapshot.resourceIds, [...snapshot.resourceIds].sort())
  assert.deepEqual(snapshot.instanceIds, [...snapshot.instanceIds].sort())
})
