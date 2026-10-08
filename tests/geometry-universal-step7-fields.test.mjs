import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GeometryValidationError,
  createGeometryCompiler,
  normalizeScalarField,
  sampleScalarField,
} from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'
import { instantiateResolvedWorldDocument, resolveWorldDocumentImports } from '../dist/esm/index.js'

const baseMesh = { kind:'box', size:[1,1,1] }
const constant = { kind:'constant', value:0.25 }
const gradient = { kind:'gradient', origin:[0,0,0], direction:[0,2,0], scale:0.5, offset:0.1 }
const noise = { kind:'noise', seed:42, frequency:1.5, octaves:3, lacunarity:2, persistence:0.5, offset:[0.1,0.2,0.3] }

function meshArrays(mesh) {
  return {
    positions:[...mesh.positions], indices:[...mesh.indices],
    normals:mesh.normals ? [...mesh.normals] : undefined,
    uvs:mesh.uvs ? [...mesh.uvs] : undefined,
    tangents:mesh.tangents ? [...mesh.tangents] : undefined,
    groups:mesh.groups,
  }
}

test('Universal Geometry Step 7: scalar field vocabulary normalizes deterministically and samples expected math', () => {
  assert.equal(sampleScalarField(constant, [10,20,30]), 0.25)
  assert.equal(sampleScalarField(gradient, [0,2,0]), 1.1)
  assert.equal(sampleScalarField({ kind:'distance', point:[0,0,0], scale:2, offset:-1 }, [0,0,2]), 3)
  assert.equal(sampleScalarField({ kind:'radial', center:[0,0,0], radius:2 }, [0,0,0]), 1)
  assert.equal(sampleScalarField({ kind:'radial', center:[0,0,0], radius:2 }, [2,0,0]), 0)
  assert.equal(sampleScalarField({ kind:'clamp', field:{ kind:'add', fields:[constant, constant] }, min:0, max:0.4 }, [0,0,0]), 0.4)
  assert.equal(sampleScalarField({ kind:'invert', field:constant }, [0,0,0]), 0.75)
  const a = sampleScalarField(noise, [1.2,-0.4,3.5])
  const b = sampleScalarField(structuredClone(noise), [1.2,-0.4,3.5])
  assert.equal(a, b)
  assert.ok(a >= -1 && a <= 1)
  assert.deepEqual(normalizeScalarField(gradient).direction, [0,1,0])
})

test('Universal Geometry Step 7: named and inline fields are identity/output-equivalent through generic displacement', () => {
  const fields = { terrain: { kind:'add', fields:[noise, { kind:'gradient', direction:[0,1,0], scale:0.2 }] } }
  const compiler = createGeometryCompiler({ fields })
  const named = { kind:'pipeline', source:baseMesh, modifiers:[{ kind:'displace', field:'terrain', strength:0.15, direction:'normal' }] }
  const inline = { kind:'pipeline', source:baseMesh, modifiers:[{ kind:'displace', field:fields.terrain, strength:0.15, direction:'normal' }] }
  assert.equal(compiler.keyFor(named), compiler.keyFor(inline))
  assert.deepEqual(meshArrays(compiler.compile(named)), meshArrays(compiler.compile(inline)))
  assert.equal(typeof compiler.normalize(named).modifiers[0].field, 'object')
})

test('Universal Geometry Step 7: field displacement supports axis direction and preserves deterministic operator ordering', () => {
  const compiler = createGeometryCompiler()
  const y = { kind:'pipeline', source:baseMesh, modifiers:[{ kind:'displace', field:{ kind:'constant', value:1 }, strength:0.25, direction:'y' }] }
  const x = { kind:'pipeline', source:baseMesh, modifiers:[{ kind:'displace', field:{ kind:'constant', value:1 }, strength:0.25, direction:'x' }] }
  const ym = compiler.compile(y)
  const xm = compiler.compile(x)
  assert.notDeepEqual([...ym.positions], [...xm.positions])
  assert.notEqual(compiler.keyFor(y), compiler.keyFor(x))
})

test('Universal Geometry Step 7: missing and cyclic field references fail cleanly before mesh execution', () => {
  assert.throws(() => normalizeScalarField('missing', { fields:{ a:constant } }), GeometryValidationError)
  const fields = { a:{ kind:'invert', field:'b' }, b:{ kind:'clamp', field:'a', min:0, max:1 } }
  assert.throws(
    () => normalizeScalarField('a', { fields }),
    error => error instanceof GeometryValidationError && /cycle/i.test(error.issues[0].message),
  )
})

