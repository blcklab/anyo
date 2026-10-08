import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GeometryExtensionRegistry,
  GeometryValidationError,
  createGeometryCompiler,
  isNamespacedGeometryKind,
} from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'
import { createWorld, entitiesPlugin } from '../dist/esm/index.js'

function pyramidProvider(version = '1.0.0') {
  return {
    namespace: 'test.geometry',
    version,
    kinds: [{
      name: 'pyramid',
      normalize(definition) {
        const params = definition.params ?? {}
        const size = params.size ?? 1
        const height = params.height ?? 1
        if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) throw new Error('size must be positive')
        if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) throw new Error('height must be positive')
        return { ...definition, params: { size, height } }
      },
      compile(definition, context) {
        const { size, height } = definition.params
        const half = size / 2
        return context.compileSource({
          kind: 'mesh',
          positions: [
            -half, 0, -half,
             half, 0, -half,
             half, 0,  half,
            -half, 0,  half,
             0, height, 0,
          ],
          indices: [
            0, 2, 1, 0, 3, 2,
            0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4,
          ],
          normals: { mode: 'flat' },
        })
      },
    }],
  }
}

function meshArrays(mesh) {
  return {
    positions: [...mesh.positions],
    indices: [...mesh.indices],
    normals: mesh.normals ? [...mesh.normals] : undefined,
    uvs: mesh.uvs ? [...mesh.uvs] : undefined,
    tangents: mesh.tangents ? [...mesh.tangents] : undefined,
    colors: mesh.colors ? [...mesh.colors] : undefined,
    groups: mesh.groups,
    bounds: mesh.bounds,
  }
}

const extensionDefinition = { kind: 'test.geometry:pyramid', params: { size: 2, height: 3 } }

test('Universal Geometry Step 8: trusted registry owns namespaces and supports explicit register/resolve/unregister lifecycle', () => {
  const registry = new GeometryExtensionRegistry()
  assert.equal(registry.list().length, 0)
  registry.register(pyramidProvider())
  assert.equal(registry.has('test.geometry'), true)
  assert.equal(registry.hasKind('test.geometry:pyramid'), true)
  assert.equal(registry.resolve('test.geometry:pyramid').version, '1.0.0')
  assert.deepEqual(registry.list(), [{ namespace: 'test.geometry', version: '1.0.0', kinds: ['pyramid'] }])
  assert.equal(registry.unregister('test.geometry'), true)
  assert.equal(registry.hasKind('test.geometry:pyramid'), false)
  assert.equal(registry.unregister('test.geometry'), false)
})

test('Universal Geometry Step 8: namespaced provider compiles through the canonical mesh pipeline and composes with modifiers', () => {
  const compiler = createGeometryCompiler({ extensions: [pyramidProvider()] })
  const normalized = compiler.normalize(extensionDefinition)
  assert.equal(normalized.kind, 'test.geometry:pyramid')
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.params)), { height: 3, size: 2 })

  const plain = compiler.compile(extensionDefinition)
  const transformed = compiler.compile({
    kind: 'pipeline',
    source: extensionDefinition,
    modifiers: [
      { kind: 'twist', axis: 'y', angle: 0.35 },
      { kind: 'transform', position: [4, 0, 0] },
    ],
  })
  assert.equal(plain.indices.length, 18)
  assert.ok(plain.normals)
  assert.notDeepEqual(meshArrays(plain), meshArrays(transformed))
  assert.ok(transformed.bounds.min[0] > 2)
})

