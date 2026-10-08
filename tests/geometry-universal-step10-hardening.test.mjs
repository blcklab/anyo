import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GeometryValidationError,
  compileGeometry,
  createGeometryCompiler,
  finalizeGeometryMesh,
  inspectGeometryMesh,
} from '../dist/esm/geometry/index.js'

function triangleMesh(overrides = {}) {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    ...overrides,
  }
}

test('universal geometry step 10 diagnoses suspicious mesh data without rejecting unusual valid geometry by default', () => {
  const mesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 1, 3, 1, 0, 3]),
    normals: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    tangents: new Float32Array([1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
    groups: [{ start: 0, count: 6, materialIndex: 0 }, { start: 3, count: 6, materialIndex: 1 }],
    bounds: { min: [99, 99, 99], max: [100, 100, 100], sphere: { center: [99, 99, 99], radius: 1 } },
  }
  const result = inspectGeometryMesh(mesh)
  assert.equal(result.valid, true)
  assert.deepEqual(result.issues, [])
  const codes = new Set((result.diagnostics ?? []).map(issue => issue.code))
  for (const code of ['GEOMETRY_NORMAL_INVALID', 'GEOMETRY_TANGENT_INVALID', 'GEOMETRY_GROUP_OVERLAP', 'GEOMETRY_DEGENERATE_TRIANGLE', 'GEOMETRY_BOUNDS_MISMATCH']) assert.ok(codes.has(code), code)
  assert.deepEqual(result.value.bounds.min, [0, 0, 0])
  assert.deepEqual(result.value.bounds.max, [2, 1, 0])
})

test('strict validation can promote diagnostic classes to structured errors', () => {
  const degenerate = triangleMesh({ indices: new Uint16Array([0, 0, 1]) })
  assert.throws(
    () => finalizeGeometryMesh(degenerate, { degenerateTriangles: 'error' }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_DEGENERATE_TRIANGLE',
  )
  const zeroNormal = triangleMesh({ normals: new Float32Array(9) })
  assert.throws(
    () => finalizeGeometryMesh(zeroNormal, { vectorAttributes: 'error' }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_NORMAL_INVALID',
  )
  const overlapping = triangleMesh({ groups: [{ start: 0, count: 3, materialIndex: 0 }, { start: 0, count: 3, materialIndex: 1 }] })
  assert.throws(
    () => finalizeGeometryMesh(overlapping, { groupOverlaps: 'error' }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_GROUP_OVERLAP',
  )
})

test('shared-edge winding conflicts are detectable while ordinary open boundaries remain valid', () => {
  const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,-1,0])
  const conflict = inspectGeometryMesh({ positions, indices: new Uint16Array([0,1,2, 0,1,3]) })
  assert.equal(conflict.valid, true)
  assert.ok(conflict.diagnostics?.some(issue => issue.code === 'GEOMETRY_WINDING_INCONSISTENT'))

  const open = inspectGeometryMesh({ positions, indices: new Uint16Array([0,1,2]) })
  assert.equal(open.valid, true)
  assert.ok(!(open.diagnostics ?? []).some(issue => issue.code === 'GEOMETRY_WINDING_INCONSISTENT'))
})

test('bounds are canonicalized from positions and strict callers may reject stale supplied bounds', () => {
  const stale = triangleMesh({ bounds: { min: [-10,-10,-10], max: [10,10,10], sphere: { center: [0,0,0], radius: 10 } } })
  const repaired = finalizeGeometryMesh(stale)
  assert.deepEqual(repaired.bounds.min, [0,0,0])
  assert.deepEqual(repaired.bounds.max, [1,1,0])
  assert.throws(
    () => finalizeGeometryMesh(stale, { bounds: 'error' }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_BOUNDS_MISMATCH',
  )
})

test('new group and attribute-value safety guards reject runaway raw mesh authoring before release', () => {
  const definition = {
    kind: 'mesh',
    positions: [0,0,0, 1,0,0, 0,1,0],
    indices: [0,1,2],
    attributes: { normals: [0,0,1, 0,0,1, 0,0,1] },
    groups: [{ start: 0, count: 3, materialIndex: 0 }, { start: 0, count: 3, materialIndex: 1 }],
  }
  assert.throws(
    () => compileGeometry(definition, { cache: false, limits: { maxGeometryGroups: 1 } }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MESH_LIMIT' && issue.path === '/groups'),
  )
  assert.throws(
    () => compileGeometry(definition, { cache: false, limits: { maxGeometryAttributeValues: 8 } }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MESH_LIMIT' && issue.path === '/attributes'),
  )
})

test('compiler diagnostics carry deterministic geometry context and operator failures identify operator position', () => {
  const diagnostics = []
  const compiler = createGeometryCompiler({ cache: false, onDiagnostic: diagnostic => diagnostics.push(diagnostic) })
  compiler.compile({ kind: 'mesh', positions: [0,0,0, 1,0,0, 2,0,0], indices: [0,1,2] })
  const degenerate = diagnostics.find(item => item.code === 'GEOMETRY_DEGENERATE_TRIANGLE')
  assert.equal(degenerate.context.geometryKind, 'mesh')
  assert.match(degenerate.context.geometryKey, /^g2-/)

  const badOperator = {
    kind: 'test.bad',
    apply(mesh) { return { ...mesh, indices: new Uint16Array([0,0,1]), bounds: undefined } },
  }
  const strict = createGeometryCompiler({ cache: false, operators: [badOperator], validation: { degenerateTriangles: 'error' } })
  assert.throws(
    () => strict.compile({ kind: 'pipeline', source: { kind: 'plane' }, modifiers: [{ kind: 'test.bad' }] }),
    error => error instanceof GeometryValidationError && error.issues.some(issue =>
      issue.code === 'GEOMETRY_DEGENERATE_TRIANGLE' && issue.context?.geometryKind === 'pipeline' && issue.context?.operatorKind === 'test.bad' && issue.context?.operatorIndex === 0),
  )
})

test('diagnostic accumulation is bounded for pathological generated meshes', () => {
  const positions = new Float32Array([0,0,0, 1,0,0, 2,0,0])
  const indices = new Uint16Array(30)
  for (let index = 0; index < indices.length; index += 3) { indices[index] = 0; indices[index + 1] = 1; indices[index + 2] = 2 }
  const result = inspectGeometryMesh({ positions, indices }, { maxDiagnostics: 3 })
  assert.equal(result.valid, true)
  assert.equal(result.diagnostics.length, 3)
})

test('winding diagnostics have an explicit scan ceiling for large meshes', () => {
  const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,-1,0])
  const indices = new Uint16Array([0,1,2, 0,1,3])
  const skipped = inspectGeometryMesh({ positions, indices }, { windingTriangleLimit: 1 })
  assert.equal(skipped.valid, true)
  assert.ok(!(skipped.diagnostics ?? []).some(issue => issue.code === 'GEOMETRY_WINDING_INCONSISTENT'))
})

test('runtime-invalid mesh objects fail with structured issues instead of validator crashes', () => {
  const result = inspectGeometryMesh({ positions: null, indices: null })
  assert.equal(result.valid, false)
  assert.ok(result.issues.some(issue => issue.path === '/positions'))
  assert.ok(result.issues.some(issue => issue.path === '/indices'))
})
