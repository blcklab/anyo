import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorldDocument } from '../dist/esm/schema/index.js'
import { compileBuilding } from '../dist/esm/building/index.js'

function output() { return { primitives: [], materials: [], colliders: [], portals: [], rooms: [], triggers: [] } }
function compile(rooms) {
  const document = normalizeWorldDocument({ version: '0.3.1', building: { floors: [{ id: 'ground', elevation: 0, rooms }] } })
  const compiled = output()
  compileBuilding(document, compiled)
  return { document, compiled }
}
function wallSegments(compiled, room, wall) {
  return compiled.primitives.filter((p) => p.id.startsWith(`${room}:wall:${wall}:`))
}

test('attached-room cuts preserve exposed intervals for wider and offset children', () => {
  const { compiled } = compile([
    { id: 'parent', position: [0, 0], size: [8, 8] },
    { id: 'wide', size: [12, 4], attachTo: { room: 'parent', wall: 'north', offset: 2 } },
  ])
  const exposed = wallSegments(compiled, 'wide', 'south')
  assert.equal(exposed.length, 2)
  assert.ok(exposed.every((segment) => segment.size[0] > 0))
  assert.ok(exposed.every((segment) => Math.abs(segment.size[0] - 4) < 1e-6))
  assert.ok(exposed.every((segment) => Math.abs(segment.transform.position[0] - 6) < 1e-6))
})

test('positive attachment gaps preserve the complete child wall and do not create an implicit portal', () => {
  const { compiled } = compile([
    { id: 'parent', position: [0, 0], size: [8, 8] },
    { id: 'child', size: [4, 4], attachTo: { room: 'parent', wall: 'north', gap: 1 } },
  ])
  const segments = wallSegments(compiled, 'child', 'south')
  assert.equal(segments.length, 1)
  assert.equal(segments[0].size[0], 4)
  assert.equal(compiled.portals.length, 0)
})

test('non-overlapping attached rooms are rejected with geometry context', () => {
  assert.throws(() => compile([
    { id: 'parent', position: [0, 0], size: [8, 8] },
    { id: 'child', size: [2, 4], attachTo: { room: 'parent', wall: 'north', offset: 10 } },
  ]), /ANYO_ATTACHMENT_OVERLAP_INVALID[\s\S]*Room: child/)
})

test('multiple physical openings between the same rooms compile as stable independent portals', () => {
  const rooms = [
    {
      id: 'a', position: [0, 0], size: [8, 8],
      openings: [
        { id: 'left-door', type: 'door', wall: 'north', offset: 2.5, width: 1, height: 2.2, targetRoom: 'b', open: true },
        { id: 'right-door', type: 'door', wall: 'north', offset: 5.5, width: 1, height: 2.2, targetRoom: 'b', open: false },
      ],
    },
    { id: 'b', size: [8, 4], attachTo: { room: 'a', wall: 'north' } },
  ]
  const first = compile(rooms).compiled
  const second = compile(rooms).compiled
  assert.equal(first.portals.length, 2)
  assert.deepEqual(first.portals.map((p) => p.id).sort(), [
    'portal:a:b:left-door', 'portal:a:b:right-door',
  ])
  assert.deepEqual(first.portals.map((p) => [p.id, p.open]).sort(), [
    ['portal:a:b:left-door', true], ['portal:a:b:right-door', false],
  ])
  assert.deepEqual(first.portals.map((p) => p.id), second.portals.map((p) => p.id))
})
