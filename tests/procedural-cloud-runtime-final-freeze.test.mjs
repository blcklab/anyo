import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createWorld } from '../dist/esm/core/index.js'

const cloudWorld = () => ({
  version: '0.9',
  units: 'meters',
  environment: {
    sky: {
      enabled: true,
      cloudCoverage: 0.42,
      cloudDensity: 0.73,
      seed: 991,
      sunDirection: [0.4, 0.8, -0.3],
      sunIntensity: 7,
    },
  },
  entities: [],
})

class CloudCamera {
  position = [0, 1.65, 0]
  rotation = [0, 0]
  getPosition() { return this.position }
  setPosition(value) { this.position = [...value] }
  getRotation() { return this.rotation }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class CloudRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new CloudCamera()
  cloudStates = []
  async mount() {}
  applyRuntimeProceduralCloudState(state) { this.cloudStates.push(structuredClone(state)) }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

test('runtime cloud state is document-neutral, partial-update friendly, resettable, and renderer-replacement safe', async () => {
  const renderer = new CloudRenderer()
  const world = createWorld({ renderer, autoResize: false })
  try {
    await world.load(cloudWorld())
    const serializedBefore = world.serialize()

    world.setProceduralCloudState({ offset: [1.25, -0.5], evolution: 2.75 })
    assert.equal(renderer.cloudStates.length, 1)
    assert.deepEqual(renderer.cloudStates[0], {
      enabled: true,
      coverage: 0.42,
      density: 0.73,
      scale: 3.5,
      seed: 991,
      offset: [1.25, -0.5],
      evolution: 2.75,
    })

    world.setProceduralCloudState({ coverage: 0.8, density: 1.1 })
    assert.deepEqual(renderer.cloudStates.at(-1), {
      enabled: true,
      coverage: 0.8,
      density: 1.1,
      scale: 3.5,
      seed: 991,
      offset: [1.25, -0.5],
      evolution: 2.75,
    }, 'partial weather updates must preserve current motion/evolution state')
    assert.equal(world.serialize(), serializedBefore, 'runtime cloud motion/weather must not rewrite authored JSON')

    const replacement = new CloudRenderer()
    await world.attachRenderer(replacement)
    assert.equal(replacement.cloudStates.length, 1, 'runtime cloud override must be reapplied after renderer replacement')
    assert.equal(replacement.cloudStates[0].coverage, 0.8)
    assert.deepEqual(replacement.cloudStates[0].offset, [1.25, -0.5])

    assert.equal(world.resetProceduralCloudState(), true)
    assert.deepEqual(replacement.cloudStates.at(-1), {
      enabled: true,
      coverage: 0.42,
      density: 0.73,
      scale: 3.5,
      seed: 991,
      offset: [0, 0],
      evolution: 0,
    })
    assert.equal(world.resetProceduralCloudState(), false)
  } finally {
    await world.disposeAsync()
  }
})

test('runtime cloud state validates unsafe values and requires an enabled procedural sky', async () => {
  const world = createWorld({ autoResize: false })
  try {
    await world.load(cloudWorld())
    assert.throws(() => world.setProceduralCloudState({ coverage: 1.1 }), /between 0 and 1/)
    assert.throws(() => world.setProceduralCloudState({ density: -1 }), /non-negative/)
    assert.throws(() => world.setProceduralCloudState({ scale: 0 }), /greater than or equal to 0.1/)
    assert.throws(() => world.setProceduralCloudState({ offset: [0, Number.NaN] }), /finite vec2/)
    assert.throws(() => world.setProceduralCloudState({ evolution: Number.POSITIVE_INFINITY }), /evolution must be finite/)
  } finally {
    await world.disposeAsync()
  }

  const noSky = createWorld({ autoResize: false })
  try {
    await noSky.load({ version: '0.9', units: 'meters', entities: [] })
    assert.throws(() => noSky.setProceduralCloudState({ offset: [1, 0] }), /enabled procedural environment sky/)
  } finally {
    await noSky.disposeAsync()
  }
})

test('Sekai64 adapter keeps static fallback but removes baked clouds when dynamic cloud capability exists', async () => {
  const source = await readFile(new URL('../src/renderer-sekai64/Sekai64Renderer.ts', import.meta.url), 'utf8')
  assert.match(source, /setProceduralClouds/)
  assert.match(source, /cloudCoverage: dynamicClouds \? 0 : environment\.sky\.cloudCoverage/)
  assert.match(source, /applyRuntimeProceduralCloudState/)
  assert.match(source, /sunDirection: environment\.sky\?\.sunDirection/)
})
