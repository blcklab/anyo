import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  GeometryValidationError,
  compileGeometry,
  createGeometryCompiler,
} from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'

function bytes(view) { return Buffer.from(view.buffer, view.byteOffset, view.byteLength) }
function healthy(mesh) {
  assert.ok(mesh.positions instanceof Float32Array)
  assert.ok(mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array)
  const vertexCount = mesh.positions.length / 3
  for (const value of mesh.positions) assert.ok(Number.isFinite(value))
  for (const index of mesh.indices) assert.ok(index < vertexCount)
  assert.ok(mesh.normals instanceof Float32Array)
  assert.equal(mesh.normals.length, mesh.positions.length)
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])
    assert.ok(Math.abs(length - 1) < 3e-5, `normal ${i / 3} length=${length}`)
  }
  for (const value of [...mesh.bounds.min, ...mesh.bounds.max]) assert.ok(Number.isFinite(value))
  assert.ok(Number.isFinite(mesh.bounds.sphere.radius))
}

const cloudLike = {
  kind: 'noise',
  source: { kind: 'sphere', radius: 4, segments: 32, rings: 16, tangents: true },
  seed: 9182,
  frequency: 0.45,
  strength: 0.65,
  octaves: 4,
  lacunarity: 2,
  persistence: 0.5,
  offset: [0, 0, 0],
}

test('S16 registers noise as a generic geometry modifier', () => {
  assert.ok(BUILTIN_GEOMETRY_KIND_NAMES.includes('noise'))
  assert.ok(!BUILTIN_GEOMETRY_KIND_NAMES.includes('cloud'))
  assert.ok(!BUILTIN_GEOMETRY_KIND_NAMES.includes('rock'))
})

test('S16 same normalized definition and seed reproduce byte-identical geometry', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const a = compiler.compile(cloudLike)
  const b = compiler.compile(cloudLike)
  assert.deepEqual(bytes(a.positions), bytes(b.positions))
  assert.deepEqual(bytes(a.indices), bytes(b.indices))
  assert.deepEqual(bytes(a.normals), bytes(b.normals))
  assert.equal(compiler.keyFor(cloudLike), compiler.keyFor({ ...cloudLike }))
})

test('S16 different seeds change both geometry identity and deformed positions', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const a = compiler.compile({ ...cloudLike, seed: 1001 })
  const b = compiler.compile({ ...cloudLike, seed: 1002 })
  assert.notEqual(compiler.keyFor({ ...cloudLike, seed: 1001 }), compiler.keyFor({ ...cloudLike, seed: 1002 }))
  assert.notDeepEqual(bytes(a.positions), bytes(b.positions))
})

test('S16 deformed meshes retain finite topology, repaired normals, UVs, tangents, groups, and updated bounds', () => {
  const source = compileGeometry(cloudLike.source)
  const mesh = compileGeometry(cloudLike)
  healthy(mesh)
  assert.equal(mesh.indices.length, source.indices.length)
  assert.ok(mesh.uvs instanceof Float32Array)
  assert.ok(mesh.tangents instanceof Float32Array)
  assert.equal(mesh.tangents.length, (mesh.positions.length / 3) * 4)
  assert.deepEqual(mesh.groups, source.groups)
  assert.notDeepEqual(mesh.bounds, source.bounds)
})

test('S16 normalization resolves defaults before hashing and offset participates in identity', () => {
  const compiler = createGeometryCompiler()
  const implicit = { kind: 'noise', source: { kind: 'sphere', radius: 2 } }
  const explicit = {
    kind: 'noise', source: { kind: 'sphere', radius: 2, segments: 24, rings: 12 },
    seed: 0, frequency: 1, strength: 0.1, octaves: 1, lacunarity: 2, persistence: 0.5, offset: [0, 0, 0],
  }
  assert.equal(compiler.keyFor(implicit), compiler.keyFor(explicit))
  assert.notEqual(compiler.keyFor(explicit), compiler.keyFor({ ...explicit, offset: [0.25, 0, 0] }))
})

test('S16 ResourceGraph records wrapped source geometry as an explicit dependency', () => {
  const builder = createResourceGraphBuilder()
  const noiseId = builder.addGeometry(cloudLike)
  const graph = builder.build()
  const node = graph.get(noiseId)
  assert.equal(node.kind, 'geometry')
  assert.equal(node.dependencies.length, 1)
  const source = graph.get(node.dependencies[0])
  assert.equal(source.kind, 'geometry')
  assert.equal(source.definition.kind, 'sphere')
  assert.ok(graph.dependentsOf(source.id).includes(noiseId))
})

test('S16 bounds nested noise through the existing modifier depth safety contract', () => {
  const compiler = createGeometryCompiler({ limits: { maxModifierDepth: 2 } })
  const valid = { kind: 'noise', source: { kind: 'noise', source: { kind: 'sphere' } } }
  healthy(compiler.compile(valid))
  const tooDeep = { kind: 'noise', source: { kind: 'noise', source: { kind: 'noise', source: { kind: 'sphere' } } } }
  assert.throws(
    () => compiler.compile(tooDeep),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MODIFIER_LIMIT'),
  )
})

test('S16 rejects unsafe/non-deterministic noise parameters with structured errors', () => {
  for (const definition of [
    { ...cloudLike, frequency: 0 },
    { ...cloudLike, strength: -1 },
    { ...cloudLike, octaves: 17 },
    { ...cloudLike, persistence: 1.1 },
    { ...cloudLike, seed: 2 ** 40 },
    { ...cloudLike, offset: [0, Number.NaN, 0] },
  ]) {
    assert.throws(() => compileGeometry(definition), error => error instanceof GeometryValidationError && ['GEOMETRY_PARAMETER_INVALID','GEOMETRY_NON_FINITE_NUMBER'].includes(error.issues[0].code))
  }
})
