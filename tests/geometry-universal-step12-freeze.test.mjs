import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  BUILTIN_GEOMETRY_OPERATOR_NAMES,
  GEOMETRY_BUILD_ABI,
} from '../dist/esm/geometry/index.js'

const root = new URL('../', import.meta.url)
const contract = JSON.parse(await readFile(new URL('docs/geometry-freeze-contract.json', root), 'utf8'))

const hash = async (relative) => createHash('sha256').update(await readFile(new URL(relative, root))).digest('hex')

function collectKindConsts(node) {
  const out = new Set()
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    if (typeof value.properties?.kind?.const === 'string') out.add(value.properties.kind.const)
    if (Array.isArray(value.properties?.kind?.enum)) for (const kind of value.properties.kind.enum) if (typeof kind === 'string') out.add(kind)
    Object.values(value).forEach(visit)
  }
  visit(node)
  return [...out].sort()
}

test('Universal Geometry Step 12: build ABI and built-in geometry vocabulary match the frozen contract', () => {
  assert.equal(GEOMETRY_BUILD_ABI, contract.geometryBuildAbi)
  assert.deepEqual([...BUILTIN_GEOMETRY_KIND_NAMES], contract.builtInGeometryKinds)
  assert.deepEqual([...BUILTIN_GEOMETRY_OPERATOR_NAMES], contract.builtInOperators)
})

test('Universal Geometry Step 12: reusable curve and scalar-field vocabularies match the frozen World 0.9 contract', async () => {
  const schema = JSON.parse(await readFile(new URL('schemas/world-0.9.schema.json', root), 'utf8'))
  assert.deepEqual(collectKindConsts(schema.$defs.geometryCurveDefinition), [...contract.curveKinds].sort())
  assert.deepEqual(collectKindConsts(schema.$defs.geometryScalarFieldDefinition), [...contract.scalarFieldKinds].sort())
})

test('Universal Geometry Step 12: World schema checkpoints and showcase proof remain byte-stable', async () => {
  for (const [relative, expected] of Object.entries(contract.schemaCheckpoints)) assert.equal(await hash(relative), expected, relative)
  assert.equal(await hash(contract.showcaseCheckpoint.path), contract.showcaseCheckpoint.sha256)
})

test('Universal Geometry Step 12: long-term decision order prioritizes composition and escape hatches before Core', () => {
  assert.deepEqual(contract.coreReopenOrder, [
    'compose-existing',
    'operator-stack',
    'arbitrary-mesh',
    'trusted-extension',
    'core-only-if-fundamental',
  ])
  assert.deepEqual(contract.escapeHatches, ['mesh', 'namespaced-extension'])
})

test('Universal Geometry Step 12: heavyweight modeling subsystems remain explicitly deferred', () => {
  assert.deepEqual(contract.deferredSubsystems, [
    'sdf-implicit-modeling',
    'marching-cubes',
    'surface-nets',
    'voxel-geometry',
    'advanced-remeshing',
    'sculpting',
    'gpu-procedural-meshing',
    'cad-level-modeling',
  ])
})
