import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWorld } from '../dist/esm/core/index.js'
import { compileEntities, entitiesPlugin } from '../dist/esm/entities/index.js'
import { inspectWorldDocument, normalizeWorldDocument } from '../dist/esm/schema/index.js'

const schema = JSON.parse(readFileSync(new URL('../schemas/world-0.9.schema.json', import.meta.url), 'utf8'))
const valid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-quality-q1-spotlight-valid.json', import.meta.url), 'utf8'))

function output() {
  return { primitives: [], materials: [], colliders: [], portals: [], rooms: [], triggers: [] }
}

function inspectEntity(entity, version = '0.9') {
  return inspectWorldDocument({ version, entities: [{ id: 'light', type: 'light', ...entity }] }, { mode: 'generator' })
}

class MockCamera {
  getPosition() { return [0, 0, 0] }
  setPosition() {}
  getRotation() { return [0, 0] }
  setRotation() {}
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class MockRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  info
  mounted = null
  constructor(spotLights) {
    this.info = { name: 'mock', capabilities: { text: true, images: true, models: true, lights: true, ambientLights: true, directionalLights: true, pointLights: true, spotLights, picking: false, roomVisibility: true, incrementalUpdates: true, instancing: false, shadows: false, xr: false } }
  }
  async mount(compiled) { this.mounted = compiled }
  async applyChanges(_changes, compiled) { this.mounted = compiled }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

test('Q1 exposes spot as a World 0.9 generic light with bounded cone fields and required direction', () => {
  for (const name of ['entity', 'prefab', 'composition']) {
    const def = schema.$defs[name]
    assert.deepEqual(def.properties.lightType.enum, ['ambient', 'directional', 'point', 'spot'])
    assert.equal(def.properties.direction.$ref, '#/$defs/vec3')
    assert.equal(def.properties.innerCone.minimum, 0)
    assert.equal(def.properties.innerCone.maximum, Math.PI / 2)
    assert.equal(def.properties.outerCone.exclusiveMinimum, 0)
    assert.equal(def.properties.outerCone.maximum, Math.PI / 2)
    assert.equal(def.allOf.some((entry) => entry.if?.properties?.lightType?.const === 'spot' && entry.then?.required?.includes('direction')), true)
  }
})

test('Q1 valid spot light validates, normalizes, and compiles through the existing generic light primitive', () => {
  const result = inspectWorldDocument(structuredClone(valid), { mode: 'generator' })
  assert.equal(result.valid, true, result.errors.map((entry) => `${entry.code}: ${entry.path}: ${entry.message}`).join('\n'))
  const normalized = normalizeWorldDocument(structuredClone(valid))
  const compiled = output()
  compileEntities(normalized, compiled)
  const spot = compiled.primitives.find((primitive) => primitive.entityId === 'gallery-spot')
  assert.ok(spot)
  assert.equal(spot.kind, 'light')
  assert.equal(spot.lightType, 'spot')
  assert.deepEqual(spot.direction, [0, -1, 0])
  assert.equal(spot.range, 14)
  assert.equal(spot.innerCone, 0.3)
  assert.equal(spot.outerCone, 0.65)
})

test('Q1 rejects missing/zero direction and invalid spotlight cone contracts', () => {
  const missing = inspectEntity({ lightType: 'spot', range: 10, innerCone: 0.2, outerCone: 0.5 })
  assert.equal(missing.errors.some((entry) => entry.code === 'SPOT_LIGHT_DIRECTION_REQUIRED'), true)

  const zero = inspectEntity({ lightType: 'spot', direction: [0, 0, 0], innerCone: 0.2, outerCone: 0.5 })
  assert.equal(zero.errors.some((entry) => entry.code === 'SPOT_LIGHT_DIRECTION_INVALID'), true)

  const inner = inspectEntity({ lightType: 'spot', direction: [0, -1, 0], innerCone: -0.1, outerCone: 0.5 })
  assert.equal(inner.errors.some((entry) => entry.code === 'SPOT_LIGHT_INNER_CONE_INVALID'), true)

  const outer = inspectEntity({ lightType: 'spot', direction: [0, -1, 0], innerCone: 0.2, outerCone: Math.PI })
  assert.equal(outer.errors.some((entry) => entry.code === 'SPOT_LIGHT_OUTER_CONE_INVALID'), true)

  const order = inspectEntity({ lightType: 'spot', direction: [0, -1, 0], innerCone: 0.8, outerCone: 0.4 })
  assert.equal(order.errors.some((entry) => entry.code === 'SPOT_LIGHT_CONE_ORDER_INVALID'), true)
})

test('Q1 retains light intensity/range safety checks for spot lights', () => {
  const result = inspectEntity({ lightType: 'spot', direction: [0, -1, 0], intensity: -1, range: -2, innerCone: 0.2, outerCone: 0.5 })
  const codes = new Set(result.errors.map((entry) => entry.code))
  assert.equal(codes.has('LIGHT_INTENSITY_INVALID'), true)
  assert.equal(codes.has('LIGHT_RANGE_INVALID'), true)
})

test('Q1 leaves ambient, directional, point, and World 0.8 lighting contracts compatible', () => {
  for (const lightType of ['ambient', 'directional', 'point']) {
    const result = inspectEntity({ lightType, intensity: 1, ...(lightType === 'point' ? { range: 8, decay: 2 } : {}) })
    assert.equal(result.valid, true, `${lightType}: ${result.errors.map((entry) => entry.code).join(', ')}`)
  }
  const legacy = inspectEntity({ lightType: 'point', intensity: 1, range: 8, decay: 2 }, '0.8')
  assert.equal(legacy.valid, true, legacy.errors.map((entry) => entry.code).join(', '))
})

test('Q1 reserves direction/cone authoring for spot lights', () => {
  const result = inspectEntity({ lightType: 'point', direction: [0, -1, 0] })
  assert.equal(result.errors.some((entry) => entry.code === 'SPOT_LIGHT_FIELDS_REQUIRE_SPOT'), true)
})

test('Q1 renderer capability gate requires explicit spot-light support', async () => {
  const unsupported = createWorld({ renderer: new MockRenderer(false), plugins: [entitiesPlugin()], autoResize: false })
  await assert.rejects(() => unsupported.load({ version: '0.9', entities: [{ id: 'spot', type: 'light', lightType: 'spot', direction: [0, -1, 0] }] }), /spotLights/)
  unsupported.dispose()

  const supportedRenderer = new MockRenderer(true)
  const supported = createWorld({ renderer: supportedRenderer, plugins: [entitiesPlugin()], autoResize: false })
  await supported.load({ version: '0.9', entities: [{ id: 'spot', type: 'light', lightType: 'spot', direction: [0, -1, 0] }] })
  assert.equal(supportedRenderer.mounted.primitives[0].lightType, 'spot')
  supported.dispose()
})

test('Q1 published declarations expose spot-light authoring and renderer capability fields', () => {
  const declarations = readFileSync(new URL('../dist/types/core/types.d.ts', import.meta.url), 'utf8')
  assert.equal(declarations.includes("lightType?: 'ambient' | 'directional' | 'point' | 'spot';"), true)
  assert.equal(declarations.includes('direction?: Vec3;'), true)
  assert.equal(declarations.includes('innerCone?: number;'), true)
  assert.equal(declarations.includes('outerCone?: number;'), true)
  assert.equal(declarations.includes('spotLights?: boolean;'), true)
})
