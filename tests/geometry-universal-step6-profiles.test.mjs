import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GeometryValidationError,
  createGeometryCompiler,
  normalizeProfile,
} from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'
import { instantiateResolvedWorldDocument, resolveWorldDocumentImports } from '../dist/esm/index.js'

const square = { points: [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]] }
const diamond = { points: [[0,-.6],[.6,0],[0,.6],[-.6,0]] }
const ring = {
  points: [[-1,-1],[1,-1],[1,1],[-1,1]],
  holes: [[[-.35,-.35],[-.35,.35],[.35,.35],[.35,-.35]]],
}
const line = { kind:'line', points:[[0,0,0],[0,0,3]], segments:3 }

function meshArrays(mesh) {
  return {
    positions:[...mesh.positions],
    indices:[...mesh.indices],
    normals:mesh.normals ? [...mesh.normals] : undefined,
    uvs:mesh.uvs ? [...mesh.uvs] : undefined,
    groups:mesh.groups,
  }
}

test('Universal Geometry Step 6: named profiles resolve through the canonical profile normalizer and fail cleanly when missing', () => {
  const profiles = { square }
  const named = normalizeProfile('square', { profiles })
  const inline = normalizeProfile(square)
  assert.deepEqual(named, inline)
  assert.throws(
    () => normalizeProfile('missing', { profiles }),
    error => error instanceof GeometryValidationError
      && error.issues[0].code === 'PROFILE_INVALID'
      && /missing/.test(error.issues[0].message),
  )
})

test('Universal Geometry Step 6: named and inline profiles are identity/output-equivalent across extrude, sweep, stations, and loft', () => {
  const profiles = { square, diamond }
  const compiler = createGeometryCompiler({ profiles })
  const pairs = [
    [
      { kind:'extrude', profile:'square', depth:2, cap:true },
      { kind:'extrude', profile:square, depth:2, cap:true },
    ],
    [
      { kind:'sweep', profile:'square', path:line, cap:true },
      { kind:'sweep', profile:square, path:line, cap:true },
    ],
    [
      { kind:'sweep', profile:'square', path:line, cap:true, profileStations:[{ at:0 }, { at:1, profile:'diamond' }] },
      { kind:'sweep', profile:square, path:line, cap:true, profileStations:[{ at:0 }, { at:1, profile:diamond }] },
    ],
    [
      { kind:'loft', sections:[{ z:0, profile:'square' }, { z:2, profile:'diamond' }], cap:true },
      { kind:'loft', sections:[{ z:0, profile:square }, { z:2, profile:diamond }], cap:true },
    ],
  ]
  for (const [named, inline] of pairs) {
    assert.equal(compiler.keyFor(named), compiler.keyFor(inline))
    assert.deepEqual(meshArrays(compiler.compile(named)), meshArrays(compiler.compile(inline)))
  }
})

test('Universal Geometry Step 6: reusable profiles preserve holes through generic extrusion and sweep consumers', () => {
  const compiler = createGeometryCompiler({ profiles:{ ring } })
  const extruded = compiler.compile({ kind:'extrude', profile:'ring', depth:1.5, cap:true })
  const swept = compiler.compile({ kind:'sweep', profile:'ring', path:line, cap:true })
  assert.ok(extruded.groups.some(group => group.name === 'holeSide:0'))
  assert.ok(swept.groups.some(group => group.name === 'holeSide:0'))
})

test('Universal Geometry Step 6: equivalent named resources deduplicate by profile content and do not become renderer resources', () => {
  const profiles = { a:square, b:structuredClone(square) }
  const builder = createResourceGraphBuilder({ profiles })
  const a = builder.addGeometry({ kind:'extrude', profile:'a', depth:1 })
  const b = builder.addGeometry({ kind:'extrude', profile:'b', depth:1 })
  assert.equal(a, b)
  const graph = builder.build()
  assert.equal(graph.list('geometry').length, 1)
  assert.equal(graph.list().some(node => node.kind === 'profile'), false)
  assert.equal(typeof graph.list('geometry')[0].definition.profile, 'object')
})

