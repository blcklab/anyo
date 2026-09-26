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

const world = (detail) => ({
  version: '0.8', units: 'meters',
  assets: {
    microHeight: { type: 'texture', format: 'webp', src: './micro-height.webp', colorSpace: 'linear' },
  },
  materials: { wall: { roughness: 0.65, detail } },
  geometries: { wall: { kind: 'box', size: [2, 2, 0.2] } },
  entities: [{ id: 'wall', type: 'geometry', geometry: 'wall', material: 'wall' }],
})

test('Step 2 generic height detail normalizes deterministically without changing old material shape', () => {
  const old = normalizeMaterialDefinition({ roughness: 0.65 })
  assert.equal(old.detail, undefined)
  const material = normalizeMaterialDefinition({ detail: { heightTexture: 'microHeight' } })
  assert.deepEqual(material.detail, {
    heightTexture: 'microHeight',
    scale: 1,
    strength: 1,
    roughnessStrength: 1,
    heightScale: 0.02,
  })
})

test('Step 2 validates height texture and lightweight displacement range', () => {
  assert.equal(inspectWorldDocument(world({ heightTexture: 'microHeight', heightScale: 0.035 })).valid, true)
  const invalid = inspectWorldDocument(world({ heightTexture: '', heightScale: 0.5 }))
  const codes = new Set(invalid.errors.map(item => item.code))
  assert.equal(codes.has('MATERIAL_DETAIL_TEXTURE_INVALID'), true)
  assert.equal(codes.has('MATERIAL_DETAIL_HEIGHT_SCALE_INVALID'), true)
})

test('Step 2 height map is a first-class ResourceGraph dependency and affects content identity', async () => {
  const normalized = normalizeWorldDocument(world({ heightTexture: 'microHeight', heightScale: 0.02 }))
  assert.doesNotThrow(() => validateAssetEcosystem(normalized))

  const rendererA = new MockRenderer()
  const instanceA = createWorld({ renderer: rendererA, plugins: [entitiesPlugin()], autoResize: false })
  await instanceA.load(world({ heightTexture: 'microHeight', heightScale: 0.02 }))
  const materialA = instanceA.compiled.resourceGraph.list('material')[0]
  assert.equal(materialA.assetDependencies.length, 1)
  assert.ok(materialA.definition.detail.heightTexture.startsWith('asset:'))

  const rendererB = new MockRenderer()
  const instanceB = createWorld({ renderer: rendererB, plugins: [entitiesPlugin()], autoResize: false })
  await instanceB.load(world({ heightTexture: 'microHeight', heightScale: 0.04 }))
  const materialB = instanceB.compiled.resourceGraph.list('material')[0]
  assert.notEqual(materialA.id, materialB.id)
  instanceA.dispose(); instanceB.dispose()
})
