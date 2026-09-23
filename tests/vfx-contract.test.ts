import { describe, expect, it } from 'vitest'
import { inspectWorldDocument, normalizeWorldDocument } from '../src/index.js'

describe('VFX declarative contract', () => {
  it('accepts and normalizes a valid sprite particle component', () => {
    const document = { version: '0.6', units: 'meters', entities: [{ id: 'smoke', type: 'group', components: [{ type: 'anyo.vfx', preset: 'smoke', maxParticles: 64, texture: './smoke.png', emission: { rate: 12, burst: 0 }, lifetime: { min: 1, max: 2 }, speed: { min: 0.1, max: 0.5 }, size: { start: 0.1, end: 0.5 }, spawnShape: { type: 'sphere', radius: 0.2 }, space: 'world' }] }] } as const
    expect(inspectWorldDocument(document as never).valid).toBe(true)
    const normalized = normalizeWorldDocument(document as never, { sourceContext: { baseUrl: 'https://example.test/world/' } })
    expect(normalized.entities[0]?.components?.[0]?.texture).toBe('https://example.test/world/smoke.png')
  })
  it('rejects unsupported effects and unsafe budgets', () => {
    const result = inspectWorldDocument({ version: '0.6', units: 'meters', entities: [{ id: 'bad', type: 'group', components: [{ type: 'anyo.vfx', effect: 'beam', maxParticles: 99999 }] }] } as never)
    expect(result.valid).toBe(false)
    expect(result.errors.map(issue => issue.code)).toContain('VFX_EFFECT_UNSUPPORTED')
    expect(result.errors.map(issue => issue.code)).toContain('VFX_MAX_PARTICLES_INVALID')
  })
})
