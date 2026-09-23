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
  assert.ok(mesh.indices.length > 0 && mesh.indices.length % 3 === 0)
  const count = mesh.positions.length / 3
  for (const value of mesh.positions) assert.ok(Number.isFinite(value))
  for (const index of mesh.indices) assert.ok(index < count)
  assert.ok(mesh.normals instanceof Float32Array)
  assert.equal(mesh.normals.length, mesh.positions.length)
  for (let offset = 0; offset < mesh.normals.length; offset += 3) {
    const length = Math.hypot(mesh.normals[offset], mesh.normals[offset + 1], mesh.normals[offset + 2])
    assert.ok(Math.abs(length - 1) < 5e-5, `normal ${offset / 3} length=${length}`)
  }
  for (const value of [...mesh.bounds.min, ...mesh.bounds.max]) assert.ok(Number.isFinite(value))
}

const vaseProfile = [[0.2, 0], [0.65, 0.25], [0.5, 1.4], [0.18, 2]]

test('S17 registers lathe/revolve plus bend twist and taper as generic geometry operations', () => {
  for (const kind of ['lathe', 'bend', 'twist', 'taper']) assert.ok(BUILTIN_GEOMETRY_KIND_NAMES.includes(kind))
  for (const forbidden of ['vase', 'lamp', 'cloud', 'rock']) assert.ok(!BUILTIN_GEOMETRY_KIND_NAMES.includes(forbidden))
})

test('S17 lathe deterministically revolves an ordered radius/height profile with semantic groups', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const definition = { kind: 'lathe', profile: vaseProfile, segments: 32, cap: true, tangents: true }
  const a = compiler.compile(definition)
  const b = compiler.compile(definition)
  healthy(a)
  assert.deepEqual(bytes(a.positions), bytes(b.positions))
  assert.deepEqual(bytes(a.indices), bytes(b.indices))
  assert.ok(a.uvs instanceof Float32Array)
  assert.ok(a.tangents instanceof Float32Array)
  assert.deepEqual(a.groups.map(group => group.name), ['surface', 'startCap', 'endCap'])
  assert.ok(Math.abs(a.bounds.min[0] + 0.65) < 1e-5)
  assert.ok(Math.abs(a.bounds.max[0] - 0.65) < 1e-5)
  assert.equal(a.bounds.min[1], 0)
  assert.equal(a.bounds.max[1], 2)
})


test('S17 lathe triangle winding agrees with authored outward normals and geometry safety limits still apply', () => {
  const mesh = compileGeometry({ kind: 'lathe', profile: [[0.4, 0], [0.7, 0.6], [0.5, 1.4]], segments: 16, cap: true })
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const ia = mesh.indices[offset], ib = mesh.indices[offset + 1], ic = mesh.indices[offset + 2]
    const point = index => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]]
    const a = point(ia), b = point(ib), c = point(ic)
    const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]]
    const face = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]]
    const authored = [mesh.normals[ia * 3], mesh.normals[ia * 3 + 1], mesh.normals[ia * 3 + 2]]
    assert.ok(face[0] * authored[0] + face[1] * authored[1] + face[2] * authored[2] > 0, `triangle ${offset / 3} must remain CCW/outward`)
  }
  const limited = createGeometryCompiler({ limits: { maxGeometryVertices: 100 } })
  assert.throws(
    () => limited.compile({ kind: 'lathe', profile: Array.from({ length: 8 }, (_, i) => [0.5 + i * 0.01, i * 0.2]), segments: 24 }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MESH_LIMIT'),
  )
})

