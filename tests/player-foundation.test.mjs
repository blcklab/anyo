import { WorldExplorationController } from '../dist/esm/core/index.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'

class MockCamera {
  position = [0, 1.65, 0]
  rotation = [0, 0]
  getPosition() { return this.position }
  setPosition(value) { this.position = [...value] }
  getRotation() { return this.rotation }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class PlayerRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  assetListeners = new Set()
  diagnosticListeners = new Set()
  progress = { queued: 0, loading: 0, loaded: 0, failed: 0, total: 0, ratio: 1 }
  idleCalls = 0
  disposed = false
  frameDriver = {
    mode: 'window',
    start: (callback) => { this.frameCallback = callback },
    stop: () => { this.frameCallback = null },
  }
  async mount() {}
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  getAssetProgress() { return { ...this.progress } }
  onAssetProgress(listener) { this.assetListeners.add(listener); return () => this.assetListeners.delete(listener) }
  onDiagnostic(listener) { this.diagnosticListeners.add(listener); return () => this.diagnosticListeners.delete(listener) }
  async whenIdle() { this.idleCalls += 1 }
  emitProgress(progress) {
    this.progress = { ...progress }
    for (const listener of this.assetListeners) listener({ ...progress })
  }
  emitDiagnostic(diagnostic) {
    for (const listener of this.diagnosticListeners) listener(diagnostic)
  }
  dispose() { this.disposed = true }
}

const emptyWorld = { version: '0.6', entities: [] }

test('player-owned exploration input follows world start, pause, resume, and stop', async () => {
  const renderer = new PlayerRenderer()
  const calls = []
  const runtime = {
    enabled: true,
    inputEnabled: false,
    setEnabled(value) { this.enabled = value; calls.push(['enabled', value]) },
    setInputEnabled(value) { this.inputEnabled = value; calls.push(['input', value]) },
    clearInput() { calls.push(['clear']) },
    releasePointerLock() { calls.push(['release']) },
    setMoveAxes(right, forward) { calls.push(['move', right, forward]) },
    setRun(value) { calls.push(['run', value]) },
    addLookDelta(x, y) { calls.push(['look', x, y]) },
  }
  let unbind = () => {}
  const inputPlugin = {
    name: 'test:player-input',
    setup(context) { unbind = context.world.exploration.bind(runtime) },
    dispose() { unbind() },
  }
  const world = createWorld({ renderer, plugins: [inputPlugin], autoResize: false })
  await world.load(emptyWorld)

  assert.equal(world.exploration.available, true)
  assert.equal(runtime.inputEnabled, false)
  world.exploration.setMoveAxes(0.5, 1)
  world.exploration.setRun(true)
  world.start()
  assert.equal(runtime.inputEnabled, true)

  world.pause()
  assert.equal(runtime.inputEnabled, false)
  assert.ok(calls.some((entry) => entry[0] === 'clear'))
  assert.ok(calls.some((entry) => entry[0] === 'release'))

  world.resume()
  assert.equal(runtime.inputEnabled, true)
  world.exploration.setInputEnabled(false)
  assert.equal(runtime.inputEnabled, false)
  world.stop()
  world.dispose()
})

test('world forwards renderer asset progress and readiness without exposing renderer internals', async () => {
  const renderer = new PlayerRenderer()
  const world = createWorld({ renderer, autoResize: false })
  const progressEvents = []
  const diagnostics = []
  world.on('assets:progress', (progress) => progressEvents.push(progress))
  world.on('renderer:diagnostic', (diagnostic) => diagnostics.push(diagnostic))
  await world.load(emptyWorld)

  const progress = { queued: 1, loading: 2, loaded: 3, failed: 1, total: 7, ratio: 4 / 7 }
  renderer.emitProgress(progress)
  renderer.emitDiagnostic({ severity: 'error', code: 'GPU_LOST', message: 'Device lost.' })

  assert.deepEqual(world.getAssetProgress(), progress)
  assert.deepEqual(progressEvents, [progress])
  assert.equal(diagnostics[0].code, 'GPU_LOST')
  await world.whenReady()
  await world.whenIdle()
  assert.equal(renderer.idleCalls, 1)
  world.dispose()
})

