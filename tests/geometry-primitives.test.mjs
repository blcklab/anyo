import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  GeometryValidationError,
  compileGeometry,
  createGeometryCompiler,
  hashGeometryDefinition,
} from '../dist/esm/geometry/index.js'

function triangleNormal(mesh, offset) {
  const ia = mesh.indices[offset] * 3, ib = mesh.indices[offset + 1] * 3, ic = mesh.indices[offset + 2] * 3
  const ax = mesh.positions[ia], ay = mesh.positions[ia + 1], az = mesh.positions[ia + 2]
  const bx = mesh.positions[ib], by = mesh.positions[ib + 1], bz = mesh.positions[ib + 2]
  const cx = mesh.positions[ic], cy = mesh.positions[ic + 1], cz = mesh.positions[ic + 2]
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx]
}

function assertMeshHealthy(mesh, { allowZeroArea = false } = {}) {
  assert.ok(mesh.positions instanceof Float32Array)
  assert.ok(mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array)
  const vertexCount = mesh.positions.length / 3
  for (const value of mesh.positions) assert.ok(Number.isFinite(value))
  for (const index of mesh.indices) assert.ok(index < vertexCount)
  if (mesh.normals) {
    assert.equal(mesh.normals.length, mesh.positions.length)
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])
      assert.ok(Math.abs(length - 1) < 2e-5, `normal ${i / 3} length=${length}`)
    }
  }
  if (mesh.uvs) assert.equal(mesh.uvs.length, vertexCount * 2)
  if (!allowZeroArea) for (let i = 0; i < mesh.indices.length; i += 3) {
    const n = triangleNormal(mesh, i)
    const area2 = Math.hypot(...n)
    assert.ok(area2 > 1e-9, `triangle ${i / 3} has zero area`)
  }
}

test('S2 precision primitives remain registered while S4 extrusion, S5 sweep, and S6 mesh modifiers are additive', () => {
  assert.deepEqual(BUILTIN_GEOMETRY_KIND_NAMES, ['box', 'roundedBox', 'plane', 'sphere', 'cylinder', 'cone', 'capsule', 'disc', 'torus', 'polygon', 'lathe', 'extrude', 'sweep', 'transform', 'mirror', 'noise', 'bend', 'twist', 'taper', 'union', 'subtract', 'intersect'])
})

test('S2 quality presets resolve before cache hashing and explicit values win', () => {
  const compiler = createGeometryCompiler()
  const high = { kind: 'sphere', quality: 'high', radius: 2 }
  const explicit = { kind: 'sphere', radius: 2, segments: 32, rings: 16 }
  assert.deepEqual(compiler.normalize(high), compiler.normalize(explicit))
  assert.equal(compiler.keyFor(high), compiler.keyFor(explicit))
  assert.equal(hashGeometryDefinition(compiler.normalize(high)), hashGeometryDefinition(compiler.normalize(explicit)))
  const override = compiler.normalize({ kind: 'sphere', quality: 'low', segments: 40, rings: 20 })
  assert.equal(override.segments, 40)
  assert.equal(override.rings, 20)
  assert.equal('quality' in override, false)
})

test('box is centered, exact, CCW and independently faceted', () => {
  const mesh = compileGeometry({ kind: 'box', size: [2, 4, 6] })
  assertMeshHealthy(mesh)
  assert.equal(mesh.positions.length / 3, 24)
  assert.equal(mesh.indices.length, 36)
  assert.deepEqual(mesh.bounds.min, [-1, -2, -3])
  assert.deepEqual(mesh.bounds.max, [1, 2, 3])
  assert.ok(triangleNormal(mesh, 0)[2] > 0)
})

test('roundedBox produces curved edge normals while preserving requested bounds', () => {
  const mesh = compileGeometry({ kind: 'roundedBox', size: [4, 2, 1], radius: 0.2, segments: 4 })
  assertMeshHealthy(mesh)
  assert.deepEqual(mesh.bounds.min, [-2, -1, -0.5])
  assert.deepEqual(mesh.bounds.max, [2, 1, 0.5])
  let roundedNormal = false
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const components = [Math.abs(mesh.normals[i]), Math.abs(mesh.normals[i + 1]), Math.abs(mesh.normals[i + 2])]
    if (components.filter(value => value > 1e-4).length >= 2) roundedNormal = true
  }
  assert.equal(roundedNormal, true)
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const n = triangleNormal(mesh, i)
    const ia = mesh.indices[i] * 3
    const normal = [mesh.normals[ia], mesh.normals[ia + 1], mesh.normals[ia + 2]]
    assert.ok(n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] >= -1e-8)
  }
})

