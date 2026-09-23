import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { CollisionWorld } from '../dist/esm/explore/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'

function makeWorld() {
  return createWorld({ plugins: [entitiesPlugin()], autoResize: false })
}

const shape = { height: 1.75, eyeHeight: 1.65, radius: 0.3, stepHeight: 0.32 }

const base = {
  version: '0.8',
  materials: { concrete: { baseColor: '#777777' } },
  entities: [],
}

test('S15 geometry collision lowers transformed geometry bounds into CompiledCollider', async () => {
  const world = makeWorld()
  await world.load({
    ...base,
    entities: [{
      id: 'crate', type: 'geometry', geometry: { kind: 'box', size: [4, 2, 1] },
      position: [5, 1, 0], rotation: [0, Math.PI / 2, 0], collision: true,
    }],
  })
  assert.equal(world.compiled.colliders.length, 1)
  const collider = world.compiled.colliders[0]
  assert.equal(collider.id, 'procedural:crate:bounds')
  assert.equal(collider.entityId, 'crate')
  assert.equal(collider.kind, 'solid')
  assert.ok(Math.abs(collider.bounds.min[0] - 4.5) < 1e-8)
  assert.ok(Math.abs(collider.bounds.max[0] - 5.5) < 1e-8)
  assert.ok(Math.abs(collider.bounds.min[2] + 2) < 1e-8)
  assert.ok(Math.abs(collider.bounds.max[2] - 2) < 1e-8)
  world.dispose()
})

test('S15 construction collision defaults to semantic parts so a wall doorway remains traversable', async () => {
  const world = makeWorld()
  await world.load({
    ...base,
    entities: [
      {
        id: 'floor', type: 'construction', collision: true,
        construction: { type: 'floor', size: [14, 8], thickness: 0.2, position: [0, -0.1, 0] },
      },
      {
        id: 'south-wall', type: 'construction', collision: true,
        construction: {
          type: 'wall', from: [-5, 0, 0], to: [5, 0, 0], height: 3, thickness: 0.2,
          openings: [{ kind: 'door', id: 'entry', offset: 4, width: 2, height: 2.5 }],
        },
      },
    ],
  })

  const floor = world.compiled.colliders.find((item) => item.entityId === 'floor')
  const wall = world.compiled.colliders.filter((item) => item.entityId === 'south-wall')
  assert.equal(floor.kind, 'floor')
  assert.ok(wall.length >= 3, 'wall should be decomposed around the doorway')
  assert.ok(!wall.some((item) => item.bounds.min[0] <= 0 && item.bounds.max[0] >= 0 && item.bounds.min[1] <= 1 && item.bounds.max[1] >= 1))

  const collision = new CollisionWorld(world.compiled.colliders)
  assert.equal(collision.canOccupy([0, 1.65, 0], shape), true, 'door center must remain traversable')
  assert.equal(collision.canOccupy([2.5, 1.65, 0], shape), false, 'solid wall section must block the player')
  const grounded = collision.move([0, 1.7, 2], [0, -0.2, 0], -1, shape)
  assert.equal(grounded.grounded, true)
  assert.ok(Math.abs(grounded.position[1] - 1.65) < 1e-8)
  world.dispose()
})

test('S15 semantic wall collision preserves a window void instead of replacing the wall with one AABB', async () => {
  const world = makeWorld()
  await world.load({
    ...base,
    entities: [{
      id: 'window-wall', type: 'construction', collisionPolicy: 'semantic',
      construction: {
        type: 'wall', from: [-5, 0, 0], to: [5, 0, 0], height: 3, thickness: 0.2,
        openings: [{ kind: 'window', id: 'window-a', offset: 4, width: 2, height: 1, sillHeight: 1 }],
      },
    }],
  })
  const colliders = world.compiled.colliders.filter((item) => item.entityId === 'window-wall')
  assert.ok(colliders.length >= 4)
  assert.ok(!colliders.some((item) => (
    item.bounds.min[0] < 0 && item.bounds.max[0] > 0 &&
    item.bounds.min[1] < 1.5 && item.bounds.max[1] > 1.5 &&
    item.bounds.min[2] <= 0 && item.bounds.max[2] >= 0
  )), 'window opening center must remain empty')
  world.dispose()
})

test('S15 stairs lower to stair colliders with increasing support heights', async () => {
  const world = makeWorld()
  await world.load({
    ...base,
    entities: [{
      id: 'stairs', type: 'construction', collision: true,
      construction: { type: 'stairs', width: 1.4, height: 1.2, steps: 6, depth: 2.4, closedRisers: true },
    }],
  })
  const colliders = world.compiled.colliders.filter((item) => item.entityId === 'stairs')
  assert.ok(colliders.length >= 12)
  assert.ok(colliders.every((item) => item.kind === 'stair'))
  const tops = [...new Set(colliders.map((item) => Number(item.bounds.max[1].toFixed(6))))].sort((a, b) => a - b)
  assert.ok(tops.length >= 6)
  assert.ok(tops.at(-1) > tops[0])
  world.dispose()
})


