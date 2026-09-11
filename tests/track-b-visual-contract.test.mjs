import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  inspectWorldDocument,
  normalizeEnvironmentDefinition,
  normalizeMaterialDefinition,
} from '../dist/esm/index.js'

test('Track B material contract preserves advanced PBR, toon, MToon, and water intent', () => {
  const pbr = normalizeMaterialDefinition({
    lightMapTexture: 'town-lightmap', lightMapTexCoord: 1, lightMapIntensity: 0.8,
    specularFactor: 0.72, specularColor: '#dbeafe', clearcoat: 0.65,
    clearcoatRoughness: 0.18, sheenColor: '#fecdd3', sheenIntensity: 0.25,
    sheenRoughness: 0.4, alphaDither: true,
  })
  assert.equal(pbr.lightMapTexture, 'town-lightmap')
  assert.equal(pbr.clearcoat, 0.65)
  assert.equal(pbr.alphaDither, true)

  const toon = normalizeMaterialDefinition({ shadingModel: 'toon', toon: { bandSmoothness: 0.12, shadowOffset: -0.08, environmentMix: 0.3 } })
  assert.equal(toon.toon.bandSmoothness, 0.12)
  const mtoon = normalizeMaterialDefinition({ shadingModel: 'mtoon', mtoon: { environmentMix: 0.2, faceShadowSoftness: 0.1 } })
  assert.equal(mtoon.mtoon.faceShadowSoftness, 0.1)
  const water = normalizeMaterialDefinition({ shadingModel: 'water', water: { fresnelPower: 5, reflectionStrength: 0.7, absorptionStrength: 0.4 } })
  assert.equal(water.shadingModel, 'water')
  assert.equal(water.water.reflectionStrength, 0.7)
})

test('Track B environment contract normalizes shadow quality, LUT, and procedural sky', () => {
  const environment = normalizeEnvironmentDefinition({
    sky: { enabled: true, width: 512, height: 256, sunDirection: [0.2, 0.8, -0.4], haze: 0.2, cloudCoverage: 0.3, seed: 42 },
    shadows: { enabled: true, filter: 'poisson', cascadeBlend: 0.15, distanceFade: 0.2 },
    postProcessing: { colorGrading: { enabled: true, lut: 'grade-lut', lutIntensity: 0.75 } },
  })
  assert.equal(environment.shadows.filter, 'poisson')
  assert.equal(environment.shadows.cascadeBlend, 0.15)
  assert.equal(environment.postProcessing.colorGrading.lut, 'grade-lut')
  assert.equal(environment.postProcessing.colorGrading.lutIntensity, 0.75)
  assert.equal(environment.sky.seed, 42)
})

test('Track B authored visual configuration validates and rejects unsafe ranges', () => {
  const valid = inspectWorldDocument({
    version: '0.7',
    assets: {
      grade: { type: 'color-lut', format: 'cube', src: './grade.cube' },
      lightmap: { type: 'texture', format: 'ktx2', src: './town-light.ktx2', colorSpace: 'linear', compression: 'ktx2' },
    },
    materials: {
      plaza: { shadingModel: 'pbr', lightMapTexture: 'lightmap', clearcoat: 0.2 },
      river: { shadingModel: 'water', water: { fresnelPower: 4, reflectionStrength: 0.7, absorptionStrength: 0.35 } },
    },
    environment: {
      sky: { enabled: true, width: 512, height: 256, haze: 0.2, cloudCoverage: 0.3 },
      shadows: { filter: 'pcf5', cascadeBlend: 0.12, distanceFade: 0.18 },
      postProcessing: { colorGrading: { lut: 'grade', lutIntensity: 0.8 } },
    },
    entities: [],
  })
  assert.equal(valid.errors.length, 0, valid.errors.map(error => `${error.code}: ${error.message}`).join('\n'))

  const invalid = inspectWorldDocument({
    version: '0.7', entities: [],
    materials: { water: { shadingModel: 'water', water: { reflectionStrength: 2, fresnelPower: 0 } } },
    environment: {
      sky: { width: 1, cloudCoverage: 2 },
      shadows: { filter: 'blur', cascadeBlend: 2 },
      postProcessing: { colorGrading: { lut: '', lutIntensity: 2 } },
    },
  })
  const codes = new Set(invalid.errors.map(error => error.code))
  for (const code of ['PROCEDURAL_SKY_DIMENSION_INVALID', 'PROCEDURAL_SKY_RATIO_INVALID', 'SHADOW_FILTER_INVALID', 'SHADOW_BLEND_INVALID', 'COLOR_GRADING_LUT_INVALID', 'COLOR_GRADING_VALUE_INVALID', 'MATERIAL_WATER_VALUE_INVALID', 'MATERIAL_WATER_FRESNEL_INVALID']) assert.ok(codes.has(code), `missing ${code}`)
})

test('published schema includes Track B visual intent without executable renderer details', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/world-0.7.schema.json', import.meta.url), 'utf8'))
  const material = schema.$defs.material.properties
  const environment = schema.$defs.environment.properties
  assert.deepEqual(material.shadingModel.enum, ['pbr', 'toon', 'mtoon', 'water'])
  assert.ok(material.clearcoat)
  assert.ok(material.lightMapTexture)
  assert.ok(material.water)
  assert.ok(environment.sky)
  assert.ok(environment.shadows.properties.filter)
  assert.ok(environment.postProcessing.properties.colorGrading.properties.lut)
  assert.equal(JSON.stringify(schema).includes('createRenderPipeline'), false)
})