test('S17 lathe normalization resolves quality segments and validates monotonic safe profiles', () => {
  const compiler = createGeometryCompiler()
  const implicit = { kind: 'lathe', profile: [[0.5, 0], [0.5, 1]] }
  const explicit = { kind: 'lathe', profile: [[0.5, 0], [0.5, 1]], segments: 24, cap: true }
  assert.equal(compiler.keyFor(implicit), compiler.keyFor(explicit))
  for (const bad of [
    { kind: 'lathe', profile: [[0.5, 0]] },
    { kind: 'lathe', profile: [[-0.1, 0], [0.5, 1]] },
    { kind: 'lathe', profile: [[0.5, 1], [0.6, 0]] },
    { kind: 'lathe', profile: [[0, 0], [0, 1]] },
  ]) {
    assert.throws(() => compileGeometry(bad), error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_PARAMETER_INVALID'))
  }
})

test('S17 twist rotates cross-sections along source bounds while keeping topology and surface data valid', () => {
  const source = compileGeometry({ kind: 'box', size: [2, 4, 1], tangents: true })
  const twisted = compileGeometry({ kind: 'twist', source: { kind: 'box', size: [2, 4, 1], tangents: true }, axis: 'y', angle: Math.PI })
  healthy(twisted)
  assert.equal(twisted.indices.length, source.indices.length)
  assert.ok(twisted.uvs instanceof Float32Array)
  assert.ok(twisted.tangents instanceof Float32Array)
  assert.deepEqual(twisted.groups?.map(group => group.name), source.groups?.map(group => group.name))
  assert.notDeepEqual(bytes(twisted.positions), bytes(source.positions))
})

test('S17 taper scales perpendicular cross-sections predictably without changing topology', () => {
  const tapered = compileGeometry({ kind: 'taper', source: { kind: 'box', size: [2, 4, 2] }, axis: 'y', startScale: 1, endScale: 0.25 })
  healthy(tapered)
  assert.ok(tapered.bounds.max[0] <= 1 + 1e-6)
  assert.ok(tapered.bounds.min[0] >= -1 - 1e-6)
  const ys = []
  for (let i = 1; i < tapered.positions.length; i += 3) ys.push(tapered.positions[i])
  assert.equal(Math.min(...ys), -2)
  assert.equal(Math.max(...ys), 2)
})

test('S17 bend curves a longitudinal axis while preserving finite relative cross-section geometry', () => {
  const source = compileGeometry({ kind: 'box', size: [1, 6, 1] })
  const bent = compileGeometry({ kind: 'bend', source: { kind: 'box', size: [1, 6, 1] }, axis: 'y', direction: 'x', angle: Math.PI / 2 })
  healthy(bent)
  assert.equal(bent.indices.length, source.indices.length)
  assert.notDeepEqual(bytes(bent.positions), bytes(source.positions))
  assert.ok(bent.bounds.max[0] > source.bounds.max[0], 'positive bend should move the centerline toward +x')
})

test('S17 deformation definitions normalize before hashing and source resources remain explicit DAG dependencies', () => {
  const compiler = createGeometryCompiler()
  const source = { kind: 'lathe', profile: [[0.4, 0], [0.7, 0.5], [0.3, 2]] }
  assert.equal(
    compiler.keyFor({ kind: 'twist', source, angle: Math.PI }),
    compiler.keyFor({ kind: 'twist', source: { ...source, segments: 24, cap: true }, axis: 'y', angle: Math.PI }),
  )
  const builder = createResourceGraphBuilder()
  const id = builder.addGeometry({ kind: 'bend', source: { kind: 'twist', source, angle: 0.5 }, angle: 0.4 })
  const graph = builder.build()
  const bend = graph.get(id)
  assert.equal(bend.dependencies.length, 1)
  const twist = graph.get(bend.dependencies[0])
  assert.equal(twist.definition.kind, 'twist')
  assert.equal(twist.dependencies.length, 1)
  const lathe = graph.get(twist.dependencies[0])
  assert.equal(lathe.definition.kind, 'lathe')
})

test('S17 deformation modifiers reuse maxModifierDepth and reject unsafe axes/scales', () => {
  const compiler = createGeometryCompiler({ limits: { maxModifierDepth: 2 } })
  healthy(compiler.compile({ kind: 'bend', source: { kind: 'twist', source: { kind: 'box', size: [1, 2, 1] }, angle: 0.2 }, angle: 0.2 }))
  assert.throws(
    () => compiler.compile({ kind: 'taper', source: { kind: 'bend', source: { kind: 'twist', source: { kind: 'box' }, angle: 0.2 }, angle: 0.2 }, endScale: 0.5 }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MODIFIER_LIMIT'),
  )
  for (const bad of [
    { kind: 'bend', source: { kind: 'box' }, axis: 'y', direction: 'y', angle: 1 },
    { kind: 'taper', source: { kind: 'box' }, startScale: 0, endScale: 0 },
    { kind: 'twist', source: { kind: 'plane', size: [2, 2] }, axis: 'z', angle: 1 },
  ]) assert.throws(() => compileGeometry(bad), error => error instanceof GeometryValidationError)
})
