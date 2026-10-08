import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGeometry,
  compileGeometry,
  createGeometryCompiler,
  hashGeometryDefinition,
} from '../dist/esm/geometry/index.js'

test('universal geometry step 1 exposes one canonical normalized build result', () => {
  const compiler = createGeometryCompiler()
  const authored = { kind: 'sphere', radius: 1.25, quality: 'high', tangents: true }
  const result = compiler.build(authored)

  assert.deepEqual(result.source, compiler.normalize(authored))
  assert.equal(result.key, compiler.keyFor(authored))
  assert.equal(result.key, hashGeometryDefinition(result.source))
  assert.strictEqual(result.mesh, compiler.compile(authored), 'compile() must remain the mesh-only view of the same cached build')
  assert.ok(result.mesh.positions.length > 0)
  assert.ok(result.mesh.indices.length > 0)
  assert.ok(result.mesh.bounds.sphere.radius > 0)
})

test('buildGeometry stays output-compatible with compileGeometry for existing definitions', () => {
  const definition = {
    kind: 'transform',
    source: { kind: 'roundedBox', size: [2, 3, 4], radius: 0.15, segments: 3 },
    position: [1, 2, -3],
    rotation: [0.1, 0.2, 0.3],
  }
  const built = buildGeometry(definition, { cache: false })
  const compiled = compileGeometry(definition, { cache: false })

  assert.deepEqual([...built.mesh.positions], [...compiled.positions])
  assert.deepEqual([...built.mesh.indices], [...compiled.indices])
  assert.deepEqual(built.mesh.bounds, compiled.bounds)
  assert.equal(built.source.kind, 'transform')
  assert.match(built.key, /^g1-[0-9a-f]{16}$/)
})

test('canonical build result also works for explicitly registered geometry kinds', () => {
  const triangle = {
    kind: 'step1Triangle',
    normalize(definition) {
      return { ...definition, size: definition.size ?? 1 }
    },
    compile(definition) {
      const size = Number(definition.size)
      return {
        positions: new Float32Array([0, 0, 0, size, 0, 0, 0, size, 0]),
        indices: new Uint16Array([0, 1, 2]),
      }
    },
  }
  const compiler = createGeometryCompiler({ kinds: [triangle] })
  const built = compiler.build({ kind: 'step1Triangle' })

  assert.equal(built.source.kind, 'step1Triangle')
  assert.equal(built.source.size, 1)
  assert.equal(built.mesh.indices.length, 3)
  assert.deepEqual(built.mesh.bounds.min, [0, 0, 0])
  assert.deepEqual(built.mesh.bounds.max, [1, 1, 0])
})
