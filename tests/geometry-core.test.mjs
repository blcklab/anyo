import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANYO_GEOMETRY_CONVENTIONS,
  GeometryCache,
  GeometryValidationError,
  canonicalGeometryString,
  compileGeometry,
  computeGeometryBounds,
  createGeometryCompiler,
  finalizeGeometryMesh,
  hashGeometryDefinition,
  inspectGeometryDefinition,
  inspectGeometryMesh,
  normalizeGeometryDefinition,
} from '../dist/esm/geometry/index.js'

const triangleKind = {
  kind: 'testTriangle',
  normalize(definition) {
    return { ...definition, size: definition.size ?? 1 }
  },
  compile(definition) {
    const size = Number(definition.size)
    return {
      positions: new Float32Array([0, 0, 0, size, 0, 0, 0, size, 0]),
      indices: new Uint16Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    }
  },
}

test('S1 freezes Anyo world-space geometry conventions', () => {
  assert.deepEqual(ANYO_GEOMETRY_CONVENTIONS, {
    handedness: 'right', upAxis: '+Y', eastAxis: '+X', northAxis: '-Z', unit: 'meter',
    eulerUnit: 'radian', frontFace: 'counter-clockwise', topology: 'triangles', uvOrigin: 'lower-left',
  })
})

test('geometry normalization is JSON-safe, sorted and deterministic', () => {
  const a = { quality: 'high', radius: -0, nested: { z: 2, a: 1, omitted: undefined }, kind: 'cylinder' }
  const b = { kind: 'cylinder', nested: { a: 1, z: 2 }, radius: 0, quality: 'high' }
  assert.deepEqual(normalizeGeometryDefinition(a), normalizeGeometryDefinition(b))
  assert.equal(canonicalGeometryString(a), canonicalGeometryString(b))
  assert.equal(hashGeometryDefinition(a), hashGeometryDefinition(b))
  assert.match(hashGeometryDefinition(a), /^g1-[0-9a-f]{16}$/)
})

test('geometry hashes change for geometry parameters and ignore author property order', () => {
  const base = { kind: 'roundedBox', size: [1, 2, 3], radius: 0.04 }
  const reordered = { radius: 0.04, kind: 'roundedBox', size: [1, 2, 3] }
  const changed = { kind: 'roundedBox', size: [1, 2, 3], radius: 0.05 }
  assert.equal(hashGeometryDefinition(base), hashGeometryDefinition(reordered))
  assert.notEqual(hashGeometryDefinition(base), hashGeometryDefinition(changed))
})

test('geometry definition safety rejects non-finite and unreasonable nested input', () => {
  const nonFinite = inspectGeometryDefinition({ kind: 'box', size: [1, Infinity, 1] })
  assert.equal(nonFinite.valid, false)
  assert.ok(nonFinite.issues.some(issue => issue.code === 'GEOMETRY_NON_FINITE_NUMBER'))

  const deep = { kind: 'box', child: { child: { child: { value: 1 } } } }
  const limited = inspectGeometryDefinition(deep, { limits: { maxDefinitionDepth: 2 } })
  assert.equal(limited.valid, false)
  assert.ok(limited.issues.some(issue => issue.code === 'GEOMETRY_DEFINITION_LIMIT'))
})

test('bounds are deterministic and contain every vertex', () => {
  const positions = new Float32Array([-2, -1, -3, 4, 5, 6, 1, 2, -2])
  const bounds = computeGeometryBounds(positions)
  assert.deepEqual(bounds.min, [-2, -1, -3])
  assert.deepEqual(bounds.max, [4, 5, 6])
  assert.deepEqual(bounds.sphere.center, [1, 2, 1.5])
  for (let index = 0; index < positions.length; index += 3) {
    const dx = positions[index] - bounds.sphere.center[0]
    const dy = positions[index + 1] - bounds.sphere.center[1]
    const dz = positions[index + 2] - bounds.sphere.center[2]
    assert.ok(Math.hypot(dx, dy, dz) <= bounds.sphere.radius + 1e-6)
  }
})

test('mesh finalization validates triangle indices and attribute layouts', () => {
  const mesh = finalizeGeometryMesh(triangleKind.compile({ kind: 'testTriangle', size: 1 }))
  assert.deepEqual(mesh.bounds.min, [0, 0, 0])
  assert.deepEqual(mesh.bounds.max, [1, 1, 0])

  const invalid = inspectGeometryMesh({
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint16Array([0, 1, 0]),
  })
  assert.equal(invalid.valid, false)
  assert.ok(invalid.issues.some(issue => issue.code === 'GEOMETRY_INDEX_OUT_OF_RANGE'))
})

test('GeometryCompiler resolves kind defaults before hashing and shares cached mesh resources', () => {
  let compiles = 0
  const countedKind = { ...triangleKind, compile(definition, context) { compiles += 1; return triangleKind.compile(definition, context) } }
  const cache = new GeometryCache()
  const compiler = createGeometryCompiler({ kinds: [countedKind], cache })
  const implicit = { kind: 'testTriangle' }
  const explicit = { kind: 'testTriangle', size: 1 }
  assert.equal(compiler.keyFor(implicit), compiler.keyFor(explicit))
  const first = compiler.compile(implicit)
  const second = compiler.compile(explicit)
  assert.strictEqual(first, second)
  assert.equal(compiles, 1)
  assert.equal(cache.size, 1)
})

test('compileGeometry is extension-ready while unsupported kinds fail with structured errors', () => {
  const mesh = compileGeometry({ kind: 'testTriangle', size: 2 }, { kinds: [triangleKind] })
  assert.deepEqual(mesh.bounds.max, [2, 2, 0])
  assert.throws(
    () => compileGeometry({ kind: 'notBuiltIn', size: [1, 1, 1] }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_KIND_UNSUPPORTED'),
  )
})
