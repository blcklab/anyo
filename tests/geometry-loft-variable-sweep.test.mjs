import test from 'node:test'
import assert from 'node:assert/strict'
import { GeometryValidationError, compileGeometry, createGeometryCompiler } from '../dist/esm/geometry/index.js'

function healthy(mesh) {
  assert.ok(mesh.positions instanceof Float32Array)
  assert.ok(mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array)
  assert.equal(mesh.positions.length % 3, 0)
  assert.equal(mesh.indices.length % 3, 0)
  const vertices = mesh.positions.length / 3
  assert.equal(mesh.normals?.length, mesh.positions.length)
  assert.equal(mesh.uvs?.length, vertices * 2)
  for (const value of mesh.positions) assert.ok(Number.isFinite(value))
  for (const index of mesh.indices) assert.ok(index < vertices)
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset] * 3, b = mesh.indices[offset + 1] * 3, c = mesh.indices[offset + 2] * 3
    const ab = [mesh.positions[b]-mesh.positions[a], mesh.positions[b+1]-mesh.positions[a+1], mesh.positions[b+2]-mesh.positions[a+2]]
    const ac = [mesh.positions[c]-mesh.positions[a], mesh.positions[c+1]-mesh.positions[a+1], mesh.positions[c+2]-mesh.positions[a+2]]
    const cross = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]]
    assert.ok(Math.hypot(...cross) > 1e-9, `triangle ${offset / 3} is degenerate`)
  }
}

const square = { points: [[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]] }

test('final-freeze variable sweep morphs scale, rotation and offset along the transported path', () => {
  const mesh = compileGeometry({
    kind: 'sweep',
    profile: square,
    path: { kind: 'line', points: [[0,0,0],[0,0,5]], segments: 5 },
    profileStations: [
      { at: 0, scale: [1,1] },
      { at: 0.5, scale: [0.7,0.85], rotation: 0.15, offset: [0.15,0] },
      { at: 1, scale: [0.22,0.3], rotation: 0.35, offset: [0.45,0.05] },
    ],
    cap: true,
    normals: { mode: 'smooth', creaseAngle: 1.4 },
    tangents: true,
  })
  healthy(mesh)
  assert.deepEqual(mesh.groups.map(group => group.name), ['startCap','endCap','outerSide'])
  assert.ok(mesh.tangents instanceof Float32Array)
  assert.equal(mesh.tangents.length, (mesh.positions.length / 3) * 4)
  assert.ok(mesh.bounds.max[0] > 0.5, 'profile offset should extend positive X bounds')
  assert.equal(mesh.bounds.max[2], 5)
})

test('final-freeze variable sweep can morph compatible profile shapes, not only taper them', () => {
  const mesh = compileGeometry({
    kind: 'sweep',
    profile: square,
    path: { kind: 'quadraticBezier', points: [[0,0,0],[0.5,2,2],[1,4,4]], segments: 16 },
    profileStations: [
      { at: 0 },
      { at: 1, profile: { points: [[-0.25,-0.7],[0.6,-0.2],[0.25,0.7],[-0.55,0.25]] }, rotation: 0.2 },
    ],
    cap: true,
  })
  healthy(mesh)
  assert.ok(mesh.positions.length / 3 > 100)
})

test('final-freeze sweep station defaults normalize before hashing', () => {
  const compiler = createGeometryCompiler()
  const base = {
    kind: 'sweep', profile: square,
    path: { kind: 'line', points: [[0,0,0],[0,0,2]], segments: 2 },
  }
  const shorthand = { ...base, profileStations: [{ at: 0 }, { at: 1, scale: [0.5,0.5] }] }
  const explicit = { ...base, profileStations: [
    { at: 0, profile: square, scale: [1,1], rotation: 0, offset: [0,0] },
    { at: 1, profile: square, scale: [0.5,0.5], rotation: 0, offset: [0,0] },
  ] }
  assert.equal(compiler.keyFor(shorthand), compiler.keyFor(explicit))
})

