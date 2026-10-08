import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  BUILTIN_GEOMETRY_OPERATOR_NAMES,
  GeometryValidationError,
  applyGeometryOperator,
  compileGeometry,
  createGeometryCompiler,
} from '../dist/esm/geometry/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'

const source = { kind: 'roundedBox', size: [1.5, 3, 1], radius: 0.08, segments: 2 }
const modifiers = [
  { kind: 'taper', axis: 'y', startScale: 1, endScale: 0.55 },
  { kind: 'twist', axis: 'y', angle: 0.6 },
  { kind: 'transform', position: [1.25, 0.5, -0.75], rotation: [0.1, 0.2, -0.05], scale: [1.1, 0.9, 1.2] },
]
const pipeline = { kind: 'pipeline', source, modifiers }
const legacy = {
  kind: 'transform',
  source: {
    kind: 'twist',
    source: {
      kind: 'taper',
      source,
      axis: 'y', startScale: 1, endScale: 0.55,
    },
    axis: 'y', angle: 0.6,
  },
  position: [1.25, 0.5, -0.75], rotation: [0.1, 0.2, -0.05], scale: [1.1, 0.9, 1.2],
}

function plain(value) { return JSON.parse(JSON.stringify(value)) }

function meshSnapshot(mesh) {
  return {
    positions: [...mesh.positions],
    indices: [...mesh.indices],
    normals: mesh.normals ? [...mesh.normals] : undefined,
    uvs: mesh.uvs ? [...mesh.uvs] : undefined,
    tangents: mesh.tangents ? [...mesh.tangents] : undefined,
    bounds: mesh.bounds,
  }
}

test('universal geometry step 2 registers one generic pipeline and the minimal operator set', () => {
  assert.ok(BUILTIN_GEOMETRY_KIND_NAMES.includes('pipeline'))
  assert.deepEqual([...BUILTIN_GEOMETRY_OPERATOR_NAMES], ['transform', 'taper', 'twist'])
  for (const semantic of ['tree', 'road', 'building', 'stair', 'cloud']) assert.ok(!BUILTIN_GEOMETRY_KIND_NAMES.includes(semantic))
})

test('pipeline normalization produces source-free canonical operator descriptors with defaults', () => {
  const normalized = createGeometryCompiler().normalize({
    kind: 'pipeline',
    source: { kind: 'box' },
    modifiers: [{ kind: 'taper' }, { kind: 'twist' }, { kind: 'transform' }],
  })
  assert.equal(normalized.kind, 'pipeline')
  assert.deepEqual(plain(normalized.source), { kind: 'box', size: [1, 1, 1] })
  assert.deepEqual(plain(normalized.modifiers), [
    { kind: 'taper', axis: 'y', startScale: 1, endScale: 1 },
    { kind: 'twist', axis: 'y', angle: 0 },
    { kind: 'transform', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ])
  assert.ok(normalized.modifiers.every(operator => !('source' in operator)))
})

test('ordered pipeline output is byte-for-byte compatible with equivalent legacy nested modifiers', () => {
  const pipelineMesh = compileGeometry(pipeline, { cache: false })
  const legacyMesh = compileGeometry(legacy, { cache: false })
  assert.deepEqual(meshSnapshot(pipelineMesh), meshSnapshot(legacyMesh))
})

test('modifier order participates in deterministic geometry identity and execution', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const first = {
    kind: 'pipeline', source,
    modifiers: [
      { kind: 'transform', rotation: [0.5, 0, 0] },
      { kind: 'twist', axis: 'y', angle: 0.8 },
    ],
  }
  const second = {
    kind: 'pipeline', source,
    modifiers: [...first.modifiers].reverse(),
  }
  assert.notEqual(compiler.keyFor(first), compiler.keyFor(second))
  assert.notDeepEqual([...compiler.compile(first).positions], [...compiler.compile(second).positions])
  assert.equal(compiler.keyFor(first), compiler.keyFor(structuredClone(first)))
})