test('Universal Geometry Step 7: equivalent named fields deduplicate geometry and never become renderer resources', () => {
  const fields = { a:noise, b:structuredClone(noise) }
  const builder = createResourceGraphBuilder({ fields })
  const a = builder.addGeometry({ kind:'pipeline', source:baseMesh, modifiers:[{ kind:'displace', field:'a', strength:0.1 }] })
  const b = builder.addGeometry({ kind:'pipeline', source:baseMesh, modifiers:[{ kind:'displace', field:'b', strength:0.1 }] })
  assert.equal(a, b)
  const graph = builder.build()
  assert.equal(graph.list('geometry').length, 2) // pipeline + canonical source
  assert.equal(graph.list().some(node => node.kind === 'field'), false)
  const pipeline = graph.list('geometry').find(node => node.definition.kind === 'pipeline')
  assert.equal(typeof pipeline.definition.modifiers[0].field, 'object')
})

test('Universal Geometry Step 7: World 0.9 accepts reusable fields and reports unknown field references semantically', () => {
  const valid = {
    version:'0.9',
    fields:{ displacement:{ kind:'multiply', fields:[noise, { kind:'radial', radius:2 }] } },
    geometries:{ shape:{ kind:'pipeline', source:baseMesh, modifiers:[{ kind:'displace', field:'displacement', strength:0.1 }] } },
    entities:[{ id:'shape', type:'geometry', geometry:'shape' }],
  }
  const good = inspectWorldDocument(valid, { mode:'strict' })
  assert.equal(good.valid, true, good.errors.map(entry => `${entry.code}: ${entry.message}`).join('\n'))
  const invalid = structuredClone(valid)
  invalid.geometries.shape.modifiers[0].field = 'missing'
  const bad = inspectWorldDocument(invalid, { mode:'strict' })
  assert.equal(bad.valid, false)
  assert.ok(bad.errors.some(entry => entry.code === 'ANYO_FIELD_NOT_FOUND'))
})

test('Universal Geometry Step 7: strict validation rejects malformed fields and field cycles', () => {
  const malformed = [
    { version:'0.9', fields:{ bad:{ kind:'radial', radius:0 } }, entities:[] },
    { version:'0.9', fields:{ bad:{ kind:'noise', octaves:17 } }, entities:[] },
    { version:'0.9', fields:{ a:{ kind:'invert', field:'b' }, b:{ kind:'invert', field:'a' } }, entities:[] },
  ]
  for (const world of malformed) assert.equal(inspectWorldDocument(world, { mode:'strict' }).valid, false)
})

test('Universal Geometry Step 7: native object imports namespace fields and rewrite nested field references plus displace use-sites', async () => {
  const object = {
    kind:'anyo-object', version:'0.1',
    fields:{
      base:noise,
      mask:{ kind:'radial', center:[0,0,0], radius:2 },
      combined:{ kind:'multiply', fields:['base','mask'] },
      final:{ kind:'clamp', field:'combined', min:-0.5, max:0.5 },
    },
    geometries:{ shape:{ kind:'pipeline', source:baseMesh, modifiers:[{ kind:'displace', field:'final', strength:0.2 }] } },
    root:{ children:[{ id:'shape', type:'geometry', geometry:'shape' }] },
  }
  const world = { version:'0.9', imports:{ part:{ src:'./part.anyo.json' } }, entities:[{ id:'part', composition:'part' }] }
  const resolved = await resolveWorldDocumentImports(world, {
    sourceContext:{ documentUrl:'https://example.test/world.anyo.json', baseUrl:'https://example.test/' },
    documentLoader:async request => ({ document:structuredClone(object), documentUrl:request.url }),
  })
  const instantiated = instantiateResolvedWorldDocument(resolved)
  assert.ok(instantiated.fields['part::field::base'])
  assert.equal(instantiated.fields['part::field::combined'].fields[0], 'part::field::base')
  assert.equal(instantiated.fields['part::field::combined'].fields[1], 'part::field::mask')
  assert.equal(instantiated.fields['part::field::final'].field, 'part::field::combined')
  assert.equal(instantiated.geometries['part::geometry::shape'].modifiers[0].field, 'part::field::final')
  assert.equal(inspectWorldDocument(instantiated, { mode:'strict' }).valid, true)
})
