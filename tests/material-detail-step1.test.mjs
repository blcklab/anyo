import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inspectWorldDocument,
  normalizeMaterialDefinition,
  normalizeWorldDocument,
  validateAssetEcosystem,
} from '../dist/esm/index.js'
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

const base = (material) => ({
  version: '0.8',
  units: 'meters',
  assets: {
    microNormal: { type: 'texture', format: 'webp', src: './micro-normal.webp', colorSpace: 'linear' },
    microRoughness: { type: 'texture', format: 'webp', src: './micro-roughness.webp', colorSpace: 'linear' },
    microHeight: { type: 'texture', format: 'webp', src: './micro-height.webp', colorSpace: 'linear' },
  },
  materials: { wall: material },
  geometries: { wall: { kind: 'box', size: [2, 2, 0.2] } },
  entities: [{ id: 'wall', type: 'geometry', geometry: 'wall', material: 'wall' }],
})

test('Step 1 material.detail normalizes deterministically while old materials remain unchanged', () => {
  const oldMaterial = normalizeMaterialDefinition({ roughness: 0.72 })
  assert.equal(oldMaterial.detail, undefined)

  const detailed = normalizeMaterialDefinition({
    roughness: 0.72,
    detail: { normalTexture: 'microNormal', roughnessTexture: 'microRoughness' },
  })
  assert.deepEqual(detailed.detail, {
    normalTexture: 'microNormal',
    roughnessTexture: 'microRoughness',
    scale: 1,
    strength: 1,
    roughnessStrength: 1,
    heightScale: 0.02,
  })
})

test('Step 1 validation rejects invalid detail ranges and accepts the generic contract', () => {
  const valid = inspectWorldDocument(base({
    roughness: 0.7,
    detail: { normalTexture: 'microNormal', roughnessTexture: 'microRoughness', scale: 16, strength: 0.3, roughnessStrength: 0.25 },
  }))
  assert.equal(valid.valid, true)

  const invalid = inspectWorldDocument(base({
    detail: { normalTexture: '', scale: 0, strength: -1, roughnessStrength: 2 },
  }))
  const codes = new Set(invalid.errors.map(item => item.code))
  assert.equal(codes.has('MATERIAL_DETAIL_TEXTURE_INVALID'), true)
  assert.equal(codes.has('MATERIAL_DETAIL_SCALE_INVALID'), true)
  assert.equal(codes.has('MATERIAL_DETAIL_STRENGTH_INVALID'), true)
  assert.equal(codes.has('MATERIAL_DETAIL_ROUGHNESS_STRENGTH_INVALID'), true)
})

test('Step 1 asset validation treats nested detail maps as first-class material texture dependencies', () => {
  const normalized = normalizeWorldDocument(base({ detail: { normalTexture: 'microNormal', roughnessTexture: 'microRoughness', scale: 12 } }))
  assert.doesNotThrow(() => validateAssetEcosystem(normalized))

  const missing = normalizeWorldDocument(base({ detail: { normalTexture: 'missing-detail' } }))
  assert.throws(() => validateAssetEcosystem(missing), /ANYO_MATERIAL_ASSET_NOT_FOUND[\s\S]*detail\.normalTexture/)
})

test('Step 1 ResourceGraph content identity includes detail maps and their controls', async () => {
  const rendererA = new MockRenderer()
  const worldA = createWorld({ renderer: rendererA, plugins: [entitiesPlugin()], autoResize: false })
  await worldA.load(base({ detail: { normalTexture: 'microNormal', roughnessTexture: 'microRoughness', scale: 12, strength: 0.25 } }))
  const graphA = worldA.compiled.resourceGraph
  assert.ok(graphA)
  const materialA = graphA.list('material')[0]
  assert.ok(materialA)
  assert.equal(materialA.definition.detail.scale, 12)
  assert.equal(materialA.assetDependencies.length, 2)
  assert.ok(materialA.definition.detail.normalTexture.startsWith('asset:'))
  assert.ok(materialA.definition.detail.roughnessTexture.startsWith('asset:'))

  const rendererB = new MockRenderer()
  const worldB = createWorld({ renderer: rendererB, plugins: [entitiesPlugin()], autoResize: false })
  await worldB.load(base({ detail: { normalTexture: 'microNormal', roughnessTexture: 'microRoughness', scale: 24, strength: 0.25 } }))
  const materialB = worldB.compiled.resourceGraph.list('material')[0]
  assert.notEqual(materialA.id, materialB.id, 'detail sampling scale must participate in content identity')

  worldA.dispose()
  worldB.dispose()
})

test('Step 1 renderer capability diagnostics require materialDetail only when the field is authored', () => {
  const rendererInfo = { name: 'legacy-renderer', capabilities: { roomVisibility: true, incrementalUpdates: true, instancing: true, xr: false, materialFeatures: [] } }
  const old = inspectWorldDocument(base({ roughness: 0.8 }), { rendererInfo })
  assert.equal(old.warnings.some(item => item.code === 'ANYO_MATERIAL_FEATURE_UNSUPPORTED' && item.path.endsWith('/detail')), false)

  const detailed = inspectWorldDocument(base({ detail: { normalTexture: 'microNormal' } }), { rendererInfo })
  assert.equal(detailed.warnings.some(item => item.code === 'ANYO_MATERIAL_FEATURE_UNSUPPORTED' && item.path.endsWith('/detail')), true)
})
