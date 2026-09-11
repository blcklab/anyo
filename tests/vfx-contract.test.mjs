import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectWorldDocument, normalizeWorldDocument, validateWorldDocument } from '../dist/esm/index.js'

const smoke = {
  type: 'anyo.vfx', effect: 'sprite-particles', preset: 'smoke',
  texture: './fx/smoke.png', maxParticles: 64,
  emission: { rate: 12, burst: 0 }, lifetime: { min: 1, max: 2 },
  speed: { min: 0.1, max: 0.5 }, size: { start: 0.1, end: 0.4 },
  spawnShape: { type: 'sphere', radius: 0.2 }, space: 'world'
}
const documentWith = component => ({
  version: '0.6',
  entities: [{ id: 'smoke', type: 'group', position: [1, 2, 3], components: [component] }]
})

test('validates VFX settings and resolves relative texture URLs', () => {
  const document = documentWith(smoke)
  validateWorldDocument(document)
  const normalized = normalizeWorldDocument(document, {
    sourceContext: { baseUrl: 'https://example.test/worlds/lab.json' }
  })
  assert.equal(normalized.entities[0].components[0].texture, 'https://example.test/worlds/fx/smoke.png')
})

test('VFX defaults accept a sprite preset without an explicit effect', () => {
  const { effect, ...preset } = smoke
  const document = documentWith(preset)
  assert.equal(inspectWorldDocument(document).valid, true)
  const normalized = normalizeWorldDocument(document, {
    sourceContext: { baseUrl: 'https://example.test/world/' }
  })
  assert.equal(normalized.entities[0].components[0].texture, 'https://example.test/world/fx/smoke.png')
})

test('rejects unsupported effects and zero particle budgets', () => {
  assert.throws(() => validateWorldDocument(documentWith({ ...smoke, effect: 'beam' })), /VFX|sprite-particles/i)
  assert.throws(() => validateWorldDocument(documentWith({ ...smoke, maxParticles: 0 })), /maxParticles|VFX/i)
})

test('VFX validation reports stable codes for unsupported effects and excessive budgets', () => {
  const result = inspectWorldDocument(documentWith({ type: 'anyo.vfx', effect: 'beam', maxParticles: 99999 }))
  assert.equal(result.valid, false)
  const codes = result.errors.map(issue => issue.code)
  assert.ok(codes.includes('VFX_EFFECT_UNSUPPORTED'))
  assert.ok(codes.includes('VFX_MAX_PARTICLES_INVALID'))
})
