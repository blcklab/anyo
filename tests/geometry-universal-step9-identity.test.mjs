import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GEOMETRY_BUILD_ABI,
  GeometryCache,
  createGeometryCompiler,
  hashGeometryBuildIdentity,
  hashGeometryDefinition,
} from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'

function provider(version, apexHeight = 1) {
  return {
    namespace: 'test.identity',
    version,
    kinds: [{
      name: 'pyramid',
      normalize(definition) {
        const params = definition.params ?? {}
        return { ...definition, params: { size: params.size ?? 1 } }
      },
      compile(definition, context) {
        const size = definition.params.size
        const half = size / 2
        return context.compileSource({
          kind: 'mesh',
          positions: [
            -half, 0, -half,
             half, 0, -half,
             half, 0,  half,
            -half, 0,  half,
             0, apexHeight, 0,
          ],
          indices: [0, 2, 1, 0, 3, 2, 0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
        })
      },
    }],
  }
}

const custom = { kind: 'test.identity:pyramid', params: { size: 2 } }

function meshSnapshot(mesh) {
  return {
    positions: [...mesh.positions],
    indices: [...mesh.indices],
    bounds: mesh.bounds,
  }
}

test('Universal Geometry Step 9: pure source hash stays g1 while canonical build identity uses g2 + ABI', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const definition = { kind: 'sphere', radius: 2, quality: 'medium' }
  const normalized = compiler.normalize(definition)
  const identity = compiler.identityFor(definition)

  assert.equal(identity.abi, GEOMETRY_BUILD_ABI)
  assert.deepEqual(identity.source, normalized)
  assert.deepEqual(identity.extensions, [])
  assert.match(hashGeometryDefinition(normalized), /^g1-[0-9a-f]{16}$/)
  assert.match(compiler.keyFor(definition), /^g2-[0-9a-f]{16}$/)
  assert.equal(compiler.keyFor(definition), hashGeometryBuildIdentity(identity))
  assert.notEqual(compiler.keyFor(definition), hashGeometryDefinition(normalized))
})

test('Universal Geometry Step 9: equivalent normalized authoring has stable build identity', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const implicit = { kind: 'box' }
  const explicit = { kind: 'box', size: [1, 1, 1] }
  assert.deepEqual(compiler.normalize(implicit), compiler.normalize(explicit))
  assert.equal(compiler.keyFor(implicit), compiler.keyFor(explicit))
  assert.equal(compiler.keyFor(implicit), compiler.keyFor(structuredClone(implicit)))
})

test('Universal Geometry Step 9: build ABI participates in identity without changing pure source content', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const identity = compiler.identityFor({ kind: 'plane', width: 2, height: 3 })
  const changedAbi = { ...identity, abi: 'anyo.geometry/2' }
  assert.notEqual(hashGeometryBuildIdentity(identity), hashGeometryBuildIdentity(changedAbi))
  assert.equal(hashGeometryDefinition(identity.source), hashGeometryDefinition(changedAbi.source))
})

test('Universal Geometry Step 9: extension namespace/version/kinds are sorted deterministic provenance', () => {
  const compiler = createGeometryCompiler({ cache: false, extensions: [provider('1.2.3')] })
  const definition = {
    kind: 'pipeline',
    source: custom,
    modifiers: [{ kind: 'transform', position: [1, 0, 0] }],
  }
  const identity = compiler.identityFor(definition)
  assert.deepEqual(identity.extensions, [{
    namespace: 'test.identity',
    version: '1.2.3',
    kinds: ['test.identity:pyramid'],
  }])
})

test('Universal Geometry Step 9: provider version invalidates shared compile cache deterministically', () => {
  const cache = new GeometryCache()
  const v1 = createGeometryCompiler({ cache, extensions: [provider('1.0.0', 1)] })
  const v2 = createGeometryCompiler({ cache, extensions: [provider('2.0.0', 3)] })

  const first = v1.build(custom)
  const second = v2.build(custom)
  assert.notEqual(first.key, second.key)
  assert.equal(first.identity.extensions[0].version, '1.0.0')
  assert.equal(second.identity.extensions[0].version, '2.0.0')
  assert.notDeepEqual(meshSnapshot(first.mesh), meshSnapshot(second.mesh))
  assert.equal(cache.hasKey(first.key), true)
  assert.equal(cache.hasKey(second.key), true)
  assert.ok(cache.size >= 2, 'shared cache must retain distinct provider-version builds')
})

test('Universal Geometry Step 9: reusable curve/profile/field content is resolved before build identity', () => {
  const resources = {
    curves: { pathA: { kind: 'line', points: [[0, 0, 0], [0, 2, 0]] } },
    profiles: { squareA: { points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] } },
    fields: { liftA: { kind: 'constant', value: 0.25 } },
  }
  const compiler = createGeometryCompiler({ cache: false, ...resources })
  const named = {
    kind: 'pipeline',
    source: { kind: 'sweep', profile: 'squareA', path: 'pathA' },
    modifiers: [{ kind: 'displace', field: 'liftA', strength: 1, direction: 'y' }],
  }
  const inline = {
    kind: 'pipeline',
    source: {
      kind: 'sweep',
      profile: resources.profiles.squareA,
      path: resources.curves.pathA,
    },
    modifiers: [{ kind: 'displace', field: resources.fields.liftA, strength: 1, direction: 'y' }],
  }
  assert.equal(compiler.keyFor(named), compiler.keyFor(inline))
  assert.deepEqual(compiler.identityFor(named).source, compiler.identityFor(inline).source)
})

test('Universal Geometry Step 9: scalar-field seed changes invalidate build identity', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const make = seed => ({
    kind: 'pipeline',
    source: { kind: 'sphere', radius: 1 },
    modifiers: [{ kind: 'displace', field: { kind: 'noise', seed, frequency: 1.2 }, strength: 0.1 }],
  })
  assert.notEqual(compiler.keyFor(make(7)), compiler.keyFor(make(8)))
})

test('Universal Geometry Step 9: modifier order and parameters remain part of g2 build identity', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const source = { kind: 'box', size: [1, 2, 1] }
  const a = { kind: 'pipeline', source, modifiers: [{ kind: 'twist', angle: 0.4 }, { kind: 'taper', endScale: 0.7 }] }
  const b = { kind: 'pipeline', source, modifiers: [...a.modifiers].reverse() }
  const c = { kind: 'pipeline', source, modifiers: [{ kind: 'twist', angle: 0.5 }, { kind: 'taper', endScale: 0.7 }] }
  assert.notEqual(compiler.keyFor(a), compiler.keyFor(b))
  assert.notEqual(compiler.keyFor(a), compiler.keyFor(c))
})

test('Universal Geometry Step 9: ResourceGraph keeps baked mesh renderer boundary but keys extensions by provider provenance', () => {
  const one = createResourceGraphBuilder({ extensions: [provider('1.0.0', 1)] })
  const two = createResourceGraphBuilder({ extensions: [provider('2.0.0', 1)] })
  const id1 = one.addGeometry(custom)
  const id2 = two.addGeometry(custom)
  assert.notEqual(id1, id2, 'provider version must invalidate the renderer resource identity even for identical output')
  assert.match(id1, /^geometry:g2-/)
  const node1 = one.build().get(id1)
  const node2 = two.build().get(id2)
  assert.equal(node1.definition.kind, 'mesh')
  assert.equal(node2.definition.kind, 'mesh')
  assert.equal(JSON.stringify(node1.definition).includes('test.identity'), false)
  assert.deepEqual(node1.definition, node2.definition, 'renderer-facing baked geometry can remain byte-equivalent')
})