test('roundedBox clamps radius deterministically to half the smallest dimension', () => {
  const compiler = createGeometryCompiler()
  const normalized = compiler.normalize({ kind: 'roundedBox', size: [4, 2, 1], radius: 99, segments: 2 })
  assert.equal(normalized.radius, 0.5)
  assertMeshHealthy(compiler.compile(normalized))
})

test('plane and disc preserve existing XY/+Z facing semantics', () => {
  const plane = compileGeometry({ kind: 'plane', size: [4, 2] })
  const disc = compileGeometry({ kind: 'disc', radius: 2, segments: 12 })
  assertMeshHealthy(plane); assertMeshHealthy(disc)
  assert.deepEqual(plane.bounds.min, [-2, -1, 0])
  assert.deepEqual(plane.bounds.max, [2, 1, 0])
  assert.ok(triangleNormal(plane, 0)[2] > 0)
  assert.ok(triangleNormal(disc, 0)[2] > 0)
})

test('sphere is Y-up with exact radius bounds and outward winding', () => {
  const mesh = compileGeometry({ kind: 'sphere', radius: 2, segments: 24, rings: 12 })
  assertMeshHealthy(mesh)
  assert.ok(Math.abs(mesh.bounds.min[1] + 2) < 1e-6)
  assert.ok(Math.abs(mesh.bounds.max[1] - 2) < 1e-6)
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const n = triangleNormal(mesh, i)
    const ia = mesh.indices[i] * 3
    const dot = n[0] * mesh.positions[ia] + n[1] * mesh.positions[ia + 1] + n[2] * mesh.positions[ia + 2]
    assert.ok(dot > -1e-7, `sphere triangle ${i / 3} winding is inward`)
  }
})

test('cylinder and cone are Y-up, capped and respect deterministic segments', () => {
  const cylinder = compileGeometry({ kind: 'cylinder', radius: 1.5, height: 4, segments: 16, cap: true })
  const cone = compileGeometry({ kind: 'cone', radius: 1.5, height: 4, segments: 16, cap: true })
  assertMeshHealthy(cylinder); assertMeshHealthy(cone)
  assert.ok(Math.abs(cylinder.bounds.min[1] + 2) < 1e-6 && Math.abs(cylinder.bounds.max[1] - 2) < 1e-6)
  assert.ok(Math.abs(cone.bounds.min[1] + 2) < 1e-6 && Math.abs(cone.bounds.max[1] - 2) < 1e-6)
})

test('capsule uses total height and degenerates cleanly to a sphere-like capsule at height=diameter', () => {
  for (const height of [1, 3]) {
    const mesh = compileGeometry({ kind: 'capsule', radius: 0.5, height, segments: 20, rings: 6 })
    assertMeshHealthy(mesh)
    assert.ok(Math.abs(mesh.bounds.min[1] + height / 2) < 1e-6)
    assert.ok(Math.abs(mesh.bounds.max[1] - height / 2) < 1e-6)
  }
})

test('torus is Y-up with stable major/tube dimensions', () => {
  const mesh = compileGeometry({ kind: 'torus', radius: 2, tubeRadius: 0.25, segments: 24, tubeSegments: 12 })
  assertMeshHealthy(mesh)
  assert.ok(Math.abs(mesh.bounds.max[0] - 2.25) < 1e-5)
  assert.ok(Math.abs(mesh.bounds.max[1] - 0.25) < 1e-5)
})

test('polygon canonicalizes winding/duplicate closure and triangulates a concave simple profile', () => {
  const compiler = createGeometryCompiler()
  const cwClosed = { kind: 'polygon', points: [[0,0], [0,2], [1,1], [2,2], [2,0], [0,0]] }
  const ccwOpen = { kind: 'polygon', points: [[0,0], [2,0], [2,2], [1,1], [0,2]] }
  assert.deepEqual(compiler.normalize(cwClosed), compiler.normalize(ccwOpen))
  const mesh = compiler.compile(cwClosed)
  assertMeshHealthy(mesh)
  assert.equal(mesh.indices.length, (5 - 2) * 3)
  for (let i = 0; i < mesh.indices.length; i += 3) assert.ok(triangleNormal(mesh, i)[2] > 0)
})

test('invalid primitive parameters fail with structured geometry errors', () => {
  const invalid = [
    { kind: 'box', size: [1, 0, 1] },
    { kind: 'sphere', radius: -1 },
    { kind: 'disc', segments: 2 },
    { kind: 'capsule', radius: 1, height: 1 },
    { kind: 'polygon', points: [[0,0], [1,1], [0,1], [1,0]] },
  ]
  for (const definition of invalid) {
    assert.throws(() => compileGeometry(definition), error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_PARAMETER_INVALID'))
  }
})