test('Universal Geometry Step 8: unknown provider/kind and unregister fail cleanly instead of falling back to dynamic code', () => {
  const registry = new GeometryExtensionRegistry([pyramidProvider()])
  const compiler = createGeometryCompiler({ extensions: registry })
  compiler.compile(extensionDefinition)

  assert.throws(
    () => compiler.compile({ kind: 'missing.provider:shape', params: {} }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_EXTENSION_UNREGISTERED',
  )
  assert.throws(
    () => compiler.compile({ kind: 'test.geometry:missing', params: {} }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_EXTENSION_KIND_UNREGISTERED',
  )

  registry.unregister('test.geometry')
  assert.throws(
    () => compiler.compile(extensionDefinition),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_EXTENSION_UNREGISTERED',
  )
})

test('Universal Geometry Step 8: extension authoring is a strict JSON envelope and low-level kind registration cannot bypass namespaces', () => {
  const compiler = createGeometryCompiler({ extensions: [pyramidProvider()] })
  assert.equal(isNamespacedGeometryKind('test.geometry:pyramid'), true)
  assert.equal(isNamespacedGeometryKind('Pyramid'), false)
  assert.throws(
    () => compiler.normalize({ kind: 'test.geometry:pyramid', size: 2 }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_EXTENSION_FIELD_INVALID',
  )
  assert.throws(
    () => compiler.normalize({ kind: 'test.geometry:pyramid', params: { factory: () => ({}) } }),
    GeometryValidationError,
  )
  assert.throws(
    () => createGeometryCompiler({ kinds: [{ kind: 'test.geometry:pyramid', compile: () => ({ positions:new Float32Array(), indices:new Uint16Array() }) }] }),
    /registerExtension/,
  )
})

test('Universal Geometry Step 8: ResourceGraph bakes extension expressions to built-in mesh resources before renderer realization', () => {
  const builder = createResourceGraphBuilder({ extensions: [pyramidProvider()] })
  const id = builder.addGeometry({
    kind: 'pipeline',
    source: extensionDefinition,
    modifiers: [{ kind: 'transform', position: [2, 0, 0] }],
  })
  const graph = builder.build()
  const node = graph.get(id)
  assert.equal(node.kind, 'geometry')
  assert.equal(node.definition.kind, 'mesh')
  assert.equal(node.dependencies.length, 0)
  assert.equal(JSON.stringify(node.definition).includes('test.geometry:pyramid'), false)
  assert.ok(node.definition.positions.length > 0)
  assert.ok(node.definition.indices.length > 0)
})

test('Universal Geometry Step 8: strict World 0.9 accepts only the generic namespaced extension envelope', () => {
  const valid = {
    version: '0.9',
    geometries: { custom: extensionDefinition },
    entities: [{ id: 'custom', type: 'geometry', geometry: 'custom' }],
  }
  const good = inspectWorldDocument(valid, { mode: 'strict' })
  assert.equal(good.valid, true, good.errors.map(entry => `${entry.code}: ${entry.message}`).join('\n'))

  const invalidKind = structuredClone(valid)
  invalidKind.geometries.custom.kind = 'Test.Geometry:pyramid'
  assert.equal(inspectWorldDocument(invalidKind, { mode: 'strict' }).valid, false)

  const invalidRootField = structuredClone(valid)
  invalidRootField.geometries.custom.size = 2
  assert.equal(inspectWorldDocument(invalidRootField, { mode: 'strict' }).valid, false)

  // Schema validation is intentionally provider-agnostic. Trust/availability is a host runtime decision.
  const missingProvider = structuredClone(valid)
  missingProvider.geometries.custom.kind = 'not.installed:shape'
  assert.equal(inspectWorldDocument(missingProvider, { mode: 'strict' }).valid, true)
})

test('Universal Geometry Step 8: createWorld uses registered providers for collision/build then stores only ordinary mesh resources', async () => {
  const world = createWorld({ geometryExtensions: [pyramidProvider()], plugins: [entitiesPlugin()], autoResize: false })
  await world.load({
    version: '0.9',
    geometries: { custom: extensionDefinition },
    entities: [{ id: 'custom', type: 'geometry', geometry: 'custom', collision: true }],
  })
  assert.equal(world.geometryExtensions.hasKind('test.geometry:pyramid'), true)
  assert.ok(world.compiled.colliders.some(collider => collider.entityId === 'custom'))
  const geometryNodes = world.compiled.resourceGraph.list('geometry')
  assert.equal(geometryNodes.length, 1)
  assert.equal(geometryNodes[0].definition.kind, 'mesh')
  assert.equal(JSON.stringify(geometryNodes[0].definition).includes('test.geometry'), false)
  await world.dispose()
})

test('Universal Geometry Step 8: provider normalizers cannot change namespace/kind ownership', () => {
  const provider = {
    namespace: 'test.owner',
    kinds: [{
      name: 'shape',
      normalize(definition) { return { ...definition, kind: 'other.owner:shape' } },
      compile() { throw new Error('unreachable') },
    }],
  }
  const compiler = createGeometryCompiler({ extensions: [provider] })
  assert.throws(
    () => compiler.normalize({ kind: 'test.owner:shape', params: {} }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'GEOMETRY_EXTENSION_KIND_MISMATCH',
  )
})
