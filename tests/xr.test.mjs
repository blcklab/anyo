import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { buildingPlugin } from '../dist/esm/building/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { xrExplorationPlugin, TeleportSystem } from '../dist/esm/explore-xr/index.js'
import { Sekai64FrameDriver } from '../dist/esm/renderer-sekai64/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'

class MockCamera {
  position = [0, 1.65, 2]
  rotation = [0, 0]
  getPosition() { return [...this.position] }
  setPosition(value) { this.position = [...value] }
  getRotation() { return [...this.rotation] }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class MockFrameDriver {
  mode = 'window'
  callback = null
  starts = 0
  stops = 0
  start(callback) { this.callback = callback; this.starts++ }
  stop() { this.callback = null; this.stops++ }
  fire(time) { this.callback?.(time) }
}

class MockXRBridge {
  state = 'idle'
  capabilities = {
    supported: true, inline: true, immersiveVR: true, immersiveAR: false,
    localFloor: true, boundedFloor: true, controllers: true, gamepads: true,
    handTracking: false, haptics: false, backend: 'webgl2',
  }
  viewer = null
  inputs = []
  rig = { position: [0, 0, 0], yaw: 0 }
  listeners = new Map()
  failNext = false
  async isSessionSupported(mode) { return mode !== 'immersive-ar' }
  async enter(options) {
    if (this.failNext) {
      this.failNext = false
      const previous = this.state
      this.state = 'failed'
      const error = new Error('mock-xr-entry-failed')
      this.emit('state-change', { previous, state: this.state })
      this.emit('error', { error })
      throw error
    }
    const previous = this.state
    this.state = 'active'
    this.emit('state-change', { previous, state: this.state })
    this.emit('session-start', { mode: options.mode })
  }
  async exit() {
    const previous = this.state
    this.state = 'idle'
    this.emit('state-change', { previous, state: this.state })
    this.emit('session-end', { mode: 'immersive-vr' })
  }
  getViewerPose() { return this.viewer }
  getInputSources() { return this.inputs }
  getPlayerRigTransform() { return { position: [...this.rig.position], yaw: this.rig.yaw } }
  setPlayerRigTransform(value) { this.rig = { position: [...value.position], yaw: value.yaw } }
  on(event, listener) {
    let group = this.listeners.get(event)
    if (!group) { group = new Set(); this.listeners.set(event, group) }
    group.add(listener)
    return () => group.delete(listener)
  }
  emit(event, payload) { for (const listener of this.listeners.get(event) ?? []) listener(payload) }
}

class MockRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  frameDriver = new MockFrameDriver()
  xr = new MockXRBridge()
  renders = 0
  mounted = null
  mounts = 0
  pickResult = null
  async mount(compiled) { this.mounted = compiled; this.mounts++ }
  async applyChanges(_changes, compiled) { this.mounted = compiled }
  setRoomVisibility() {}
  render() { this.renders++ }
  resize() {}
  pick() { return null }
  pickRay() { return this.pickResult }
  dispose() {}
}

const document = {
  version: '0.6',
  exploration: {
    spawn: { room: 'room', position: [0, 1.65, 2] },
    xr: { enabled: true, locomotion: 'teleport', turning: 'snap', snapAngle: 30 },
  },
  building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [8, 8] }] }] },
  entities: [{ id: 'product', type: 'box', room: 'room', position: [0, 1, -2], interaction: { action: 'open-product' } }],
}

test('XR configuration validation rejects unsafe values and accepts defaults', () => {
  assert.equal(inspectWorldDocument(document).valid, true)
  const invalid = structuredClone(document)
  invalid.exploration.xr.snapAngle = 0
  invalid.exploration.xr.movementSpeed = -1
  const result = inspectWorldDocument(invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(issue => issue.code === 'XR_SNAP_ANGLE_INVALID'))
  assert.ok(result.errors.some(issue => issue.code === 'XR_MOVEMENT_SPEED_INVALID'))
})

