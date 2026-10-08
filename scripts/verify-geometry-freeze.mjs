import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(await readFile(path.join(root, 'docs/geometry-freeze-contract.json'), 'utf8'))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const geometry = await import(pathToFileURL(path.join(root, 'dist/esm/geometry/index.js')).href)

assert.equal(contract.contractVersion, 1, 'Geometry freeze contract version must remain explicit.')
assert.equal(geometry.GEOMETRY_BUILD_ABI, contract.geometryBuildAbi, 'Geometry build ABI drifted from the freeze contract.')
assert.deepEqual([...geometry.BUILTIN_GEOMETRY_KIND_NAMES], contract.builtInGeometryKinds, 'Built-in geometry kind vocabulary drifted from the freeze contract.')
assert.deepEqual([...geometry.BUILTIN_GEOMETRY_OPERATOR_NAMES], contract.builtInOperators, 'Built-in geometry operator vocabulary drifted from the freeze contract.')
assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'Anyo Core must remain zero-runtime-dependency at the geometry freeze boundary.')
assert.ok(pkg.scripts?.check?.includes('verify:geometry-freeze'), 'npm run check must include the geometry freeze gate.')

const world09 = JSON.parse(await readFile(path.join(root, 'schemas/world-0.9.schema.json'), 'utf8'))
assert.deepEqual(collectKindConsts(world09.$defs.geometryCurveDefinition), [...contract.curveKinds].sort(), 'Curve authoring vocabulary drifted from the freeze contract.')
assert.deepEqual(collectKindConsts(world09.$defs.geometryScalarFieldDefinition), [...contract.scalarFieldKinds].sort(), 'Scalar-field vocabulary drifted from the freeze contract.')

for (const [relative, expected] of Object.entries(contract.schemaCheckpoints)) {
  assert.equal(await sha256(path.join(root, relative)), expected, `${relative} changed from the long-term geometry freeze checkpoint.`)
}
assert.equal(await sha256(path.join(root, contract.showcaseCheckpoint.path)), contract.showcaseCheckpoint.sha256, 'Universal geometry showcase changed from the freeze checkpoint.')

const freezeDoc = await readFile(path.join(root, 'docs/GEOMETRY-LONG-TERM-FREEZE.md'), 'utf8')
const normalizedFreezeDoc = freezeDoc.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
for (const deferred of contract.deferredSubsystems) {
  const readable = deferred.replaceAll('-', ' ')
  assert.ok(normalizedFreezeDoc.includes(readable), `Freeze documentation must name deferred subsystem: ${deferred}`)
}
for (const token of ['Compose existing geometry', 'Use the operator stack', 'Use arbitrary indexed mesh', 'Use a trusted namespaced extension', 'Reopen Core only for a fundamental missing capability']) {
  assert.ok(freezeDoc.includes(token), `Freeze documentation is missing decision rule: ${token}`)
}

console.log(`Verified Universal Geometry Freeze contract v${contract.contractVersion}: ${contract.builtInGeometryKinds.length} built-in kinds, ${contract.builtInOperators.length} operators, ABI ${contract.geometryBuildAbi}.`)

function collectKindConsts(node) {
  const out = new Set()
  visit(node)
  return [...out].sort()
  function visit(value) {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (!value || typeof value !== 'object') return
    if (typeof value.properties?.kind?.const === 'string') out.add(value.properties.kind.const)
    if (Array.isArray(value.properties?.kind?.enum)) for (const kind of value.properties.kind.enum) if (typeof kind === 'string') out.add(kind)
    for (const entry of Object.values(value)) visit(entry)
  }
}

async function sha256(file) {
  const bytes = await readFile(file)
  return createHash('sha256').update(bytes).digest('hex')
}
