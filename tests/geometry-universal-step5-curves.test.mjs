import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GeometryValidationError,
  createGeometryCompiler,
  layoutPathArray,
  normalizeCurve,
  sampleCurve,
} from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'
import { instantiateResolvedWorldDocument, resolveWorldDocumentImports } from '../dist/esm/index.js'

const profile = { points: [[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]] }

function rounded(values, digits = 6) {
  return values.map(value => Number(value.toFixed(digits)))
}

test('Universal Geometry Step 5: analytic arc, circle, and helix lower deterministically into the shared sampled-curve vocabulary', () => {
  const arc = normalizeCurve({ kind:'arc', center:[1,2,3], radius:2, startAngle:0, endAngle:Math.PI / 2, segments:4 })
  assert.equal(arc.kind, 'polyline')
  assert.equal(arc.segments, 4)
  assert.deepEqual(rounded(arc.points[0]), [3,2,3])
  assert.deepEqual(rounded(arc.points.at(-1)), [1,2,1])

  const circle = sampleCurve({ kind:'circle', center:[0,0,0], radius:2, segments:8 })
  assert.equal(circle.closed, true)
  assert.equal(circle.points.length, 9)
  assert.deepEqual(circle.points[0], circle.points.at(-1))
  assert.ok(Math.abs(circle.totalLength - 8 * 2 * Math.sin(Math.PI / 8) * 2) < 1e-6)

  const helixA = sampleCurve({ kind:'helix', origin:[0,0,0], radius:1, height:4, turns:2, segments:32 })
  const helixB = sampleCurve({ kind:'helix', origin:[0,0,0], radius:1, height:4, turns:2, segments:32 })
  assert.deepEqual(helixA.points, helixB.points)
  assert.deepEqual(helixA.tangents, helixB.tangents)
  assert.deepEqual(rounded(helixA.points[0]), [1,0,0])
  assert.deepEqual(rounded(helixA.points.at(-1)), [1,4,0])
})

test('Universal Geometry Step 5: named curve resources normalize by content and match inline sweep identity/output', () => {
  const curves = {
    spine: { kind:'cubicBezier', points:[[0,0,0],[1,1,1],[2,-1,2],[3,0,3]], segments:24 },
  }
  const compiler = createGeometryCompiler({ curves })
  const referenced = { kind:'sweep', profile, path:'spine', cap:true }
  const inline = { kind:'sweep', profile, path:curves.spine, cap:true }
  assert.equal(compiler.keyFor(referenced), compiler.keyFor(inline))
  const a = compiler.compile(referenced)
  const b = compiler.compile(inline)
  assert.deepEqual([...a.positions], [...b.positions])
  assert.deepEqual([...a.indices], [...b.indices])
})

test('Universal Geometry Step 5: the same named curve can drive multiple geometry definitions without becoming a renderer resource', () => {
  const curves = { rail: { kind:'line', points:[[0,0,0],[0,0,4]] } }
  const builder = createResourceGraphBuilder({ curves })
  const a = builder.addGeometry({ kind:'sweep', profile, path:'rail', cap:true })
  const b = builder.addGeometry({ kind:'sweep', profile:{ points:[[-.2,-.05],[.2,-.05],[.2,.05],[-.2,.05]] }, path:'rail', cap:true })
  assert.notEqual(a, b)
  const graph = builder.build()
  const geometries = graph.list('geometry')
  assert.equal(geometries.length, 2)
  for (const geometry of geometries) {
    assert.equal(typeof geometry.definition.path, 'object')
    assert.equal(geometry.definition.path.kind, 'line')
  }
  assert.equal(graph.list().some(node => node.kind === 'curve'), false)
})

test('Universal Geometry Step 5: path-array placement consumes reusable curve resources', () => {
  const curves = { route: { kind:'line', points:[[0,0,0],[0,0,10]] } }
  const layout = layoutPathArray({ path:'route', spacing:2.5, includeEnd:true }, { curves })
  assert.deepEqual(layout.placements.map(item => item.distance), [0,2.5,5,7.5,10])
  assert.deepEqual(layout.placements.map(item => item.position[2]), [0,2.5,5,7.5,10])
})

test('Universal Geometry Step 5: missing named curves fail cleanly before geometry compilation', () => {
  const compiler = createGeometryCompiler({ curves:{} })
  assert.throws(
    () => compiler.compile({ kind:'sweep', profile, path:'missing', cap:true }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'CURVE_INVALID' && /missing/.test(error.issues[0].message),
  )
})

test('Universal Geometry Step 5: World 0.9 accepts named curve resources and rejects unknown sweep references', () => {
  const valid = {
    version:'0.9',
    curves:{ trunk:{ kind:'helix', radius:.5, height:3, turns:1.5, segments:24 } },
    geometries:{ coil:{ kind:'sweep', profile, path:'trunk', cap:true } },
    entities:[{ id:'coil', type:'geometry', geometry:'coil' }],
  }
  assert.equal(inspectWorldDocument(valid, { mode:'strict' }).valid, true)
  const invalid = structuredClone(valid)
  invalid.geometries.coil.path = 'unknown'
  const result = inspectWorldDocument(invalid, { mode:'strict' })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(entry => entry.code === 'ANYO_CURVE_NOT_FOUND'))
})


test('Universal Geometry Step 5: native object imports namespace reusable curves and rewrite local sweep references', async () => {
  const object = {
    kind:'anyo-object', version:'0.1',
    curves:{ spine:{ kind:'arc', center:[0,0,0], radius:2, startAngle:0, endAngle:Math.PI, segments:12 } },
    geometries:{ tube:{ kind:'sweep', profile, path:'spine', cap:true } },
    root:{ children:[{ id:'tube', type:'geometry', geometry:'tube' }] },
  }
  const world = { version:'0.9', imports:{ part:{ src:'./part.anyo.json' } }, entities:[{ id:'part', composition:'part' }] }
  const resolved = await resolveWorldDocumentImports(world, {
    sourceContext:{ documentUrl:'https://example.test/world.anyo.json', baseUrl:'https://example.test/' },
    documentLoader: async request => {
      assert.equal(request.url, 'https://example.test/part.anyo.json')
      return { document: structuredClone(object), documentUrl: request.url }
    },
  })
  const instantiated = instantiateResolvedWorldDocument(resolved)
  assert.ok(instantiated.curves['part::curve::spine'])
  assert.equal(instantiated.geometries['part::geometry::tube'].path, 'part::curve::spine')
  assert.equal(inspectWorldDocument(instantiated, { mode:'strict' }).valid, true)
})