test('World uses the renderer frame driver and delegates XR lifecycle', async () => {
  const renderer = new MockRenderer()
  let updates = 0
  const world = createWorld({
    renderer,
    autoResize: false,
    plugins: [buildingPlugin(), entitiesPlugin(), { name: 'test:update', update() { updates++ } }],
  })
  await world.load(document)
  world.start()
  renderer.frameDriver.fire(1000)
  renderer.frameDriver.fire(1016)
  assert.equal(updates, 2)
  assert.equal(renderer.renders, 2)
  assert.equal(renderer.frameDriver.starts, 1)
  assert.equal(await world.xr.isSupported('immersive-vr'), true)
  await world.xr.enter()
  assert.equal(world.xr.state, 'active')
  await world.xr.exit()
  assert.equal(world.xr.state, 'idle')
  world.dispose()
  assert.ok(renderer.frameDriver.stops >= 1)
})

test('Semantic selection reuses normal Anyo actions for XR sources', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, autoResize: false, plugins: [buildingPlugin(), entitiesPlugin()] })
  await world.load(document)
  let selected = null
  world.registerAction('open-product', (_params, context) => { selected = context.source })
  const primitive = world.compiled.primitives.find(item => item.entityId === 'product')
  const handled = await world.selectPrimitive({ primitiveId: primitive.id, source: 'xr-controller', distance: 2 })
  assert.equal(handled, true)
  assert.equal(selected, 'product')
  world.dispose()
})

test('Teleport validation finds floors and rejects rays blocked by walls', () => {
  const shape = { height: 1.75, eyeHeight: 1.65, radius: 0.3, stepHeight: 0.32 }
  const floor = { id: 'floor', kind: 'floor', enabled: true, bounds: { min: [-5, -0.1, -5], max: [5, 0, 5] } }
  const clear = new TeleportSystem([floor], shape).test([0, 2, 2], [0, -0.4, -1], 10)
  assert.equal(clear.valid, true)
  assert.ok(clear.position[1] >= 1.65)
  const wall = { id: 'wall', kind: 'solid', enabled: true, bounds: { min: [-1, 0, 0], max: [1, 3, 0.2] } }
  const blocked = new TeleportSystem([floor, wall], shape).test([0, 2, 2], [0, -0.4, -1], 10)
  assert.equal(blocked.valid, false)
  assert.match(blocked.reason, /blocked/)
})

test('XR exploration selects controller targets without remounting the world', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({
    renderer,
    autoResize: false,
    plugins: [buildingPlugin(), entitiesPlugin(), xrExplorationPlugin({ locomotion: 'room-scale' })],
  })
  await world.load(document)
  const primitive = world.compiled.primitives.find(item => item.entityId === 'product')
  renderer.pickResult = { primitiveId: primitive.id, entityId: 'product', distance: 2, point: [0, 1, -2], normal: [0, 0, 1] }
  let opened = 0
  world.registerAction('open-product', () => { opened++ })
  world.start()
  await world.xr.enter()
  renderer.xr.viewer = { matrix: [], position: [0, 1.65, 2], direction: [0, 0, -1], timestamp: 1000 }
  renderer.xr.inputs = [{
    id: 'right', handedness: 'right', targetRayMode: 'tracked-pointer', profiles: [],
    targetRay: { matrix: [], position: [0, 1.4, 1.8], direction: [0, 0, -1] }, grip: null,
    buttons: [{ index: 0, semantic: 'select', pressed: false, touched: false, value: 0 }], axes: [], supportsHaptics: false,
  }]
  renderer.frameDriver.fire(1000)
  renderer.frameDriver.fire(1016)
  renderer.xr.inputs[0].buttons[0].pressed = true
  renderer.frameDriver.fire(1032)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(opened, 1)
  assert.equal(renderer.renders, 3)
  world.dispose()
})

