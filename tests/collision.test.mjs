import test from 'node:test'
import assert from 'node:assert/strict'
import { CollisionWorld } from '../dist/esm/explore/index.js'

const colliders = [
  { id: 'floor', bounds: { min: [-5, -0.2, -5], max: [5, 0, 5] }, enabled: true, kind: 'floor' },
  { id: 'wall', bounds: { min: [1, 0, -5], max: [1.2, 3, 5] }, enabled: true, kind: 'solid' },
  { id: 'step', bounds: { min: [-1, 0, -1], max: [0, 0.2, 1] }, enabled: true, kind: 'stair' },
]
const shape = { height: 1.75, eyeHeight: 1.65, radius: 0.3, stepHeight: 0.32 }

test('collision blocks walls and keeps the player on the floor', () => {
  const world = new CollisionWorld(colliders)
  const result = world.move([0.5, 1.65, 0], [1, -0.1, 0], -1, shape)
  assert.ok(result.position[0] >= 0.5 && result.position[0] < 0.71)
  assert.equal(result.position[1], 1.65)
  assert.equal(result.grounded, true)
})

test('collision permits stepping onto low stair boxes', () => {
  const world = new CollisionWorld(colliders)
  const result = world.move([0.4, 1.65, 0], [-0.6, 0, 0], 0, shape)
  assert.ok(result.position[1] >= 1.84)
})
