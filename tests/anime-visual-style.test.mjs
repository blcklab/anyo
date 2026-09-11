import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEnvironmentDefinition, normalizeMaterialDefinition } from '../dist/esm/index.js'

test('normalizes anime visual profiles without changing the default profile', () => {
  assert.equal(normalizeEnvironmentDefinition({}).visualStyle.profile, 'standard')
  const anime = normalizeEnvironmentDefinition({ visualStyle: { profile: 'anime-cinematic' } }).visualStyle
  assert.equal(anime.profile, 'anime-cinematic')
  assert.equal(anime.shadeSteps, 3)
  assert.ok(anime.outlineStrength > 0.7)
  assert.equal(normalizeMaterialDefinition({ shadingModel: 'toon' }).shadingModel, 'toon')
  const rpg = normalizeEnvironmentDefinition({ visualStyle: { profile: 'anime-rpg' } })
  assert.equal(rpg.visualStyle.profile, 'anime-rpg')
  assert.equal(rpg.visualStyle.defaultMaterialRole, 'environment')
  assert.equal(normalizeMaterialDefinition({ shadingModel: 'mtoon' }).shadingModel, 'mtoon')
})

test('normalizes the Anime-RPG pass 2 rendering and optimization contract', () => {
  const environment = normalizeEnvironmentDefinition({
    imageQuality: { antialiasing: 'fxaa', sharpen: 0.12 },
    lighting: { environmentRotation: 0.4 },
    postProcessing: {
      enabled: true,
      ssao: { mode: 'gtao', denoise: true, denoiseRadius: 2, directions: 6 },
      bloom: { levels: 5, scatter: 0.75, clamp: 10 },
      outlines: { mode: 'hybrid' },
    },
    optimization: {
      hizOcclusion: true,
      hizResolution: 128,
      clusteredLighting: true,
      clusterDimensions: [16, 9, 24],
      maxLightsPerCluster: 24,
      staticBatching: true,
      staticBatchMinInstances: 3,
      textureMemoryBudgetMB: 512,
      textureEvictionFrames: 300,
    },
  })
  assert.equal(environment.imageQuality.antialiasing, 'fxaa')
  assert.equal(environment.postProcessing.ssao.mode, 'gtao')
  assert.equal(environment.postProcessing.outlines.mode, 'hybrid')
  assert.deepEqual(environment.optimization.clusterDimensions, [16, 9, 24])
  assert.equal(environment.optimization.textureMemoryBudgetMB, 512)
})
