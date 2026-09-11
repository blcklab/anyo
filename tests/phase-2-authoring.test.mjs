import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyVisualPreset,
  createAnimeUrbanPrefabKit,
  normalizeEnvironmentDefinition,
  validateWorldDocument,
} from '../dist/esm/index.js'

test('anime cinematic preset is immutable and enables renderer-neutral grading', () => {
  const source = {
    version: '0.6',
    environment: { atmosphere: { mode: 'linear', near: 20, far: 120 } },
    entities: [],
  }
  const result = applyVisualPreset(source, 'anime-cinematic')
  assert.notEqual(result, source)
  assert.equal(source.environment.visualStyle, undefined)
  assert.equal(result.environment.visualStyle.profile, 'anime-cinematic')
  assert.equal(result.environment.atmosphere.near, 20)
  const normalized = normalizeEnvironmentDefinition(result.environment)
  assert.equal(normalized.postProcessing.colorGrading.enabled, true)
  assert.ok(normalized.postProcessing.colorGrading.vignette > 0)
})

test('anime urban prefab kit creates schema-valid reusable entity templates', () => {
  const prefabs = createAnimeUrbanPrefabKit()
  assert.ok(prefabs['anime-utility-pole'])
  assert.ok(prefabs['anime-street-tree'])
  assert.doesNotThrow(() => validateWorldDocument({
    version: '0.6',
    materials: {
      'utility-dark': { baseColor: '#24303b' },
      'lamp-warm': { baseColor: '#ffe2a6' },
      'tree-trunk': { baseColor: '#72513c' },
      foliage: { baseColor: '#477b57', alphaMode: 'mask' },
      'foliage-light': { baseColor: '#75a869', alphaMode: 'mask' },
      'sign-panel': { baseColor: '#d56f8f' },
    },
    prefabs,
    entities: [
      { id: 'pole-1', use: 'anime-utility-pole', position: [0, 0, 0] },
      { id: 'tree-1', use: 'anime-street-tree', position: [3, 0, 0] },
    ],
  }))
})

test('anime RPG preset configures hybrid rendering, cascades, postprocessing, and optimization', () => {
  const result = applyVisualPreset({ version: '0.6', entities: [] }, 'anime-rpg')
  const environment = normalizeEnvironmentDefinition(result.environment)
  assert.equal(environment.visualStyle.profile, 'anime-rpg')
  assert.equal(environment.visualStyle.defaultMaterialRole, 'environment')
  assert.equal(environment.shadows.enabled, true)
  assert.equal(environment.shadows.cascades, 3)
  assert.equal(environment.postProcessing.enabled, true)
  assert.equal(environment.postProcessing.ssao.enabled, true)
  assert.equal(environment.postProcessing.bloom.enabled, true)
  assert.equal(environment.postProcessing.outlines.charactersOnly, true)
  assert.equal(environment.imageQuality.mipmaps, true)
  assert.equal(environment.optimization.cachedBounds, true)
  assert.equal(environment.optimization.pipelineSorting, true)
})
