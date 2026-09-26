import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld, entitiesPlugin, inspectWorldDocument } from '../dist/esm/index.js'

function doc(component) {
  return { version: '0.8', entities: [{ id: 'fx', type: 'group', components: [component] }] }
}

async function compiled(component) {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await world.load(doc(component))
  return world.compiled.entityById.get('fx').components[0].data
}

test('Step 5 compiles generic appearance-over-life ramps deterministically', async () => {
  const component = {
    type: 'anyo.vfx',
    seed: 12,
    maxParticles: 64,
    lifetime: { min: 2, max: 2 },
    overLife: {
      size: { start: 0.05, end: 0.3 },
      opacity: { start: 0, end: 1 },
      rotation: { start: 0, end: 3.14159 },
      color: { start: '#ff8800', end: '#2200ff' },
    },
  }
  const a = await compiled(structuredClone(component))
  const b = await compiled(structuredClone(component))
  assert.deepEqual(a.overLife, component.overLife)
  assert.deepEqual(a, b)
})

test('Step 5 preserves legacy size start/end by canonicalizing it as size-over-life', async () => {
  const data = await compiled({
    type: 'anyo.vfx',
    maxParticles: 8,
    lifetime: { min: 1, max: 1 },
    size: { start: 0.1, end: 0.7 },
  })
  assert.deepEqual(data.size, { start: 0.1, end: 0.7 })
  assert.deepEqual(data.overLife.size, { start: 0.1, end: 0.7 })
})

test('Step 5 rejects invalid over-life values without changing old emitter defaults', () => {
  const invalid = inspectWorldDocument(doc({
    type: 'anyo.vfx',
    overLife: { opacity: { start: -0.1, end: 1.2 }, size: { start: -1, end: 1 } },
  }))
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.some((entry) => entry.code === 'VFX_OVER_LIFE_VALUE_INVALID'))

  const old = inspectWorldDocument(doc({ type: 'anyo.vfx', maxParticles: 16 }))
  assert.equal(old.valid, true, JSON.stringify(old.errors))
})
