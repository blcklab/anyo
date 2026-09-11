import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANYO_TEXTURE_COLOR_SPACES,
  ANYO_VISUAL_DEFAULTS,
  inspectWorldDocument,
  normalizeEnvironmentDefinition,
  normalizeMaterialDefinition,
  normalizeWorldDocument,
} from '../dist/esm/index.js'

const baseDocument = (overrides = {}) => ({
  version: '0.6',
  units: 'meters',
  entities: [],
  ...overrides,
})

test('visual contract fixes color spaces for standard PBR texture channels', () => {
  assert.deepEqual(ANYO_TEXTURE_COLOR_SPACES, {
    baseColor: 'srgb',
    emissive: 'srgb',
    normal: 'linear',
    roughness: 'linear',
    metalness: 'linear',
    metallicRoughness: 'linear',
    occlusion: 'linear',
  })
})

test('material normalization produces safe PBR, transparency, and shadow defaults', () => {
  const opaque = normalizeMaterialDefinition({ emissive: '#00ffff' })
  assert.equal(opaque.baseColor, ANYO_VISUAL_DEFAULTS.material.baseColor)
  assert.equal(opaque.emissiveIntensity, 1)
  assert.equal(opaque.alphaMode, 'opaque')
  assert.equal(opaque.castShadow, true)
  assert.equal(opaque.receiveShadow, true)

  const glass = normalizeMaterialDefinition({ opacity: 0.35, transmission: 0.9, side: 'double' })
  assert.equal(glass.alphaMode, 'blend')
  assert.equal(glass.transparent, true)
  assert.equal(glass.doubleSided, true)
  assert.equal(glass.castShadow, false)
})

test('environment normalization supplies renderer-neutral color, lighting, shadow, and image-quality defaults', () => {
  const environment = normalizeEnvironmentDefinition({
    colorManagement: { exposure: 1.2 },
    sun: { castShadow: true, shadow: { mapSize: 2048, normalBias: 0.025 } },
  })
  assert.equal(environment.colorManagement.toneMapping, 'aces')
  assert.equal(environment.colorManagement.exposure, 1.2)
  assert.equal(environment.colorManagement.outputColorSpace, 'srgb')
  assert.equal(environment.lighting.enabled, true)
  assert.equal(environment.shadows.enabled, true)
  assert.equal(environment.shadows.mapSize, 1024)
  assert.equal(environment.sun.shadow.mapSize, 2048)
  assert.equal(environment.sun.shadow.normalBias, 0.025)
  assert.equal(environment.imageQuality.dithering, true)
})

test('world normalization applies the visual contract once before renderer adapters', () => {
  const normalized = normalizeWorldDocument(baseDocument({
    materials: {
      wall: { color: '#202733', roughness: 0.72 },
      glass: { opacity: 0.22, transmission: 0.88, ior: 1.45 },
    },
    environment: {
      background: '#090d14',
      colorManagement: { toneMapping: 'reinhard', exposure: 1.1 },
      lighting: { diffuseIntensity: 0.4, specularIntensity: 0.55 },
    },
  }))
  assert.equal(normalized.materials.wall.baseColor, '#202733')
  assert.equal(normalized.materials.wall.normalScale, 1)
  assert.equal(normalized.materials.glass.alphaMode, 'blend')
  assert.equal(normalized.materials.glass.castShadow, false)
  assert.equal(normalized.environment.colorManagement.toneMapping, 'reinhard')
  assert.equal(normalized.environment.lighting.specularIntensity, 0.55)
})

test('visual diagnostics warn about destructive light values and unsupported renderer capabilities', () => {
  const result = inspectWorldDocument(baseDocument({
    assets: { studio: { type: 'environment', format: 'hdr', src: '/studio.hdr' } },
    materials: {
      glass: {
        transmission: 0.9,
        ior: 1.45,
        thickness: 0.02,
        castShadow: true,
      },
    },
    environment: {
      ambientLight: { intensity: 3 },
      lighting: { environmentMap: 'studio' },
      colorManagement: { exposure: 1.15 },
      sun: { intensity: 10, castShadow: true },
    },
    entities: [{ id: 'hot-light', type: 'light', intensity: 140, range: 8, decay: 2 }],
  }), {
    rendererInfo: {
      name: 'basic-renderer',
      capabilities: {
        roomVisibility: true,
        incrementalUpdates: true,
        instancing: true,
        shadows: false,
        xr: false,
        materialFeatures: [],
        colorManagement: false,
        environmentLighting: false,
        environmentMaps: false,
      },
    },
  })
  assert.equal(result.valid, true)
  const codes = new Set(result.warnings.map((item) => item.code))
  for (const code of [
    'ENVIRONMENT_AMBIENT_INTENSITY_HIGH',
    'SUN_INTENSITY_HIGH',
    'LIGHT_INTENSITY_HIGH',
    'MATERIAL_TRANSPARENT_SHADOW_WARNING',
    'ANYO_MATERIAL_FEATURE_UNSUPPORTED',
    'ANYO_COLOR_MANAGEMENT_UNSUPPORTED',
    'ANYO_ENVIRONMENT_LIGHTING_UNSUPPORTED',
    'ANYO_ENVIRONMENT_MAP_UNSUPPORTED',
    'ANYO_SHADOWS_UNSUPPORTED',
  ]) assert.equal(codes.has(code), true, `missing diagnostic ${code}`)
})
