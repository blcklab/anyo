import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

class Camera {
  getPosition() { return [0, 1.65, 0] }
  setPosition() {}
  getRotation() { return [0, 0] }
  setRotation() {}
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class RuntimeRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new Camera()
  runtimeBatches = []
  failRuntimeOnce = false
  async mount() {}
  async applyChanges() {}
  applyRuntimeTransforms(updates) {
    if (this.failRuntimeOnce) {
      this.failRuntimeOnce = false
      throw new Error('runtime transform failed')
    }
    this.runtimeBatches.push(updates.map((update) => ({
      entityId: update.entityId,
      authoringId: update.authoringId,
      primitiveId: update.primitiveId,
      transform: structuredClone(update.transform),
    })))
  }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

const simpleDocument = {
  version: '0.6',
  entities: [{ id: 'box', type: 'box', position: [1, 2, 3] }],
}

function createRuntimeWorld(renderer = new RuntimeRenderer(), options = {}) {
  return {
    renderer,
    world: createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false, ...options }),
  }
}

test('runtime systems execute deterministic fixed, update, and late phases', async () => {
  const calls = []
  const system = {
    name: 'phase-test',
    fixedUpdate(delta, context) { calls.push(['fixed', delta, context.frame.fixedStep]) },
    update(delta, context) { calls.push(['update', delta, context.frame.interpolationAlpha]) },
    lateUpdate(delta) { calls.push(['late', delta]) },
  }
  const world = createWorld({ plugins: [entitiesPlugin()], systems: [system], systemOptions: { fixedDeltaSeconds: 1 / 60, maxSubSteps: 4 } })
  await world.load(simpleDocument)
  world.tick(1 / 30)
  assert.deepEqual(calls.map((entry) => entry[0]), ['fixed', 'fixed', 'update', 'late'])
  assert.equal(calls[0][1], 1 / 60)
  assert.equal(calls[1][2], 2)
  assert.ok(calls[2][2] >= 0 && calls[2][2] < 1)
  world.dispose()
})

test('transient transforms batch to the renderer without mutating JSON or history', async () => {
  const { world, renderer } = createRuntimeWorld()
  await world.load(simpleDocument)
  world.transforms.set('box', { position: [4, 5, 6] }, { source: 'animation' })
  const count = await world.flushRuntimeTransforms()
  assert.equal(count, 1)
  assert.deepEqual(renderer.runtimeBatches.at(-1)[0].transform.position, [4, 5, 6])
  assert.deepEqual(world.getSourceDocument().entities[0].position, [1, 2, 3])
  assert.equal(world.canUndo, false)
  world.dispose()
})

test('runtime transform layers resolve by priority with additive composition', async () => {
  const { world, renderer } = createRuntimeWorld()
  await world.load(simpleDocument)
  world.transforms.set('box', { position: [2, 0, 0], scale: [2, 2, 2] }, { source: 'physics', priority: 100, mode: 'override' })
  world.transforms.set('box', { position: [1, 0, 0], scale: [0.5, 1, 1] }, { source: 'animation', priority: 200, mode: 'additive' })
  await world.flushRuntimeTransforms()
  const transform = renderer.runtimeBatches.at(-1)[0].transform
  assert.deepEqual(transform.position, [3, 0, 0])
  assert.deepEqual(transform.scale, [1, 2, 2])
  assert.deepEqual(world.transforms.getLayers('box').map((layer) => layer.source), ['physics', 'animation'])
  world.dispose()
})

test('parent runtime transforms propagate to child primitives', async () => {
  const { world, renderer } = createRuntimeWorld()
  await world.load({
    version: '0.6',
    entities: [{
      id: 'group', type: 'group', position: [10, 0, 0],
      children: [{ id: 'child', type: 'box', position: [1, 0, 0] }],
    }],
  })
  world.transforms.set('group', { position: [2, 0, 0] }, { source: 'animation', mode: 'additive' })
  await world.flushRuntimeTransforms()
  const child = renderer.runtimeBatches.at(-1).find((update) => update.primitiveId === 'entity:group/child')
  assert.deepEqual(child.transform.position, [13, 0, 0])
  world.dispose()
})

test('component queries expose renderer-independent system inputs', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()] })
  await world.load({
    version: '0.6',
    entities: [{
      id: 'animated', type: 'box',
      components: [{ type: 'anyo.animation', clip: 'float' }],
    }],
  })
  const matches = world.query.components('anyo.animation')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].entity.id, 'animated')
  assert.equal(matches[0].component.data.clip, 'float')
  world.dispose()
})

test('committing a runtime transform writes one authoring change and clears transient state', async () => {
  const { world, renderer } = createRuntimeWorld()
  await world.load({
    version: '0.6',
    building: { floors: [{ id: 'ground', elevation: 2, rooms: [{ id: 'room', position: [10, 20], size: [8, 8] }] }] },
    entities: [{ id: 'box', type: 'box', room: 'room', position: [1, 0.5, 2] }],
  })
  world.transforms.set('box', { position: [15, 3, 24] }, { source: 'drag' })
  await world.flushRuntimeTransforms()
  assert.equal(await world.commitRuntimeTransform('box', { source: 'drag', label: 'Place box' }), true)
  assert.deepEqual(world.getSourceDocument().entities[0].position, [5, 1, 4])
  assert.equal(world.transforms.has('box'), false)
  assert.equal(world.canUndo, true)
  assert.equal(world.getHistory().undo.at(-1).label, 'Place box')
  assert.deepEqual(renderer.runtimeBatches.at(-1)[0].transform.position, [15, 3, 24])
  world.dispose()
})

