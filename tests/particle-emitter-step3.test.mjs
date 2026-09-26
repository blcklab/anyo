import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createWorld,
  entitiesPlugin,
  inspectWorldDocument,
  normalizeWorldDocument,
} from '../dist/esm/index.js'

function emitter(overrides = {}) {
  return {
    type: 'anyo.vfx',
    seed: 8127,
    maxParticles: 500,
    emission: { rate: 20, burst: 0 },
    lifetime: { min: 2, max: 4 },
    spawnShape: { type: 'box', size: [5, 1, 5] },
    velocity: { min: [-0.2, 0.3, -0.2], max: [0.2, 1, 0.2] },
    acceleration: [0, 0, 0],
    gravity: [0, -0.1, 0],
    drag: 0.05,
    material: 'dust',
    color: '#efe4cf',
    opacity: { min: 0.25, max: 0.8 },
    rotation: { min: -0.4, max: 0.4 },
    importance: 0.7,
    space: 'world',
    ...overrides,
  }
}

function documentWith(component, materials = { dust: { baseColor: '#d8c7a5', roughness: 1 } }) {
  return {
    version: '0.8',
    materials,
    entities: [{ id: 'emitter', type: 'group', components: [component] }],
  }
}

async function compile(document) {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await world.load(document)
  return world
}

test('Step 3 generic emitter compiles to deterministic renderer-neutral data', async () => {
  const source = documentWith(emitter())
  const a = await compile(structuredClone(source))
  const b = await compile(structuredClone(source))
  const dataA = a.compiled.entityById.get('emitter').components[0].data
  const dataB = b.compiled.entityById.get('emitter').components[0].data

  assert.deepEqual(dataA, dataB)
  assert.deepEqual(dataA, {
    seed: 8127,
    maxParticles: 500,
    emission: { rate: 20, burst: 0 },
    lifetime: { min: 2, max: 4 },
    spawnShape: { type: 'box', size: [5, 1, 5] },
    velocity: { min: [-0.2, 0.3, -0.2], max: [0.2, 1, 0.2] },
    acceleration: [0, 0, 0],
    gravity: [0, -0.1, 0],
    drag: 0.05,
    material: 'dust',
    color: '#efe4cf',
    opacity: { min: 0.25, max: 0.8 },
    rotation: { min: -0.4, max: 0.4 },
    importance: 0.7,
    space: 'world',
    effect: 'sprite-particles',
    autoplay: true,
    playOnStart: true,
    loop: true,
  })
})

test('Step 3 accepts point, box, sphere, and surface spawn shapes', () => {
  const shapes = [
    { type: 'point' },
    { type: 'box', size: [1, 2, 3] },
    { type: 'sphere', radius: 2 },
    { type: 'surface' },
  ]
  for (const spawnShape of shapes) {
    const result = inspectWorldDocument(documentWith(emitter({ spawnShape })))
    assert.equal(result.valid, true, `${spawnShape.type}: ${JSON.stringify(result.errors)}`)
  }
})

test('Step 3 rejects invalid deterministic ranges and unsafe author intent', () => {
  const cases = [
    [emitter({ seed: 4294967296 }), 'VFX_SEED_INVALID'],
    [emitter({ maxParticles: 0 }), 'VFX_MAX_PARTICLES_INVALID'],
    [emitter({ velocity: { min: [1, 0, 0], max: [0, 0, 0] } }), 'VFX_VELOCITY_RANGE_ORDER_INVALID'],
    [emitter({ drag: -0.01 }), 'VFX_DRAG_INVALID'],
    [emitter({ opacity: { min: 0, max: 1.1 } }), 'VFX_RANGE_VALUE_INVALID'],
    [emitter({ importance: 1.1 }), 'VFX_IMPORTANCE_INVALID'],
    [emitter({ spawnShape: { type: 'capsule' } }), 'VFX_SPAWN_SHAPE_TYPE_INVALID'],
  ]
  for (const [component, expected] of cases) {
    const result = inspectWorldDocument(documentWith(component))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((entry) => entry.code === expected), `${expected}: ${JSON.stringify(result.errors)}`)
  }
})

test('Step 3 particle material references use existing semantic validation and ResourceGraph materials', async () => {
  const missing = inspectWorldDocument(documentWith(emitter({ material: 'missing' })), { mode: 'strict' })
  assert.equal(missing.valid, false)
  assert.ok(missing.errors.some((entry) => entry.code === 'ANYO_MATERIAL_NOT_FOUND' && entry.path.endsWith('/material')))

  const world = await compile(documentWith(emitter()))
  const graph = world.compiled.resourceGraph
  assert.ok(graph, 'an emitter material should make the ordinary ResourceGraph available')
  const materials = graph.list('material')
  assert.equal(materials.length, 1)
  assert.equal(materials[0].definition.baseColor, '#d8c7a5')
})

test('Step 3 emitter simulation values do not pollute ResourceGraph content identity', async () => {
  const a = await compile(documentWith(emitter({ seed: 1, emission: { rate: 10 } })))
  const b = await compile(documentWith(emitter({ seed: 999, emission: { rate: 200 } })))
  assert.equal(a.compiled.resourceGraph.key, b.compiled.resourceGraph.key)

  const c = await compile(documentWith(emitter(), { dust: { baseColor: '#ffffff', roughness: 0.2 } }))
  assert.notEqual(a.compiled.resourceGraph.key, c.compiled.resourceGraph.key)
})

test('Step 3 preserves legacy VFX authoring and resolves legacy scalar speed into canonical velocity', async () => {
  const legacy = {
    type: 'anyo.vfx',
    effect: 'sprite-particles',
    preset: 'smoke',
    texture: './fx/smoke.png',
    maxParticles: 64,
    emission: { rate: 12, burst: 0 },
    lifetime: { min: 1, max: 2 },
    speed: { min: 0.1, max: 0.5 },
    size: { start: 0.1, end: 0.4 },
    spawnShape: { type: 'sphere', radius: 0.2 },
    direction: [0, 1, 0],
    space: 'world',
  }
  const normalized = normalizeWorldDocument(
    { version: '0.6', entities: [{ id: 'smoke', type: 'group', components: [legacy] }] },
    { sourceContext: { baseUrl: 'https://example.test/worlds/lab.json' } },
  )
  assert.equal(normalized.entities[0].components[0].texture, 'https://example.test/worlds/fx/smoke.png')

  const world = await compile({ version: '0.8', entities: [{ id: 'smoke', type: 'group', components: [legacy] }] })
  const data = world.compiled.entityById.get('smoke').components[0].data
  assert.equal(data.preset, 'smoke')
  assert.deepEqual(data.speed, { min: 0.1, max: 0.5 })
  assert.deepEqual(data.direction, [0, 1, 0])
  assert.deepEqual(data.velocity, { min: [0, 0.1, 0], max: [0, 0.5, 0] })
})