test('Universal Geometry Step 6: World 0.9 accepts reusable profiles and reports unknown profile references semantically', () => {
  const valid = {
    version:'0.9',
    profiles:{ square, diamond },
    geometries:{
      extrusion:{ kind:'extrude', profile:'square', depth:1 },
      sweep:{ kind:'sweep', profile:'square', path:line, profileStations:[{ at:0 }, { at:1, profile:'diamond' }] },
      loft:{ kind:'loft', sections:[{ z:0, profile:'square' }, { z:2, profile:'diamond' }] },
    },
    entities:[{ id:'shape', type:'geometry', geometry:'extrusion' }],
  }
  assert.equal(inspectWorldDocument(valid, { mode:'strict' }).valid, true)

  const invalid = structuredClone(valid)
  invalid.geometries.sweep.profileStations[1].profile = 'missing'
  const result = inspectWorldDocument(invalid, { mode:'strict' })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(entry => entry.code === 'ANYO_PROFILE_NOT_FOUND'))
})

test('Universal Geometry Step 6: strict schemas reject malformed profile resources and empty profile references', () => {
  const malformed = {
    version:'0.9',
    profiles:{ bad:{ points:[[0,0],[1,0],[2,0]] } },
    geometries:{ shape:{ kind:'extrude', profile:'bad', depth:1 } },
    entities:[{ id:'shape', type:'geometry', geometry:'shape' }],
  }
  assert.equal(inspectWorldDocument(malformed, { mode:'strict' }).valid, false)

  const empty = {
    version:'0.9',
    geometries:{ shape:{ kind:'extrude', profile:'', depth:1 } },
    entities:[{ id:'shape', type:'geometry', geometry:'shape' }],
  }
  assert.equal(inspectWorldDocument(empty, { mode:'strict' }).valid, false)
})

test('Universal Geometry Step 6: native object imports namespace profiles and rewrite every local profile-reference site', async () => {
  const object = {
    kind:'anyo-object', version:'0.1',
    profiles:{ square, diamond },
    geometries:{
      extrusion:{ kind:'extrude', profile:'square', depth:1 },
      sweep:{ kind:'sweep', profile:'square', path:line, profileStations:[{ at:0 }, { at:1, profile:'diamond' }] },
      loft:{ kind:'loft', sections:[{ z:0, profile:'square' }, { z:2, profile:'diamond' }] },
    },
    root:{ children:[{ id:'extrusion', type:'geometry', geometry:'extrusion' }] },
  }
  const world = { version:'0.9', imports:{ part:{ src:'./part.anyo.json' } }, entities:[{ id:'part', composition:'part' }] }
  const resolved = await resolveWorldDocumentImports(world, {
    sourceContext:{ documentUrl:'https://example.test/world.anyo.json', baseUrl:'https://example.test/' },
    documentLoader: async request => ({ document:structuredClone(object), documentUrl:request.url }),
  })
  const instantiated = instantiateResolvedWorldDocument(resolved)
  const squareId = 'part::profile::square'
  const diamondId = 'part::profile::diamond'
  assert.ok(instantiated.profiles[squareId])
  assert.ok(instantiated.profiles[diamondId])
  assert.equal(instantiated.geometries['part::geometry::extrusion'].profile, squareId)
  assert.equal(instantiated.geometries['part::geometry::sweep'].profile, squareId)
  assert.equal(instantiated.geometries['part::geometry::sweep'].profileStations[1].profile, diamondId)
  assert.equal(instantiated.geometries['part::geometry::loft'].sections[0].profile, squareId)
  assert.equal(instantiated.geometries['part::geometry::loft'].sections[1].profile, diamondId)
  assert.equal(inspectWorldDocument(instantiated, { mode:'strict' }).valid, true)
})