test('applyGeometryOperator applies one operator without mutating the input mesh', () => {
  const mesh = compileGeometry({ kind: 'box', size: [2, 2, 2] }, { cache: false })
  const before = [...mesh.positions]
  const moved = applyGeometryOperator(mesh, { kind: 'transform', position: [3, 0, 0] }, { cache: false })
  assert.deepEqual([...mesh.positions], before)
  assert.deepEqual(mesh.bounds.min, [-1, -1, -1])
  assert.deepEqual(moved.bounds.min, [2, -1, -1])
  assert.deepEqual(moved.bounds.max, [4, 1, 1])
})

test('explicitly registered custom operators participate in the same pipeline without becoming core kinds', () => {
  const lift = {
    kind: 'step2Lift',
    normalize(operator) {
      const amount = operator.amount ?? 1
      if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new TypeError('amount must be finite')
      return { kind: 'step2Lift', amount }
    },
    apply(mesh, operator) {
      const positions = new Float32Array(mesh.positions)
      for (let index = 1; index < positions.length; index += 3) positions[index] += operator.amount
      return {
        positions,
        indices: mesh.indices,
        ...(mesh.normals ? { normals: mesh.normals } : {}),
        ...(mesh.uvs ? { uvs: mesh.uvs } : {}),
        ...(mesh.tangents ? { tangents: mesh.tangents } : {}),
        ...(mesh.colors ? { colors: mesh.colors } : {}),
        ...(mesh.groups ? { groups: mesh.groups } : {}),
      }
    },
  }
  const compiler = createGeometryCompiler({ cache: false, operators: [lift] })
  const mesh = compiler.compile({ kind: 'pipeline', source: { kind: 'box' }, modifiers: [{ kind: 'step2Lift', amount: 2.5 }] })
  assert.deepEqual(mesh.bounds.min, [-0.5, 2, -0.5])
  assert.deepEqual(mesh.bounds.max, [0.5, 3, 0.5])
  assert.ok(!BUILTIN_GEOMETRY_KIND_NAMES.includes('step2Lift'))
  assert.ok(!BUILTIN_GEOMETRY_OPERATOR_NAMES.includes('step2Lift'))
})

test('unknown operators fail cleanly and operator stacks obey maxModifierDepth', () => {
  const compiler = createGeometryCompiler({ cache: false, limits: { maxModifierDepth: 2 } })
  assert.throws(
    () => compiler.compile({ kind: 'pipeline', source: { kind: 'box' }, modifiers: [{ kind: 'unknownModifier' }] }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_OPERATOR_UNSUPPORTED'),
  )
  assert.doesNotThrow(() => compiler.compile({
    kind: 'pipeline', source: { kind: 'box' }, modifiers: [{ kind: 'transform' }, { kind: 'twist' }],
  }))
  assert.throws(
    () => compiler.compile({
      kind: 'pipeline', source: { kind: 'box' }, modifiers: [{ kind: 'transform' }, { kind: 'twist' }, { kind: 'taper' }],
    }),
    error => error instanceof GeometryValidationError && error.issues.some(issue => issue.code === 'GEOMETRY_MODIFIER_LIMIT'),
  )
})

test('ResourceGraph tracks pipeline source geometry once; source-free operators do not become resource nodes', () => {
  const builder = createResourceGraphBuilder()
  const pipelineId = builder.addGeometry(pipeline)
  const graph = builder.build()
  const geometries = graph.list('geometry')
  assert.equal(geometries.length, 2)
  const pipelineNode = graph.get(pipelineId)
  assert.equal(pipelineNode.definition.kind, 'pipeline')
  assert.equal(pipelineNode.dependencies.length, 1)
  const sourceNode = graph.get(pipelineNode.dependencies[0])
  assert.equal(sourceNode.kind, 'geometry')
  assert.equal(sourceNode.definition.kind, 'roundedBox')
})
