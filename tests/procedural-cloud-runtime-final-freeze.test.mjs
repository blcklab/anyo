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


const defaultCloudStyle = {
  detailOffset: [0, 0],
  detailEvolution: 0,
  macroScale: 1,
  detailScale: 1,
  detailStrength: 0.1,
  edgeSoftness: 0.09,
  warpStrength: 0,
  horizonVisibility: 0,
  horizonSoftness: 0.14,
  horizonExtension: 0.06,
  horizonCompression: 0.65,
  horizonAtmosphericFade: 0.7,
  shadowStrength: 0.13,
  highlightStrength: 0.9,
  silverLiningStrength: 0.26,
  ambientColor: [0.9, 0.96, 1.08],
  shadowColor: [0.64, 0.72, 0.92],
  lightColor: [1.34, 1.22, 1.08],
}

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
  resetRuntimeProceduralCloudState() { this.cloudStates.push('reset-authored') }
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
      ...defaultCloudStyle,
      detailOffset: [1.25, -0.5],
      detailEvolution: 2.75,
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
      ...defaultCloudStyle,
      detailOffset: [1.25, -0.5],
      detailEvolution: 2.75,
    }, 'partial weather updates must preserve current motion/evolution state')
    assert.equal(world.serialize(), serializedBefore, 'runtime cloud motion/weather must not rewrite authored JSON')

    const replacement = new CloudRenderer()
    await world.attachRenderer(replacement)
    assert.equal(replacement.cloudStates.length, 1, 'runtime cloud override must be reapplied after renderer replacement')
    assert.equal(replacement.cloudStates[0].coverage, 0.8)
    assert.deepEqual(replacement.cloudStates[0].offset, [1.25, -0.5])

    assert.equal(world.resetProceduralCloudState(), true)
    assert.equal(replacement.cloudStates.at(-1), 'reset-authored')
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
    assert.throws(() => world.setProceduralCloudState({ detailStrength: 0.9 }), /detailStrength/)
    assert.throws(() => world.setProceduralCloudState({ horizonVisibility: -0.1 }), /horizonVisibility/)
    assert.throws(() => world.setProceduralCloudState({ horizonExtension: 0.5 }), /horizonExtension/)
    assert.throws(() => world.setProceduralCloudState({ horizonCompression: 2 }), /horizonCompression/)
    assert.throws(() => world.setProceduralCloudState({ horizonAtmosphericFade: -0.1 }), /horizonAtmosphericFade/)
    assert.throws(() => world.setProceduralCloudState({ ambientColor: [1, Number.NaN, 1] }), /ambientColor/)
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

test('runtime cloud appearance and independent detail motion remain renderer-neutral and partial-update friendly', async () => {
  const renderer = new CloudRenderer()
  const world = createWorld({ renderer, autoResize: false })
  try {
    await world.load(cloudWorld())
    world.setProceduralCloudState({
      offset: [0.4, 0.1],
      evolution: 0.3,
      detailOffset: [0.15, 0.2],
      detailEvolution: 0.55,
      macroScale: 0.8,
      detailScale: 1.2,
      detailStrength: 0.07,
      edgeSoftness: 0.12,
      warpStrength: 0.11,
      horizonVisibility: 0.74,
      horizonSoftness: 0.2,
      horizonExtension: 0.11,
      horizonCompression: 0.72,
      horizonAtmosphericFade: 0.82,
      shadowStrength: 0.31,
      highlightStrength: 0.64,
      silverLiningStrength: 0.05,
      ambientColor: [0.9, 0.92, 1],
      shadowColor: [0.55, 0.62, 0.75],
      lightColor: [1.1, 1.04, 0.96],
    })
    const state = renderer.cloudStates.at(-1)
    assert.deepEqual(state.detailOffset, [0.15, 0.2])
    assert.equal(state.horizonVisibility, 0.74)
    assert.equal(state.horizonExtension, 0.11)
    assert.equal(state.horizonCompression, 0.72)
    assert.equal(state.horizonAtmosphericFade, 0.82)
    assert.deepEqual(state.shadowColor, [0.55, 0.62, 0.75])
    world.setProceduralCloudState({ coverage: 0.6 })
    assert.equal(renderer.cloudStates.at(-1).macroScale, 0.8)
    assert.deepEqual(renderer.cloudStates.at(-1).detailOffset, [0.15, 0.2])
  } finally {
    await world.disposeAsync()
  }
})

test('Sekai64 adapter preserves authored baked clouds until runtime clouds are explicitly activated', async () => {
  const source = await readFile(new URL('../src/renderer-sekai64/Sekai64Renderer.ts', import.meta.url), 'utf8')
  assert.match(source, /setProceduralClouds/)
  assert.match(source, /cloudCoverage: environment\.sky\.cloudCoverage/)
  assert.match(source, /cloudCoverage: this\.runtimeProceduralCloudsActive \? 0 : environment\.sky\.cloudCoverage/)
  assert.match(source, /runtimeProceduralCloudsActive/)
  assert.match(source, /resetRuntimeProceduralCloudState/)
  assert.match(source, /applyRuntimeProceduralCloudState/)
  assert.match(source, /sunDirection: runtimeSky\?\.sunDirection \?\? environment\.sky\?\.sunDirection/)
})
