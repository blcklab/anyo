import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GeometryValidationError,
  compileGeometry,
  createGeometryCompiler,
  normalizeProfile,
  triangulateProfile,
} from '../dist/esm/geometry/index.js'

function triangleNormal(mesh, offset) {
  const ia = mesh.indices[offset] * 3, ib = mesh.indices[offset + 1] * 3, ic = mesh.indices[offset + 2] * 3
  const ax = mesh.positions[ia], ay = mesh.positions[ia + 1], az = mesh.positions[ia + 2]
  const bx = mesh.positions[ib], by = mesh.positions[ib + 1], bz = mesh.positions[ib + 2]
  const cx = mesh.positions[ic], cy = mesh.positions[ic + 1], cz = mesh.positions[ic + 2]
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx]
}

function assertMeshHealthy(mesh) {
  assert.ok(mesh.positions instanceof Float32Array)
  assert.ok(mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array)
  assert.equal(mesh.positions.length % 3, 0)
  assert.equal(mesh.indices.length % 3, 0)
  const vertexCount = mesh.positions.length / 3
  for (const value of mesh.positions) assert.ok(Number.isFinite(value))
  for (const index of mesh.indices) assert.ok(index < vertexCount)
  assert.equal(mesh.normals.length, mesh.positions.length)
  assert.equal(mesh.uvs.length, vertexCount * 2)
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    assert.ok(Math.hypot(...triangleNormal(mesh, offset)) > 1e-9, `triangle ${offset / 3} is degenerate`)
  }
}

function group(mesh, name) { return mesh.groups.find(candidate => candidate.name === name) }
function groupTriangleNormals(mesh, name) {
  const entry = group(mesh, name)
  assert.ok(entry, `missing group ${name}`)
  const normals = []
  for (let offset = entry.start; offset < entry.start + entry.count; offset += 3) normals.push(triangleNormal(mesh, offset))
  return normals
}

