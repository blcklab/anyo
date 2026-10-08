import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_GEOMETRY_OPERATOR_NAMES,
  GeometryValidationError,
  applyGeometryOperator,
  compileGeometry,
  createGeometryCompiler,
} from '../dist/esm/geometry/index.js'

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

const source = { kind: 'roundedBox', size: [1.5, 3, 1], radius: 0.08, segments: 2, tangents: true }

test('universal geometry step 3 expands the generic operator vocabulary without semantic kinds', () => {
  assert.deepEqual([...BUILTIN_GEOMETRY_OPERATOR_NAMES], [
    'transform', 'taper', 'twist', 'bend', 'mirror', 'noise', 'array', 'weld', 'displace',
  ])
})

test('step 3 operators normalize to source-free deterministic descriptors with defaults', () => {
  const normalized = createGeometryCompiler().normalize({
    kind: 'pipeline', source: { kind: 'box' }, modifiers: [
      { kind: 'bend' }, { kind: 'mirror' }, { kind: 'noise' },
      { kind: 'array', count: 2, offset: [1, 0, 0] }, { kind: 'weld' },
    ],
  })
  assert.deepEqual(plain(normalized.modifiers), [
    { kind: 'bend', axis: 'y', direction: 'x', angle: 0 },
    { kind: 'mirror', axis: 'x', offset: 0, includeOriginal: true },
    { kind: 'noise', seed: 0, frequency: 1, strength: 0.1, octaves: 1, lacunarity: 2, persistence: 0.5, offset: [0, 0, 0] },
    { kind: 'array', count: 2, offset: [1, 0, 0], position: [0, 0, 0], rotation: [0, 0, 0], rotationOffset: [0, 0, 0], scale: [1, 1, 1] },
    { kind: 'weld', tolerance: 1e-6 },
  ])
  assert.ok(normalized.modifiers.every(operator => !('source' in operator)))
})

test('bend operator is byte-compatible with the mature legacy bend geometry kind', () => {
  const operator = compileGeometry({ kind: 'pipeline', source, modifiers: [{ kind: 'bend', axis: 'y', direction: 'x', angle: 0.7 }] }, { cache: false })
  const legacy = compileGeometry({ kind: 'bend', source, axis: 'y', direction: 'x', angle: 0.7 }, { cache: false })
  assert.deepEqual(snapshot(operator), snapshot(legacy))
})

test('mirror operator is byte-compatible with legacy mirror including tangent-safe handedness', () => {
  const modifier = { kind: 'mirror', axis: 'z', offset: 0.25, includeOriginal: true }
  const operator = compileGeometry({ kind: 'pipeline', source, modifiers: [modifier] }, { cache: false })
  const legacy = compileGeometry({ ...modifier, source }, { cache: false })
  assert.deepEqual(snapshot(operator), snapshot(legacy))
  assert.equal(operator.tangents.length, (operator.positions.length / 3) * 4)
})

test('noise operator reuses deterministic legacy displacement and seed participates in output', () => {
  const modifier = { kind: 'noise', seed: 42, frequency: 1.4, strength: 0.12, octaves: 3, lacunarity: 2.1, persistence: 0.45, offset: [0.2, -0.1, 0.3] }
  const a = compileGeometry({ kind: 'pipeline', source, modifiers: [modifier] }, { cache: false })
  const legacy = compileGeometry({ ...modifier, source }, { cache: false })
  const b = compileGeometry({ kind: 'pipeline', source, modifiers: [modifier] }, { cache: false })
  const c = compileGeometry({ kind: 'pipeline', source, modifiers: [{ ...modifier, seed: 43 }] }, { cache: false })
  assert.deepEqual(snapshot(a), snapshot(legacy))
  assert.deepEqual(snapshot(a), snapshot(b))
  assert.notDeepEqual([...a.positions], [...c.positions])
})

test('array operator bakes deterministic transformed copies into one mesh', () => {
  const mesh = compileGeometry({
    kind: 'pipeline', source: { kind: 'box', size: [1, 1, 1] },
    modifiers: [{ kind: 'array', count: 3, offset: [2, 0, 0] }],
  }, { cache: false })
  const one = compileGeometry({ kind: 'box', size: [1, 1, 1] }, { cache: false })
  assert.equal(mesh.positions.length, one.positions.length * 3)
  assert.equal(mesh.indices.length, one.indices.length * 3)
  assert.deepEqual(mesh.bounds.min, [-0.5, -0.5, -0.5])
  assert.deepEqual(mesh.bounds.max, [4.5, 0.5, 0.5])
})

test('array operator enforces both instance and projected baked-mesh safety limits', () => {
  assert.throws(
    () => compileGeometry({ kind: 'pipeline', source: { kind: 'box' }, modifiers: [{ kind: 'array', count: 3, offset: [1, 0, 0] }] }, { cache: false, limits: { maxGeneratedInstances: 2 } }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_INSTANCE_LIMIT'),
  )
  assert.throws(
    () => compileGeometry({ kind: 'pipeline', source: { kind: 'box' }, modifiers: [{ kind: 'array', count: 3, offset: [1, 0, 0] }] }, { cache: false, limits: { maxGeometryVertices: 50 } }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MESH_LIMIT'),
  )
})

test('weld removes only safe duplicate vertices and preserves box UV/normal seams', () => {
  const one = compileGeometry({ kind: 'box' }, { cache: false })
  const duplicated = compileGeometry({
    kind: 'pipeline', source: { kind: 'box' }, modifiers: [{ kind: 'array', count: 2, offset: [0, 0, 0] }],
  }, { cache: false })
  const welded = compileGeometry({
    kind: 'pipeline', source: { kind: 'box' }, modifiers: [
      { kind: 'array', count: 2, offset: [0, 0, 0] },
      { kind: 'weld', tolerance: 1e-6 },
    ],
  }, { cache: false })
  assert.equal(duplicated.positions.length, one.positions.length * 2)
  assert.equal(welded.positions.length, one.positions.length)
  assert.equal(welded.indices.length, duplicated.indices.length)
  assert.equal(applyGeometryOperator(one, { kind: 'weld', tolerance: 1e-6 }, { cache: false }).positions.length, one.positions.length)
})

test('step 3 operator order stays deterministic and meaningfully composable', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const a = { kind: 'pipeline', source: { kind: 'box' }, modifiers: [
    { kind: 'array', count: 2, offset: [0, 0, 0] }, { kind: 'weld' }, { kind: 'transform', position: [2, 0, 0] },
  ] }
  const b = { kind: 'pipeline', source: { kind: 'box' }, modifiers: [
    { kind: 'weld' }, { kind: 'array', count: 2, offset: [0, 0, 0] }, { kind: 'transform', position: [2, 0, 0] },
  ] }
  assert.notEqual(compiler.keyFor(a), compiler.keyFor(b))
  assert.notEqual(compiler.compile(a).positions.length, compiler.compile(b).positions.length)
  assert.equal(compiler.keyFor(a), compiler.keyFor(structuredClone(a)))
})