test('XR teleport commits through the player rig while preserving the physical viewer offset', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({
    renderer,
    autoResize: false,
    plugins: [buildingPlugin(), entitiesPlugin(), xrExplorationPlugin({ locomotion: 'teleport', turning: 'disabled' })],
  })
  await world.load(document)
  world.start()
  await world.xr.enter()
  renderer.xr.viewer = { matrix: [], position: [0, 1.65, 2], direction: [0, 0, -1], timestamp: 1000 }
  renderer.xr.inputs = [{
    id: 'right', handedness: 'right', targetRayMode: 'tracked-pointer', profiles: [],
    targetRay: { matrix: [], position: [0, 2, 2], direction: [0, -0.5, -1] }, grip: null,
    buttons: [{ index: 1, semantic: 'squeeze', pressed: false, touched: false, value: 0 }], axes: [], supportsHaptics: false,
  }]
  renderer.frameDriver.fire(1000)
  renderer.frameDriver.fire(1016)
  renderer.xr.inputs[0].buttons[0].pressed = true
  renderer.frameDriver.fire(1032)
  renderer.xr.inputs[0].buttons[0].pressed = false
  renderer.frameDriver.fire(1048)
  const rig = world.xr.getPlayerRigTransform()
  assert.ok(rig.position[2] < -1)
  assert.equal(renderer.mounts, 1)
  world.dispose()
})

test('Snap turning supports a single tracked controller without coupling to the editor', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({
    renderer,
    autoResize: false,
    plugins: [buildingPlugin(), entitiesPlugin(), xrExplorationPlugin({ locomotion: 'room-scale', turning: 'snap', snapAngle: 30 })],
  })
  await world.load(document)
  world.start()
  await world.xr.enter()
  renderer.xr.viewer = { matrix: [], position: [0, 1.65, 2], direction: [0, 0, -1], timestamp: 1000 }
  renderer.xr.inputs = [{
    id: 'only-controller', handedness: 'right', targetRayMode: 'tracked-pointer', profiles: [],
    targetRay: { matrix: [], position: [0, 1.4, 1.8], direction: [0, 0, -1] }, grip: null,
    buttons: [], axes: [0, 0], supportsHaptics: false,
  }]
  renderer.frameDriver.fire(1000)
  renderer.frameDriver.fire(1016)
  renderer.xr.inputs[0].axes[0] = 0.9
  renderer.frameDriver.fire(1032)
  assert.ok(Math.abs(world.xr.getPlayerRigTransform().yaw + Math.PI / 6) < 1e-6)
  world.dispose()
})

test('Failed and repeated XR entry attempts preserve the mounted Anyo world', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, autoResize: false, plugins: [buildingPlugin(), entitiesPlugin()] })
  await world.load(document)
  const compiled = world.compiled
  renderer.xr.failNext = true
  await assert.rejects(world.xr.enter(), /mock-xr-entry-failed/)
  assert.equal(world.compiled, compiled)
  assert.equal(renderer.mounts, 1)
  for (let index = 0; index < 3; index += 1) {
    await world.xr.enter()
    assert.equal(world.xr.state, 'active')
    await world.xr.exit()
    assert.equal(world.xr.state, 'idle')
  }
  assert.equal(renderer.mounts, 1)
  world.dispose()
})

test('Sekai64 frame driving transfers ownership between window RAF and XR RAF', () => {
  const originalRequest = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const windowFrames = new Map()
  let nextHandle = 1
  globalThis.requestAnimationFrame = callback => {
    const handle = nextHandle++
    windowFrames.set(handle, callback)
    return handle
  }
  globalThis.cancelAnimationFrame = handle => windowFrames.delete(handle)

  const manager = {
    state: 'active',
    callback: null,
    starts: 0,
    stops: 0,
    start(callback) { this.callback = callback; this.starts++ },
    stop() { this.callback = null; this.stops++ },
  }
  const driver = new Sekai64FrameDriver()
  const frames = []
  driver.start(time => frames.push(time))
  assert.equal(windowFrames.size, 1)
  const desktop = [...windowFrames.values()][0]
  windowFrames.clear()
  desktop(10)
  assert.deepEqual(frames, [10])

  driver.activateXR(manager, () => {})
  assert.equal(windowFrames.size, 0)
  assert.equal(manager.starts, 1)
  manager.callback({ time: 20 })
  assert.deepEqual(frames, [10, 20])

  driver.deactivateXR()
  assert.ok(manager.stops >= 1)
  assert.equal(windowFrames.size, 1)
  driver.dispose()
  globalThis.requestAnimationFrame = originalRequest
  globalThis.cancelAnimationFrame = originalCancel
})