const rectangle = [[0, 0], [6, 0], [6, 3], [0, 3]]
const windowHole = [[1, 0.8], [1, 2.2], [2.5, 2.2], [2.5, 0.8]]

 test('S4 profile normalization canonicalizes closure, winding, holes and collinear points', () => {
  const a = normalizeProfile({
    points: [[0,0], [0,3], [3,3], [6,3], [6,0], [0,0]],
    holes: [[[2.5,2.2], [2.5,.8], [1,.8], [1,2.2], [2.5,2.2]]],
  })
  const b = normalizeProfile({ points: rectangle, holes: [windowHole] })
  assert.deepEqual(a, b)
})

 test('S4 triangulates a concave profile with a hole deterministically', () => {
  const profile = normalizeProfile({
    points: [[0,0], [6,0], [6,4], [3.5,4], [3.5,3], [2.5,3], [2.5,4], [0,4]],
    holes: [[[1,.8], [1,2], [2,2], [2,.8]]],
  })
  const first = triangulateProfile(profile)
  const second = triangulateProfile(profile)
  assert.deepEqual(first, second)
  assert.equal(first.indices.length % 3, 0)
  for (let offset = 0; offset < first.indices.length; offset += 3) {
    const a = first.points[first.indices[offset]], b = first.points[first.indices[offset + 1]], c = first.points[first.indices[offset + 2]]
    assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) > 1e-9)
  }
})

 test('S4 basic extrusion creates front/back/outer-side regions with exact depth bounds', () => {
  const mesh = compileGeometry({ kind: 'extrude', profile: { points: rectangle }, depth: 0.2 })
  assertMeshHealthy(mesh)
  assert.ok(Math.abs(mesh.bounds.min[2] + 0.1) < 1e-6)
  assert.ok(Math.abs(mesh.bounds.max[2] - 0.1) < 1e-6)
  assert.deepEqual(mesh.groups.map(entry => entry.name), ['front', 'back', 'outerSide'])
  for (const normal of groupTriangleNormals(mesh, 'front')) assert.ok(normal[2] > 0)
  for (const normal of groupTriangleNormals(mesh, 'back')) assert.ok(normal[2] < 0)
})

 test('S4 hole extrusion creates a cavity instead of filling the opening', () => {
  const mesh = compileGeometry({ kind: 'extrude', profile: { points: rectangle, holes: [windowHole] }, depth: 0.25 })
  assertMeshHealthy(mesh)
  assert.deepEqual(mesh.groups.map(entry => entry.name), ['front', 'back', 'outerSide', 'holeSide:0'])
  assert.ok(group(mesh, 'holeSide:0').count > 0)
})

 test('S4 supports multiple holes and deterministic canonical hole order', () => {
  const left = [[1,.8], [1,2.2], [2.2,2.2], [2.2,.8]]
  const right = [[3.8,.8], [3.8,2.2], [5,2.2], [5,.8]]
  const compiler = createGeometryCompiler()
  const a = { kind: 'extrude', profile: { points: rectangle, holes: [right, left] }, depth: .2 }
  const b = { kind: 'extrude', profile: { points: rectangle, holes: [left, right] }, depth: .2 }
  assert.deepEqual(compiler.normalize(a), compiler.normalize(b))
  assert.equal(compiler.keyFor(a), compiler.keyFor(b))
  const mesh = compiler.compile(a)
  assertMeshHealthy(mesh)
  assert.deepEqual(mesh.groups.map(entry => entry.name), ['front', 'back', 'outerSide', 'holeSide:0', 'holeSide:1'])
})

 test('S4 generated UVs honor metersPerTile and S3 can regenerate normals/tangents', () => {
  const mesh = compileGeometry({
    kind: 'extrude', profile: { points: [[0,0], [4,0], [4,2], [0,2]] }, depth: 1,
    normals: { mode: 'smooth', creaseAngle: Math.PI / 4 },
    uv: { mode: 'generated', metersPerTile: 2 }, tangents: true,
  })
  assertMeshHealthy(mesh)
  assert.equal(mesh.tangents.length, (mesh.positions.length / 3) * 4)
  const us = []
  for (let index = 0; index < mesh.uvs.length; index += 2) us.push(mesh.uvs[index])
  assert.ok(Math.max(...us) >= 2 - 1e-6)
})

 test('S4 cap=false produces an open extrusion with only side regions', () => {
  const mesh = compileGeometry({ kind: 'extrude', profile: { points: rectangle, holes: [windowHole] }, depth: .5, cap: false })
  assertMeshHealthy(mesh)
  assert.deepEqual(mesh.groups.map(entry => entry.name), ['outerSide', 'holeSide:0'])
})

 test('S4 bevel adds deterministic front/back bevel regions and keeps requested outer bounds', () => {
  const mesh = compileGeometry({
    kind: 'extrude', profile: { points: [[-2,-1], [2,-1], [2,1], [-2,1]] }, depth: 1,
    bevel: { size: .1, segments: 3 },
  })
  assertMeshHealthy(mesh)
  assert.deepEqual(mesh.groups.map(entry => entry.name), ['front', 'back', 'outerSide', 'frontBevel', 'backBevel'])
  assert.deepEqual(mesh.bounds.min, [-2, -1, -0.5])
  assert.deepEqual(mesh.bounds.max, [2, 1, 0.5])
  assert.ok(group(mesh, 'frontBevel').count > 0 && group(mesh, 'backBevel').count > 0)
})

 test('S4 bevel supports holes when the offset remains valid', () => {
  const mesh = compileGeometry({
    kind: 'extrude', profile: { points: rectangle, holes: [windowHole] }, depth: .6,
    bevel: { size: .05, segments: 2 },
  })
  assertMeshHealthy(mesh)
  assert.ok(group(mesh, 'holeSide:0'))
  assert.ok(group(mesh, 'frontBevel'))
})

 test('S4 profile errors are structured and include recovery hints where applicable', () => {
  assert.throws(
    () => normalizeProfile({ points: [[0,0], [2,2], [0,2], [2,0]] }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'PROFILE_SELF_INTERSECTION' && !!error.issues[0].suggestion,
  )
  assert.throws(
    () => normalizeProfile({ points: rectangle, holes: [[[8,8], [9,8], [9,9], [8,9]]] }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'PROFILE_HOLE_OUTSIDE',
  )
})

 test('S4 rejects overlapping holes', () => {
  assert.throws(
    () => normalizeProfile({
      points: rectangle,
      holes: [
        [[1,.5], [1,2], [3,2], [3,.5]],
        [[2,1], [2,2.5], [4,2.5], [4,1]],
      ],
    }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'PROFILE_HOLE_OVERLAP',
  )
})

 test('S4 rejects bevel collapse before emitting invalid geometry', () => {
  assert.throws(
    () => compileGeometry({ kind: 'extrude', profile: { points: [[0,0], [1,0], [1,.2], [0,.2]] }, depth: 1, bevel: { size: .2, segments: 2 } }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'EXTRUSION_BEVEL_COLLAPSE'),
  )
})
