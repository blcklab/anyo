import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inspectWorldDocument, normalizeEnvironmentDefinition } from '../dist/esm/index.js'

const nightWorld = stars => ({
  version: '0.8',
  units: 'meters',
  environment: {
    background: '#01030a',
    sky: {
      enabled: true,
      width: 512,
      height: 256,
      zenithColor: '#01030d',
      horizonColor: '#070b18',
      sunIntensity: 0,
      cloudCoverage: 0,
      seed: 77,
      stars,
    },
  },
  entities: [],
})

test('Step 9 keeps star authoring renderer-neutral and backward compatible', () => {
  const legacy = normalizeEnvironmentDefinition({ sky: { enabled: true, seed: 42 } })
  assert.equal(legacy.sky.stars, undefined)

  const environment = normalizeEnvironmentDefinition(nightWorld({ enabled: true, density: 0.55, intensity: 4, brightnessVariation: 0.7, sizeVariation: 0.5, colorTemperatureVariation: 0.4, seed: 8127 }).environment)
  assert.deepEqual(environment.sky.stars, { enabled: true, density: 0.55, intensity: 4, brightnessVariation: 0.7, sizeVariation: 0.5, colorTemperatureVariation: 0.4, seed: 8127 })
})

test('Step 9 validates generic procedural star controls and rejects unsafe ranges', () => {
  const valid = inspectWorldDocument(nightWorld({ enabled: true, density: 0.65, intensity: 5, brightnessVariation: 0.8, sizeVariation: 0.7, colorTemperatureVariation: 0.5, seed: 11 }))
  assert.equal(valid.errors.length, 0, valid.errors.map(item => `${item.code}: ${item.message}`).join('\n'))

  const invalid = inspectWorldDocument(nightWorld({ enabled: 'yes', density: 2, intensity: -1, brightnessVariation: -0.1, sizeVariation: 2, colorTemperatureVariation: Infinity, seed: NaN }))
  const codes = new Set(invalid.errors.map(item => item.code))
  for (const code of ['PROCEDURAL_STARS_ENABLED_INVALID', 'PROCEDURAL_STARS_RATIO_INVALID', 'PROCEDURAL_STARS_INTENSITY_INVALID', 'PROCEDURAL_STARS_SEED_INVALID']) assert.ok(codes.has(code), `missing ${code}`)
})

test('Step 9 Sekai64 adapter maps sky-star intent into the existing procedural environment path', async () => {
  const source = await readFile(new URL('../src/renderer-sekai64/Sekai64Renderer.ts', import.meta.url), 'utf8')
  for (const field of ['starDensity', 'starIntensity', 'starBrightnessVariation', 'starSizeVariation', 'starColorTemperatureVariation', 'starSeed']) assert.match(source, new RegExp(field))
  assert.match(source, /background: starDensity > 0/)
  for (const forbidden of ['StarSystem', 'StarRenderer', 'StarEntity', 'createStarNode']) assert.equal(source.includes(forbidden), false)
})

test('Step 9 published schemas expose star intent without GPU implementation controls', async () => {
  for (const name of ['world-0.7.schema.json', 'world-0.8.schema.json']) {
    const schema = JSON.parse(await readFile(new URL(`../schemas/${name}`, import.meta.url), 'utf8'))
    const stars = schema.$defs.environment.properties.sky.properties.stars.properties
    for (const field of ['enabled', 'density', 'intensity', 'brightnessVariation', 'sizeVariation', 'colorTemperatureVariation', 'seed']) assert.ok(stars[field], `${name} missing ${field}`)
    const serialized = JSON.stringify(stars)
    for (const forbidden of ['pointCount', 'shader', 'workgroup', 'buffer', 'backend']) assert.equal(serialized.includes(forbidden), false)
  }
})


test('Step 9 authored night-sky showcase validates as ordinary Anyo JSON', async () => {
  const showcase = JSON.parse(await readFile(new URL('../examples/step-09-night-sky/world.anyo.json', import.meta.url), 'utf8'))
  const result = inspectWorldDocument(showcase)
  assert.equal(result.errors.length, 0, result.errors.map(item => `${item.code}: ${item.message}`).join('\n'))
  assert.equal(showcase.environment.sky.cloudCoverage, 0)
  assert.equal(showcase.environment.sky.sunIntensity, 0)
  assert.equal(showcase.environment.sky.stars.enabled, true)
  assert.ok(showcase.environment.sky.stars.density > 0)
})
