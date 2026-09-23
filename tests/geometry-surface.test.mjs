import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GeometryValidationError,
  compileGeometry,
  createGeometryCompiler,
  generateTangents,
} from '../dist/esm/geometry/index.js'

function approx(actual, expected, epsilon = 1e-5, message = '') {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message} expected ${expected}, got ${actual}`)
}

function faceUnitNormal(mesh, offset) {
  const ia = mesh.indices[offset] * 3, ib = mesh.indices[offset + 1] * 3, ic = mesh.indices[offset + 2] * 3
  const ax = mesh.positions[ia], ay = mesh.positions[ia + 1], az = mesh.positions[ia + 2]
  const bx = mesh.positions[ib], by = mesh.positions[ib + 1], bz = mesh.positions[ib + 2]
  const cx = mesh.positions[ic], cy = mesh.positions[ic + 1], cz = mesh.positions[ic + 2]
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
  const length = Math.hypot(nx, ny, nz)
  nx /= length; ny /= length; nz /= length
  return [nx, ny, nz]
}

function uvSpan(mesh) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    minU = Math.min(minU, mesh.uvs[i]); maxU = Math.max(maxU, mesh.uvs[i])
    minV = Math.min(minV, mesh.uvs[i + 1]); maxV = Math.max(maxV, mesh.uvs[i + 1])
  }
  return [maxU - minU, maxV - minV]
}

function assertGroupsCoverMesh(mesh) {
  assert.ok(mesh.groups?.length > 0)
  let cursor = 0
  for (const group of mesh.groups) {
    assert.equal(group.start, cursor)
    assert.equal(group.materialIndex, 0)
    assert.equal(group.start % 3, 0)
    assert.equal(group.count % 3, 0)
    cursor += group.count
  }
  assert.equal(cursor, mesh.indices.length)
}

test('S3 normalizes surface policy before hashing and strips disabled tangents', () => {
  const compiler = createGeometryCompiler()
  const implicit = compiler.normalize({ kind: 'plane', tangents: false, normals: { mode: 'smooth' }, uv: { mode: 'planar' } })
  const explicit = compiler.normalize({
    kind: 'plane',
    normals: { mode: 'smooth', creaseAngle: Math.PI },
    uv: { mode: 'planar', axis: 'auto', scale: [1, 1], rotation: 0, offset: [0, 0] },
  })
  assert.equal('tangents' in implicit, false)
  assert.equal(JSON.stringify(implicit), JSON.stringify(explicit))
  assert.equal(compiler.keyFor(implicit), compiler.keyFor(explicit))
})

test('S3 flat normals match triangle faces and preserve valid indexed topology', () => {
  const mesh = compileGeometry({ kind: 'sphere', radius: 1, segments: 12, rings: 6, normals: { mode: 'flat' } })
  assert.equal(mesh.normals.length, mesh.positions.length)
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const expected = faceUnitNormal(mesh, offset)
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[offset + corner]
      const normal = [mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2]]
      const dot = normal[0] * expected[0] + normal[1] * expected[1] + normal[2] * expected[2]
      assert.ok(dot > 0.99999)
    }
  }
})

test('S3 crease angle preserves hard box edges or smooths shared corners deterministically', () => {
  const hard = compileGeometry({ kind: 'box', normals: { mode: 'smooth', creaseAngle: Math.PI / 4 } })
  const smooth = compileGeometry({ kind: 'box', normals: { mode: 'smooth', creaseAngle: Math.PI } })

  for (let i = 0; i < hard.normals.length; i += 3) {
    const components = [Math.abs(hard.normals[i]), Math.abs(hard.normals[i + 1]), Math.abs(hard.normals[i + 2])]
    assert.equal(components.filter(value => value > 1e-5).length, 1)
  }

  let foundRoundedCornerNormal = false
  for (let i = 0; i < smooth.normals.length; i += 3) {
    const components = [Math.abs(smooth.normals[i]), Math.abs(smooth.normals[i + 1]), Math.abs(smooth.normals[i + 2])]
    if (components.filter(value => value > 0.2).length === 3) foundRoundedCornerNormal = true
  }
  assert.equal(foundRoundedCornerNormal, true)
})

test('S3 planar UVs support real-world meters-per-tile density', () => {
  const mesh = compileGeometry({ kind: 'plane', size: [4, 2], uv: { mode: 'planar', axis: 'xy', metersPerTile: 2 } })
  const [spanU, spanV] = uvSpan(mesh)
  approx(spanU, 2, 1e-6, 'u span')
  approx(spanV, 1, 1e-6, 'v span')
})

test('S3 box UV projection produces face-local seams without invalid attributes', () => {
  const mesh = compileGeometry({ kind: 'roundedBox', size: [4, 2, 1], radius: 0.1, segments: 3, uv: { mode: 'box', metersPerTile: 1 } })
  assert.equal(mesh.uvs.length, (mesh.positions.length / 3) * 2)
  for (const value of mesh.uvs) assert.ok(Number.isFinite(value))
  assert.ok(mesh.positions.length / 3 >= 24)
})

test('S3 cylindrical and spherical projection repair wrap seams per triangle', () => {
  for (const [kind, uv] of [
    ['cylinder', { mode: 'cylindrical' }],
    ['sphere', { mode: 'spherical' }],
  ]) {
    const mesh = compileGeometry({ kind, segments: 16, ...(kind === 'sphere' ? { rings: 8 } : {}), uv })
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const us = [0, 1, 2].map(local => mesh.uvs[mesh.indices[offset + local] * 2])
      assert.ok(Math.max(...us) - Math.min(...us) <= 0.500001, `${kind} seam spans more than half a wrap`)
    }
  }
})

test('S3 tangent generation emits normalized orthogonal xyzw tangents', () => {
  const mesh = compileGeometry({ kind: 'sphere', radius: 1, segments: 24, rings: 12, uv: { mode: 'spherical' }, tangents: true })
  assert.equal(mesh.tangents.length, (mesh.positions.length / 3) * 4)
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
    const tx = mesh.tangents[vertex * 4], ty = mesh.tangents[vertex * 4 + 1], tz = mesh.tangents[vertex * 4 + 2], tw = mesh.tangents[vertex * 4 + 3]
    const nx = mesh.normals[vertex * 3], ny = mesh.normals[vertex * 3 + 1], nz = mesh.normals[vertex * 3 + 2]
    approx(Math.hypot(tx, ty, tz), 1, 2e-5, 'tangent length')
    assert.ok(Math.abs(nx * tx + ny * ty + nz * tz) < 2e-5)
    assert.ok(tw === 1 || tw === -1)
  }
})

test('S3 tangent generation fails closed when normals or UVs are absent', () => {
  const bare = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  }
  assert.throws(() => generateTangents(bare), error => error instanceof GeometryValidationError && error.issues[0].path === '/normals')
})

test('S3 primitive semantic groups cover index buffers without forcing extra material slots', () => {
  const box = compileGeometry({ kind: 'box', size: [2, 3, 4] })
  assert.deepEqual(box.groups.map(group => group.name), ['front', 'back', 'right', 'left', 'top', 'bottom'])
  assertGroupsCoverMesh(box)

  const cylinder = compileGeometry({ kind: 'cylinder', segments: 12, cap: true })
  assert.deepEqual(cylinder.groups.map(group => group.name), ['side', 'bottom', 'top'])
  assertGroupsCoverMesh(cylinder)

  const cone = compileGeometry({ kind: 'cone', segments: 12, cap: true })
  assert.deepEqual(cone.groups.map(group => group.name), ['side', 'bottom'])
  assertGroupsCoverMesh(cone)
})

test('S3 surface processing preserves semantic group ranges through normals, UV reprojection and tangents', () => {
  const mesh = compileGeometry({
    kind: 'box', size: [2, 3, 4],
    normals: { mode: 'smooth', creaseAngle: Math.PI / 3 },
    uv: { mode: 'box', metersPerTile: 0.5, rotation: 0.1, offset: [0.25, -0.5] },
    tangents: true,
  })
  assertGroupsCoverMesh(mesh)
  assert.deepEqual(mesh.groups.map(group => group.name), ['front', 'back', 'right', 'left', 'top', 'bottom'])
  assert.equal(mesh.tangents.length, (mesh.positions.length / 3) * 4)
})
