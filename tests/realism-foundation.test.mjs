import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMaterialDefinition,
  normalizeWorldDocument,
  validateWorldDocument,
} from '../dist/esm/index.js'

function repeatWorld(seed = 4242) {
  return {
    version: '0.8',
    entities: [{
      id: 'rock-row',
      type: 'box',
      size: [1, 1, 1],
      position: [0, 0.5, 0],
      repeat: {
        count: 5,
        axis: 'x',
        spacing: 2,
        variation: {
          seed,
          position: { z: [-0.6, 0.6] },
          rotation: { y: [-0.8, 0.8] },
          scale: { uniform: [0.8, 1.2] },
        },
      },
    }],
  }
}

test('S25 repeat variation is deterministic, bounded, and authoring-time only', () => {
  const first = normalizeWorldDocument(repeatWorld(4242))
  const second = normalizeWorldDocument(repeatWorld(4242))
  const differentSeed = normalizeWorldDocument(repeatWorld(4243))

  const snapshot = world => world.entities.map(entity => ({
    id: entity.id,
    position: entity.position,
    rotation: entity.rotation,
    scale: entity.scale,
  }))

  assert.deepEqual(snapshot(first), snapshot(second))
  assert.notDeepEqual(snapshot(first), snapshot(differentSeed))
  assert.equal(first.entities.length, 5)
  first.entities.forEach((entity, index) => {
    assert.equal(entity.position[0], index * 2)
    assert.ok(entity.position[2] >= -0.6 && entity.position[2] <= 0.6)
    assert.ok(entity.rotation[1] >= -0.8 && entity.rotation[1] <= 0.8)
    for (const axis of entity.scale) assert.ok(axis >= 0.8 && axis <= 1.2)
  })
})

test('S25 material texture mapping survives generic material normalization', () => {
  const textureTransform = { offset: [0.125, -0.25], scale: [4, 2], rotation: 0.35 }
  const textureWrap = { s: 'repeat', t: 'mirror-repeat' }
  const material = normalizeMaterialDefinition({ baseColorTexture: './stone.webp', textureTransform, textureWrap })
  assert.deepEqual(material.textureTransform, textureTransform)
  assert.deepEqual(material.textureWrap, textureWrap)
})

test('S25 validation rejects inverted variation ranges and zero texture scale', () => {
  assert.throws(() => validateWorldDocument({
    version: '0.8',
    entities: [{ id: 'bad-repeat', type: 'box', repeat: { count: 2, axis: 'x', spacing: 1, variation: { position: { x: [2, 1] } } } }],
  }), /Invalid Anyo world document/)

  assert.throws(() => validateWorldDocument({
    version: '0.8',
    materials: { bad: { baseColorTexture: './stone.webp', textureTransform: { scale: [0, 1] } } },
    entities: [],
  }), /Invalid Anyo world document/)

  assert.throws(() => validateWorldDocument({
    version: '0.8',
    materials: { bad: { baseColorTexture: './stone.webp', textureWrap: 'teleport' } },
    entities: [],
  }), /Invalid Anyo world document/)
})
