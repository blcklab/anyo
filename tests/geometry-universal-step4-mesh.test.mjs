import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  GeometryValidationError,
  buildGeometry,
  compileGeometry,
  createGeometryCompiler,
} from '../dist/esm/geometry/index.js'

const pyramid = {
  kind: 'mesh',
  positions: [
    -1, 0, -1,
     1, 0, -1,
     1, 0,  1,
    -1, 0,  1,
     0, 2,  0,
  ],
  indices: [
    0, 2, 1, 0, 3, 2,
    0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4,
  ],
  groups: [
    { start: 0, count: 6, materialIndex: 0, name: 'base' },
    { start: 6, count: 12, materialIndex: 1, name: 'sides' },
  ],
}

function plain(value) { return JSON.parse(JSON.stringify(value)) }

function snapshot(mesh) {
  return {
    positions: [...mesh.positions], indices: [...mesh.indices],
    normals: mesh.normals ? [...mesh.normals] : undefined,
    uvs: mesh.uvs ? [...mesh.uvs] : undefined,
    tangents: mesh.tangents ? [...mesh.tangents] : undefined,
    colors: mesh.colors ? [...mesh.colors] : undefined,
    groups: mesh.groups ? plain(mesh.groups) : undefined,
    bounds: plain(mesh.bounds),
  }
}

test('universal geometry step 4 adds one universal indexed-mesh escape hatch without semantic object kinds', () => {
  assert.equal(BUILTIN_GEOMETRY_KIND_NAMES[0], 'mesh')
  assert.equal(BUILTIN_GEOMETRY_KIND_NAMES.length, 25)
  for (const semantic of ['tree', 'road', 'building', 'stair', 'cloud', 'pavilion']) assert.ok(!BUILTIN_GEOMETRY_KIND_NAMES.includes(semantic))
})

test('arbitrary mesh compiles JSON arrays into the canonical immutable renderer-neutral mesh contract', () => {
  const result = buildGeometry(pyramid, { cache: false })
  assert.equal(result.source.kind, 'mesh')
  assert.ok(result.key.startsWith('g2-'))
  assert.ok(result.mesh.positions instanceof Float32Array)
  assert.ok(result.mesh.indices instanceof Uint16Array)
  assert.deepEqual([...result.mesh.positions], pyramid.positions)
  assert.deepEqual([...result.mesh.indices], pyramid.indices)
  assert.deepEqual(plain(result.mesh.groups), pyramid.groups)
  assert.deepEqual(result.mesh.bounds.min, [-1, 0, -1])
  assert.deepEqual(result.mesh.bounds.max, [1, 2, 1])
})

test('raw mesh attributes preserve normals/uvs/tangents/colors without colliding with surface policy fields', () => {
  const definition = {
    kind: 'mesh',
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
    attributes: {
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0, 1],
      tangents: [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
      colors: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1],
    },
  }
  const mesh = compileGeometry(definition, { cache: false })
  assert.deepEqual([...mesh.normals], definition.attributes.normals)
  assert.deepEqual([...mesh.uvs], definition.attributes.uvs)
  assert.deepEqual([...mesh.tangents], definition.attributes.tangents)
  assert.deepEqual([...mesh.colors], definition.attributes.colors)
})

test('arbitrary mesh can intentionally derive missing normals, UVs and tangents through existing surface policies', () => {
  const mesh = compileGeometry({
    ...pyramid,
    normals: { mode: 'smooth', creaseAngle: Math.PI },
    uv: { mode: 'planar', axis: 'xz', scale: [1, 1], rotation: 0, offset: [0, 0] },
    tangents: true,
  }, { cache: false })
  const vertexCount = mesh.positions.length / 3
  assert.equal(mesh.normals.length, vertexCount * 3)
  assert.equal(mesh.uvs.length, vertexCount * 2)
  assert.equal(mesh.tangents.length, vertexCount * 4)
})

test('arbitrary mesh participates in the generic operator pipeline without renderer special cases', () => {
  const direct = compileGeometry(pyramid, { cache: false })
  const transformed = compileGeometry({
    kind: 'pipeline',
    source: pyramid,
    modifiers: [
      { kind: 'twist', axis: 'y', angle: 0.4 },
      { kind: 'transform', position: [3, 0, 0] },
    ],
  }, { cache: false })
  assert.equal(transformed.indices.length, direct.indices.length)
  assert.notDeepEqual([...transformed.positions], [...direct.positions])
  assert.ok(transformed.bounds.min[0] > direct.bounds.min[0])
})

test('mesh identity is deterministic and includes raw topology/attributes/groups', () => {
  const compiler = createGeometryCompiler({ cache: false })
  assert.equal(compiler.keyFor(pyramid), compiler.keyFor(structuredClone(pyramid)))
  assert.notEqual(compiler.keyFor(pyramid), compiler.keyFor({ ...pyramid, positions: pyramid.positions.map((value, index) => index === 0 ? value - 0.01 : value) }))
  assert.notEqual(compiler.keyFor(pyramid), compiler.keyFor({ ...pyramid, groups: [{ start: 0, count: 18, materialIndex: 0, name: 'all' }] }))
})

test('mesh normalization rejects malformed topology and per-vertex attribute lengths before typed-array allocation', () => {
  const bad = [
    { kind: 'mesh', positions: [0, 0], indices: [0, 0, 0] },
    { kind: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1] },
    { kind: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 3] },
    { kind: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2.5] },
    { kind: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], attributes: { normals: [0, 0, 1] } },
    { kind: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], attributes: { weights: [1, 1, 1] } },
    { kind: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], groups: [{ start: 1, count: 3, materialIndex: 0 }] },
  ]
  for (const definition of bad) assert.throws(() => compileGeometry(definition, { cache: false }), GeometryValidationError)
})

test('mesh authoring obeys the existing global geometry safety limits', () => {
  assert.throws(
    () => compileGeometry(pyramid, { cache: false, limits: { maxGeometryVertices: 4 } }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MESH_LIMIT'),
  )
  assert.throws(
    () => compileGeometry(pyramid, { cache: false, limits: { maxGeometryIndices: 17 } }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MESH_LIMIT'),
  )
})

test('mesh escape hatch upgrades to Uint32 indices when vertex count exceeds the Uint16 address space', () => {
  const vertexCount = 65_536
  const positions = new Array(vertexCount * 3).fill(0)
  positions[(vertexCount - 2) * 3] = 1
  positions[(vertexCount - 1) * 3 + 1] = 1
  const mesh = compileGeometry({
    kind: 'mesh', positions, indices: [0, vertexCount - 2, vertexCount - 1],
  }, { cache: false, limits: { maxGeometryVertices: 70_000, maxDefinitionNodes: 300_000 } })
  assert.ok(mesh.indices instanceof Uint32Array)
  assert.deepEqual([...mesh.indices], [0, vertexCount - 2, vertexCount - 1])
})

test('mesh compilation does not mutate authored JSON arrays', () => {
  const authored = structuredClone(pyramid)
  const before = JSON.stringify(authored)
  const a = compileGeometry(authored, { cache: false })
  const b = compileGeometry(authored, { cache: false })
  assert.equal(JSON.stringify(authored), before)
  assert.deepEqual(snapshot(a), snapshot(b))
})
