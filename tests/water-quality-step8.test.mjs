import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inspectWorldDocument, normalizeMaterialDefinition } from '../dist/esm/index.js'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'

class MockCamera {
  getPosition() { return [0, 1.65, 0] }
  setPosition() {}
  getRotation() { return [0, 0] }
  setRotation() {}
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}
class MockRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  async mount(compiled) { this.compiled = compiled }
  async applyChanges(_changes, compiled) { this.compiled = compiled }
  applyRuntimeTransforms() {}
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

const waterWorld = (water) => ({
  version: '0.8', units: 'meters',
  materials: {
    water: {
      shadingModel: 'water', baseColor: '#19364a', roughness: 0.08,
      transmission: 0.78, ior: 1.333, opacity: 0.9, transparent: true, castShadow: false,
      water,
    },
  },
  geometries: { surface: { kind: 'box', size: [8, 0.05, 8] } },
  entities: [{ id: 'water-surface', type: 'geometry', geometry: 'surface', material: 'water' }],
})

test('Step 8 water motion preserves renderer-neutral intent and old water shape', () => {
  const old = normalizeMaterialDefinition({ shadingModel: 'water', water: { fresnelPower: 5, reflectionStrength: 0.7 } })
  assert.equal(old.water.waveStrength, undefined)

  const enhanced = normalizeMaterialDefinition({
    shadingModel: 'water',
    water: { waveScale: 0.72, waveStrength: 0.11, waveSpeed: 0.65, flowDirection: [0.8, 0.2], foamStrength: 0.06 },
  })
  assert.deepEqual(enhanced.water, { waveScale: 0.72, waveStrength: 0.11, waveSpeed: 0.65, flowDirection: [0.8, 0.2], foamStrength: 0.06 })
})

test('Step 8 validates generic water motion ranges without backend knobs', () => {
  const valid = inspectWorldDocument(waterWorld({
    fresnelPower: 5, reflectionStrength: 0.78, absorptionStrength: 0.6,
    waveScale: 0.55, waveStrength: 0.09, waveSpeed: 0.45, flowDirection: [1, 0.25], foamStrength: 0.04,
  }))
  assert.equal(valid.valid, true, valid.errors.map(item => `${item.code}: ${item.message}`).join('\n'))

  const invalid = inspectWorldDocument(waterWorld({ waveScale: 0, waveStrength: 2, waveSpeed: 9, flowDirection: [0, 0], foamStrength: -1 }))
  const codes = new Set(invalid.errors.map(item => item.code))
  for (const code of ['MATERIAL_WATER_WAVE_SCALE_INVALID', 'MATERIAL_WATER_VALUE_INVALID', 'MATERIAL_WATER_WAVE_SPEED_INVALID', 'MATERIAL_WATER_FLOW_DIRECTION_ZERO']) assert.ok(codes.has(code), `missing ${code}`)
})

test('Step 8 water motion participates in ordinary ResourceGraph material identity', async () => {
  const rendererA = new MockRenderer(); const instanceA = createWorld({ renderer: rendererA, plugins: [entitiesPlugin()], autoResize: false })
  await instanceA.load(waterWorld({ waveScale: 0.5, waveStrength: 0.08, waveSpeed: 0.4, flowDirection: [1, 0], foamStrength: 0.03 }))
  const materialA = instanceA.compiled.resourceGraph.list('material')[0]
  assert.equal(materialA.definition.water.waveStrength, 0.08)

  const rendererB = new MockRenderer(); const instanceB = createWorld({ renderer: rendererB, plugins: [entitiesPlugin()], autoResize: false })
  await instanceB.load(waterWorld({ waveScale: 0.5, waveStrength: 0.12, waveSpeed: 0.4, flowDirection: [1, 0], foamStrength: 0.03 }))
  const materialB = instanceB.compiled.resourceGraph.list('material')[0]
  assert.notEqual(materialA.id, materialB.id)
  instanceA.dispose(); instanceB.dispose()
})

test('Step 8 Sekai64 adapters forward the same generic water object instead of translating to a water subsystem', async () => {
  const [rendererSource, resourceSource] = await Promise.all([
    readFile(new URL('../src/renderer-sekai64/Sekai64Renderer.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer-sekai64/Sekai64ResourceAdapter.ts', import.meta.url), 'utf8'),
  ])
  assert.match(rendererSource, /water: shadingModel === 'water' \? effectiveDefinition\.water : undefined/)
  assert.match(resourceSource, /water: definition\.water/)
  for (const source of [rendererSource, resourceSource]) assert.doesNotMatch(source, /WaterSystem|OceanSystem|RiverSystem|LakeSystem/)
})

test('Step 8 published schemas expose water intent without renderer implementation controls', async () => {
  for (const name of ['world-0.7.schema.json', 'world-0.8.schema.json']) {
    const schema = JSON.parse(await readFile(new URL(`../schemas/${name}`, import.meta.url), 'utf8'))
    const water = schema.$defs.material.properties.water.properties
    for (const field of ['waveScale', 'waveStrength', 'waveSpeed', 'flowDirection', 'foamStrength']) assert.ok(water[field], `${name} missing ${field}`)
    const serialized = JSON.stringify(water)
    for (const forbidden of ['shaderSteps', 'workgroup', 'raymarch', 'bufferResolution']) assert.equal(serialized.includes(forbidden), false)
  }
})