test('S15 semantic railing collision follows local path segments instead of filling the whole railing AABB', async () => {
  const world = makeWorld()
  await world.load({
    ...base,
    entities: [{
      id: 'atrium-railing', type: 'construction', collisionPolicy: 'semantic',
      construction: {
        type: 'railing', height: 1.05, postSpacing: 0.8, postWidth: 0.045, railRadius: 0.032,
        midRailHeight: 0.55,
        path: {
          kind: 'polyline', closed: false,
          points: [[-4.4, 4.25, -3.4], [4.4, 4.25, -3.4], [4.4, 4.25, 3.4], [-1.25, 4.25, 3.4]],
        },
      },
    }],
  })

  const colliders = world.compiled.colliders.filter((item) => item.entityId === 'atrium-railing')
  const railSegments = colliders.filter((item) => item.id.includes(':segment:'))
  assert.ok(railSegments.length >= 6, 'top and mid rails should be decomposed into local path segments')
  assert.equal(colliders.some((item) => item.id.includes(':topRail:collider') || item.id.includes(':midRail:collider')), false)

  const collision = new CollisionWorld(world.compiled.colliders)
  const upperShape = { ...shape, eyeHeight: 1.65 }
  assert.equal(collision.canOccupy([0, 5.9, 0], upperShape), true, 'atrium interior must not be filled by a giant railing AABB')
  assert.equal(collision.canOccupy([0, 5.9, -3.4], upperShape), false, 'actual railing segment should still block')
  world.dispose()
})

test('S15 collisionPolicy none disables procedural collision and explicit policy can opt in without legacy collision=true', async () => {
  const disabled = makeWorld()
  await disabled.load({
    ...base,
    entities: [{ id: 'ghost', type: 'geometry', geometry: { kind: 'box', size: [2, 2, 2] }, collision: true, collisionPolicy: 'none' }],
  })
  assert.equal(disabled.compiled.colliders.length, 0)
  disabled.dispose()

  const explicit = makeWorld()
  await explicit.load({
    ...base,
    entities: [{ id: 'solid', type: 'geometry', geometry: { kind: 'box', size: [2, 2, 2] }, collisionPolicy: 'bounds' }],
  })
  assert.equal(explicit.compiled.colliders.length, 1)
  explicit.dispose()
})

test('S15 semantic/parts policies fail safely for generic geometry instead of inventing inaccurate collision semantics', async () => {
  for (const collisionPolicy of ['semantic', 'parts']) {
    const world = makeWorld()
    await assert.rejects(world.load({
      ...base,
      entities: [{ id: `shape-${collisionPolicy}`, type: 'geometry', geometry: { kind: 'sphere', radius: 2 }, collisionPolicy }],
    }), /ANYO_PROCEDURAL_COLLISION_POLICY_UNSUPPORTED/)
    world.dispose()
  }
})

test('S15 authored transforms rebuild procedural colliders while leaving runtime-only geometry behavior separate', async () => {
  const world = makeWorld()
  await world.load({
    ...base,
    entities: [{ id: 'movable', type: 'geometry', geometry: { kind: 'box', size: [2, 2, 2] }, collision: true }],
  })
  const before = structuredClone(world.compiled.colliders[0].bounds)
  await world.updateEntity('movable', { position: [10, 0, -3] })
  const after = world.compiled.colliders.find((item) => item.entityId === 'movable').bounds
  assert.deepEqual(after.min.map((value, index) => Number((value - before.min[index]).toFixed(8))), [10, 0, -3])
  assert.deepEqual(after.max.map((value, index) => Number((value - before.max[index]).toFixed(8))), [10, 0, -3])
  world.dispose()
})

test('S15 schema validates collisionPolicy scope and keeps the 0.7 contract frozen', () => {
  const legacy = inspectWorldDocument({ version: '0.7', entities: [{ id: 'cube', type: 'box', collisionPolicy: 'bounds' }] })
  assert.ok(legacy.errors.some((item) => item.code === 'PROCEDURAL_COLLISION_POLICY_REQUIRES_0_8'))

  const wrongEntity = inspectWorldDocument({ version: '0.8', entities: [{ id: 'cube', type: 'box', collisionPolicy: 'bounds' }] })
  assert.ok(wrongEntity.errors.some((item) => item.code === 'ENTITY_COLLISION_POLICY_PROCEDURAL_ONLY'))
})
