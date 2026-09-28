import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorld } from '../dist/esm/core/index.js'
import { explorePlugin } from '../dist/esm/explore/index.js'
import { inspectWorldDocument, normalizeWorldDocument } from '../dist/esm/schema/index.js'

const schema08Url = new URL('../schemas/world-0.8.schema.json', import.meta.url)
const schema09Url = new URL('../schemas/world-0.9.schema.json', import.meta.url)
const typesUrl = new URL('../dist/types/core/types.d.ts', import.meta.url)

class MockCamera {
  position = [7, 8, 9]
  rotation = [0.35, -0.15]
  getPosition() { return [...this.position] }
  setPosition(value) { this.position = [...value] }
  getRotation() { return [...this.rotation] }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class MockRenderer {
  frameDriver = { mode: 'window', start() {}, stop() {} }
  canvas = {
    tabIndex: -1,
    getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  }
  camera = new MockCamera()
  async mount() {}
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

function world09(spawn) {
  return {
    version: '0.9',
    exploration: { spawn },
    entities: [{ id: 'ground', type: 'plane', size: [4, 4] }],
  }
}

test('World 0.9 schema adds optional spawn rotation while World 0.8 remains unchanged', async () => {
  const schema08 = JSON.parse(await readFile(schema08Url, 'utf8'))
  const schema09 = JSON.parse(await readFile(schema09Url, 'utf8'))
  assert.equal(schema08.$defs.exploration.properties.spawn.properties.rotation, undefined)
  assert.deepEqual(schema09.$defs.exploration.properties.spawn.properties.rotation, {
    $ref: '#/$defs/vec3',
    description: 'Initial Euler facing in radians [x, y, z].',
  })
})

test('spawn rotation validates and normalization preserves authored Euler radians', () => {
  const document = world09({ position: [1, 1.7, 2], rotation: [0.2, Math.PI, -0.1] })
  const result = inspectWorldDocument(document)
  assert.equal(result.valid, true, result.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))
  assert.deepEqual(normalizeWorldDocument(document).exploration.spawn.rotation, [0.2, Math.PI, -0.1])
})

test('invalid spawn rotation is rejected with an actionable diagnostic', () => {
  for (const rotation of [[0, 1], [0, 1, Number.NaN], 'north']) {
    const result = inspectWorldDocument(world09({ rotation }))
    assert.equal(result.valid, false)
    assert.equal(result.errors.some((entry) => entry.code === 'EXPLORATION_SPAWN_ROTATION_INVALID' && entry.path === '/exploration/spawn/rotation'), true)
  }
})

test('World applies spawn Euler rotation as camera yaw/pitch using the established Anyo convention', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, autoResize: false })
  await world.load(world09({ position: [1, 1.7, 2], rotation: [0.25, 1.5, -0.4] }))
  assert.deepEqual(renderer.camera.getPosition(), [1, 1.7, 2])
  assert.deepEqual(renderer.camera.getRotation(), [1.5, 0.25])
  world.dispose()
})

test('position-only spawn preserves the existing camera orientation behavior', async () => {
  const renderer = new MockRenderer()
  const initialRotation = renderer.camera.getRotation()
  const world = createWorld({ renderer, autoResize: false })
  await world.load(world09({ position: [2, 1.7, 3] }))
  assert.deepEqual(renderer.camera.getPosition(), [2, 1.7, 3])
  assert.deepEqual(renderer.camera.getRotation(), initialRotation)
  world.dispose()
})

test('first-person look continues from authored spawn orientation without an initial jump', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, plugins: [explorePlugin({ browserInput: false, pointerLock: false })], autoResize: false })
  await world.load(world09({ position: [0, 1.7, 0], rotation: [0.1, 1.2, 0] }))
  assert.deepEqual(renderer.camera.getRotation(), [1.2, 0.1])
  world.start()
  world.exploration.addLookDelta(10, -5)
  assert.ok(Math.abs(renderer.camera.getRotation()[0] - (1.2 - 10 * 0.0022)) < 1e-12)
  assert.ok(Math.abs(renderer.camera.getRotation()[1] - (0.1 + 5 * 0.0022)) < 1e-12)
  world.stop()
  world.dispose()
})

test('an authored active camera keeps precedence over exploration spawn rotation', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, autoResize: false })
  await world.load({
    ...world09({ position: [9, 9, 9], rotation: [0.7, 2.1, 0] }),
    cameras: { intro: { type: 'perspective', position: [3, 4, 5], rotation: [0.2, 0.8, 0] } },
    activeCamera: 'intro',
  })
  assert.deepEqual(renderer.camera.getRotation(), [0.35, -0.15], 'generic mock renderer keeps existing active-camera behavior when no activateCamera adapter exists during mount')
  world.dispose()
})

test('published TypeScript declarations expose optional spawn rotation', async () => {
  const declarations = await readFile(typesUrl, 'utf8')
  assert.equal(declarations.includes('rotation?: Vec3;'), true)
  assert.equal(declarations.includes('Initial Euler facing in radians [x, y, z]'), true)
})