test('failed renderer synchronization restores dirty runtime transforms for retry', async () => {
  const renderer = new RuntimeRenderer()
  const { world } = createRuntimeWorld(renderer)
  await world.load(simpleDocument)
  world.transforms.set('box', { position: [8, 0, 0] }, { source: 'physics' })
  renderer.failRuntimeOnce = true
  await assert.rejects(world.flushRuntimeTransforms(), /runtime transform failed/)
  assert.equal(await world.flushRuntimeTransforms(), 1)
  assert.deepEqual(renderer.runtimeBatches.at(-1)[0].transform.position, [8, 0, 0])
  world.dispose()
})

test('system disposal removes transform layers owned by the system', async () => {
  const renderer = new RuntimeRenderer()
  const system = {
    name: 'floating-system',
    setup(context) {
      context.transforms.set('box', { position: [0, 1, 0] }, { source: context.source, mode: 'additive' })
    },
  }
  const world = createWorld({ renderer, plugins: [entitiesPlugin()], systems: [system], autoResize: false })
  await world.load(simpleDocument)
  assert.equal(world.transforms.has('box', 'floating-system'), true)
  world.dispose()
  assert.equal(world.transforms.has('box', 'floating-system'), false)
})


test('local-space runtime transforms follow rotated parent coordinates', async () => {
  const { world, renderer } = createRuntimeWorld()
  await world.load({
    version: '0.6',
    entities: [{
      id: 'group', type: 'group', rotation: [0, Math.PI / 2, 0],
      children: [{ id: 'child', type: 'box', position: [1, 0, 0] }],
    }],
  })
  world.transforms.set('group/child', { position: [1, 0, 0] }, {
    source: 'animation', mode: 'additive', space: 'local',
  })
  await world.flushRuntimeTransforms()
  const child = renderer.runtimeBatches.at(-1).find((update) => update.primitiveId === 'entity:group/child')
  assert.ok(Math.abs(child.transform.position[0]) < 1e-9)
  assert.ok(Math.abs(child.transform.position[2] + 2) < 1e-9)
  world.dispose()
})

test('system-scoped transform helpers own and clean up their layers', async () => {
  let setupContext
  const system = {
    name: 'scoped-animation',
    setup(context) {
      setupContext = context
      context.setTransform('box', { position: [0, 1, 0] }, { mode: 'additive' })
    },
  }
  const { world, renderer } = createRuntimeWorld(new RuntimeRenderer(), { systems: [system] })
  await world.load(simpleDocument)
  assert.equal(world.transforms.has('box', 'scoped-animation'), true)
  assert.equal(setupContext.source, 'scoped-animation')
  assert.equal(renderer.runtimeBatches.at(-1)[0].transform.position[1], 3)
  setupContext.clearTransform('box')
  await world.flushRuntimeTransforms()
  assert.equal(world.transforms.has('box', 'scoped-animation'), false)
  world.dispose()
})

test('runtime layers rebase by stable authoring identity when hierarchy ids change', async () => {
  const { world, renderer } = createRuntimeWorld()
  await world.load({
    version: '0.6',
    entities: [
      { id: 'left', type: 'group', children: [{ id: 'box', authoringId: 'stable-box', type: 'box' }] },
      { id: 'right', type: 'group' },
    ],
  })
  world.transforms.set('stable-box', { position: [3, 0, 0] }, { source: 'physics' })
  await world.flushRuntimeTransforms()
  await world.transaction((document) => {
    const left = document.entities[0]
    const right = document.entities[1]
    right.children = [left.children[0]]
    left.children = []
  }, 'Reparent runtime body')
  assert.equal(world.transforms.has('stable-box', 'physics'), true)
  await world.flushRuntimeTransforms()
  const rebased = renderer.runtimeBatches.at(-1).find((update) => update.primitiveId === 'entity:right/box')
  assert.equal(rebased.authoringId, 'stable-box')
  assert.deepEqual(rebased.transform.position, [3, 0, 0])
  world.dispose()
})

test('fixed-step scheduling caps substeps and keeps legacy plugin delta uncapped', async () => {
  const warnings = []
  const fixed = []
  const pluginDeltas = []
  const world = createWorld({
    plugins: [entitiesPlugin(), { name: 'legacy-delta', update(delta) { pluginDeltas.push(delta) } }],
    systems: [{ name: 'physics', fixedUpdate(delta) { fixed.push(delta) } }],
    systemOptions: { fixedDeltaSeconds: 0.01, maxSubSteps: 2, maxFrameDeltaSeconds: 0.1 },
    onWarning(message) { warnings.push(message) },
  })
  await world.load(simpleDocument)
  world.tick(0.5)
  assert.equal(fixed.length, 2)
  assert.equal(pluginDeltas[0], 0.5)
  assert.equal(warnings.filter((message) => message.includes('spiral of death')).length, 1)
  world.tick(0.5)
  assert.equal(warnings.filter((message) => message.includes('spiral of death')).length, 1)
  world.dispose()
})