test('final-freeze variable sweep rejects incompatible profile topology and discontinuous closed seams', () => {
  assert.throws(() => compileGeometry({
    kind: 'sweep', profile: square,
    path: { kind: 'line', points: [[0,0,0],[0,0,2]] },
    profileStations: [{ at: 0 }, { at: 1, profile: { points: [[0,0],[1,0],[0,1]] } }],
  }), error => error instanceof GeometryValidationError && /topology/.test(error.issues[0].message))

  assert.throws(() => compileGeometry({
    kind: 'sweep', profile: square,
    path: { kind: 'catmullRom', points: [[2,0,0],[0,0,2],[-2,0,0],[0,0,-2]], closed: true, segments: 24 },
    cap: false,
    profileStations: [{ at: 0, scale: [1,1] }, { at: 1, scale: [0.7,0.7] }],
  }), error => error instanceof GeometryValidationError && /continuous seam/.test(error.issues[0].message))
})

test('final-freeze loft skins multiple compatible profiles with caps, generated UVs and tangents', () => {
  const mesh = compileGeometry({
    kind: 'loft',
    sections: [
      { z: 0, profile: { points: [[-1,-0.8],[1,-0.8],[1,0.8],[-1,0.8]] } },
      { z: 1.5, profile: { points: [[-0.8,-0.65],[0.95,-0.55],[0.75,0.7],[-0.9,0.6]] }, rotation: 0.08, offset: [0.12,0] },
      { z: 3.5, profile: { points: [[-0.5,-0.45],[0.65,-0.35],[0.5,0.5],[-0.55,0.4]] }, rotation: 0.16, offset: [0.28,0.08] },
      { z: 5, profile: { points: [[-0.2,-0.22],[0.28,-0.18],[0.2,0.24],[-0.24,0.2]] }, offset: [0.42,0.1] },
    ],
    cap: true,
    uv: { mode: 'generated', metersPerTile: 1 },
    normals: { mode: 'smooth', creaseAngle: 1.2 },
    tangents: true,
  })
  healthy(mesh)
  assert.deepEqual(mesh.groups.map(group => group.name), ['startCap','endCap','outerSide'])
  assert.ok(mesh.tangents instanceof Float32Array)
  assert.equal(mesh.bounds.min[2], 0)
  assert.equal(mesh.bounds.max[2], 5)
  assert.ok(mesh.bounds.max[0] > 1)
})

test('final-freeze loft supports holes when every section preserves topology', () => {
  const ring = { points: [[-1,-1],[1,-1],[1,1],[-1,1]], holes: [[[-0.35,-0.35],[-0.35,0.35],[0.35,0.35],[0.35,-0.35]]] }
  const mesh = compileGeometry({
    kind: 'loft',
    sections: [{ z: 0, profile: ring }, { z: 2, profile: ring, scale: [0.7,0.8], rotation: 0.2 }],
    cap: true,
  })
  healthy(mesh)
  assert.ok(mesh.groups.some(group => group.name === 'holeSide:0'))
})

test('final-freeze loft rejects mismatched topology, unsorted sections and unsafe meshes', () => {
  assert.throws(() => compileGeometry({
    kind: 'loft', sections: [
      { z: 0, profile: square },
      { z: 1, profile: { points: [[0,0],[1,0],[0,1]] } },
    ],
  }), error => error instanceof GeometryValidationError && /matching/.test(error.issues[0].message))

  assert.throws(() => compileGeometry({
    kind: 'loft', sections: [{ z: 1, profile: square }, { z: 0, profile: square }],
  }), error => error instanceof GeometryValidationError && /strictly increasing/.test(error.issues[0].message))

  assert.throws(() => compileGeometry({
    kind: 'loft', sections: [{ z: 0, profile: square }, { z: 1, profile: square }],
  }, { limits: { maxGeometryVertices: 8 } }), error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_MESH_LIMIT')
})
