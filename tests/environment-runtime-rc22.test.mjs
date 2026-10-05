import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createWorld } from '../dist/esm/core/index.js'

const worldDocument = () => ({
  version: '0.9',
  units: 'meters',
  environment: {
    background: '#102030',
    sky: {
      enabled: true,
      zenithColor: '#3569a0',
      horizonColor: '#b9d7ef',
      groundColor: '#4b5660',
      sunColor: '#fff4df',
      sunDirection: [0.4, 0.8, -0.3],
      sunIntensity: 0,
      haze: 0.2,
      cloudCoverage: 0.34,
      cloudDensity: 0.78,
      seed: 171,
    },
    ambientLight: { color: '#dce8ff', intensity: 0.4 },
    sun: { color: '#fff4df', intensity: 1.5, position: [40, 80, -30] },
  },
  entities: [],
})

class RuntimeCamera {
  position = [0, 1.65, 0]
  rotation = [0, 0]
  getPosition() { return this.position }
  setPosition(value) { this.position = [...value] }
  getRotation() { return this.rotation }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class RuntimeRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new RuntimeCamera()
  environmentStates = []
  cloudStates = []
  async mount() {}
  applyRuntimeEnvironmentState(state) { this.environmentStates.push(structuredClone(state)) }
  resetRuntimeEnvironmentState() { this.environmentStates.push('reset-authored') }
  applyRuntimeProceduralCloudState(state) { this.cloudStates.push(structuredClone(state)) }
  resetRuntimeProceduralCloudState() { this.cloudStates.push('reset-authored') }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

test('rc22 runtime environment state is document-neutral, partial-update friendly, resettable, and renderer-replacement safe', async () => {
  const renderer = new RuntimeRenderer()
  const world = createWorld({ renderer, autoResize: false })
  try {
    await world.load(worldDocument())
    const serializedBefore = world.serialize()

    world.setEnvironmentRuntimeState({
      background: '#050812',
      sky: { zenithColor: '#08142b', horizonColor: '#2a3150', sunDirection: [0.2, -0.3, -0.93], sunIntensity: 0.05 },
      ambientLight: { intensity: 0.16 },
      sun: { intensity: 0.08, position: [20, -30, -90] },
    })
    assert.equal(renderer.environmentStates.length, 1)
    assert.equal(renderer.environmentStates[0].background, '#050812')
    assert.equal(renderer.environmentStates[0].sky.groundColor, '#4b5660')
    assert.equal(renderer.environmentStates[0].ambientLight.color, '#dce8ff')
    assert.equal(renderer.environmentStates[0].sun.color, '#fff4df')

    world.setEnvironmentRuntimeState({ sky: { horizonColor: '#cc8877' }, ambientLight: { intensity: 0.22 } })
    const second = renderer.environmentStates.at(-1)
    assert.equal(second.background, '#050812')
    assert.equal(second.sky.zenithColor, '#08142b')
    assert.equal(second.sky.horizonColor, '#cc8877')
    assert.equal(second.ambientLight.intensity, 0.22)
    assert.equal(world.serialize(), serializedBefore, 'runtime environment must not rewrite authored JSON')

    const replacement = new RuntimeRenderer()
    await world.attachRenderer(replacement)
    assert.equal(replacement.environmentStates.length, 1)
    assert.equal(replacement.environmentStates[0].sky.horizonColor, '#cc8877')

    assert.equal(world.resetEnvironmentRuntimeState(), true)
    assert.equal(replacement.environmentStates.at(-1), 'reset-authored')
    assert.equal(world.resetEnvironmentRuntimeState(), false)
  } finally {
    await world.disposeAsync()
  }
})

test('rc22 runtime environment validates generic sky and lighting values', async () => {
  const world = createWorld({ autoResize: false })
  try {
    await world.load(worldDocument())
    assert.throws(() => world.setEnvironmentRuntimeState({ background: '' }), /background must be a non-empty color string/)
    assert.throws(() => world.setEnvironmentRuntimeState({ sky: { sunDirection: [0, 0, 0] } }), /non-zero finite vec3/)
    assert.throws(() => world.setEnvironmentRuntimeState({ sky: { haze: 2 } }), /between 0 and 1/)
    assert.throws(() => world.setEnvironmentRuntimeState({ sun: { intensity: -1 } }), /non-negative finite number/)
    assert.throws(() => world.setEnvironmentRuntimeState({ sun: { position: [0, Number.NaN, 0] } }), /finite vec3/)
  } finally {
    await world.disposeAsync()
  }
})

test('rc22 runtime environment changes re-light an active dynamic cloud override without changing cloud authoring', async () => {
  const renderer = new RuntimeRenderer()
  const world = createWorld({ renderer, autoResize: false })
  try {
    await world.load(worldDocument())
    world.setProceduralCloudState({ coverage: 0.34, density: 0.78, seed: 171, offset: [0.2, 0.1] })
    const before = renderer.cloudStates.length
    world.setEnvironmentRuntimeState({ sky: { sunDirection: [-0.4, 0.5, -0.75], sunIntensity: 4 } })
    assert.equal(renderer.cloudStates.length, before + 1, 'active clouds should be reapplied after live sun-state change')
    assert.deepEqual(renderer.cloudStates.at(-1).offset, [0.2, 0.1])
    assert.equal(renderer.cloudStates.at(-1).coverage, 0.34)
  } finally {
    await world.disposeAsync()
  }
})

test('rc22 Sekai64 adapter applies runtime sky/light state without provider semantics or document rebuilds', async () => {
  const source = await readFile(new URL('../src/renderer-sekai64/Sekai64Renderer.ts', import.meta.url), 'utf8')
  assert.match(source, /applyRuntimeEnvironmentState\(state: RuntimeEnvironmentState\)/)
  assert.match(source, /environmentAmbientLight\.color\.set/)
  assert.match(source, /environmentSunLight\.direction\.set/)
  assert.match(source, /refreshRuntimeSkyMap/)
  assert.match(source, /runtimeEnvironmentState\?\.sky/)
  assert.doesNotMatch(source, /SiriusX|Helios|Luna/)
})