test('disposeAsync awaits XR exit before asynchronous renderer disposal', async () => {
  const order = []
  const renderer = new PlayerRenderer()
  renderer.xr = {
    state: 'active',
    capabilities: {
      supported: true,
      inline: true,
      immersiveVR: true,
      immersiveAR: false,
      localFloor: true,
      boundedFloor: false,
      controllers: true,
      gamepads: true,
      handTracking: false,
      haptics: false,
    },
    async isSessionSupported() { return true },
    async enter() {},
    async exit() {
      order.push('xr:exit:start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('xr:exit:end')
      this.state = 'idle'
    },
    getViewerPose() { return null },
    getInputSources() { return [] },
    getPlayerRigTransform() { return { position: [0, 0, 0], yaw: 0 } },
    setPlayerRigTransform() {},
    on() { return () => {} },
  }
  renderer.disposeAsync = async () => {
    order.push('renderer:dispose:start')
    await new Promise((resolve) => setTimeout(resolve, 5))
    order.push('renderer:dispose:end')
    renderer.disposed = true
  }

  const world = createWorld({ renderer, autoResize: false })
  await world.load(emptyWorld)
  await world.disposeAsync()

  assert.deepEqual(order, [
    'xr:exit:start',
    'xr:exit:end',
    'renderer:dispose:start',
    'renderer:dispose:end',
  ])
  assert.equal(world.isDisposed, true)
  assert.equal(renderer.disposed, true)
  await world.disposeAsync()
})


test('attachRenderer exits active XR before disposing the previous renderer', async () => {
  const order = []
  const previousRenderer = new PlayerRenderer()
  previousRenderer.xr = {
    state: 'active',
    capabilities: {
      supported: true,
      inline: true,
      immersiveVR: true,
      immersiveAR: false,
      localFloor: true,
      boundedFloor: false,
      controllers: true,
      gamepads: true,
      handTracking: false,
      haptics: false,
    },
    async isSessionSupported() { return true },
    async enter() {},
    async exit() {
      order.push('xr:exit:start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('xr:exit:end')
      this.state = 'idle'
    },
    getViewerPose() { return null },
    getInputSources() { return [] },
    getPlayerRigTransform() { return { position: [0, 0, 0], yaw: 0 } },
    setPlayerRigTransform() {},
    on() { return () => {} },
  }
  previousRenderer.disposeAsync = async () => {
    order.push('previous:dispose:start')
    await new Promise((resolve) => setTimeout(resolve, 5))
    order.push('previous:dispose:end')
  }

  const nextRenderer = new PlayerRenderer()
  const originalMount = nextRenderer.mount.bind(nextRenderer)
  nextRenderer.mount = async (...args) => {
    order.push('next:mount')
    return originalMount(...args)
  }

  const world = createWorld({ renderer: previousRenderer, autoResize: false })
  await world.load(emptyWorld)
  await world.attachRenderer(nextRenderer)

  assert.ok(order.indexOf('xr:exit:end') < order.indexOf('next:mount'))
  assert.ok(order.indexOf('xr:exit:end') < order.indexOf('previous:dispose:start'))
  assert.equal(world.renderer, nextRenderer)
  await world.disposeAsync()
})


test('exploration restores the previous controller when a higher-priority owner unbinds', () => {
  const events = []
  const make = (name) => ({
    enabled: true, inputEnabled: true,
    setEnabled(value) { this.enabled = value; events.push(`${name}:enabled:${value}`) },
    setInputEnabled(value) { this.inputEnabled = value; events.push(`${name}:input:${value}`) },
    setMoveAxes() {}, setRun() {}, addLookDelta() {}, clearInput() { events.push(`${name}:clear`) },
    releasePointerLock() { events.push(`${name}:release`) },
  })
  const exploration = new WorldExplorationController()
  const fallback = make('fallback')
  const physics = make('physics')
  exploration.setWorldRunning(true)
  const unbindFallback = exploration.bind(fallback)
  const unbindPhysics = exploration.bind(physics)
  assert.equal(physics.inputEnabled, true)
  assert.equal(fallback.inputEnabled, false)
  unbindPhysics()
  assert.equal(fallback.inputEnabled, true)
  assert.equal(exploration.available, true)
  unbindFallback()
  assert.equal(exploration.available, false)
  assert.ok(events.includes('fallback:input:true'))
})
