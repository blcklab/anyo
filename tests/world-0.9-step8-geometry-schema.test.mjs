import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  GeometryValidationError,
  createGeometryCompiler,
} from '../dist/esm/geometry/index.js'

const schema = JSON.parse(readFileSync(new URL('../schemas/world-0.9.schema.json', import.meta.url), 'utf8'))
const valid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-geometry-kinds-valid.json', import.meta.url), 'utf8'))
const invalid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-geometry-kinds-invalid.json', import.meta.url), 'utf8'))

const expectedKinds = [
  'mesh', 'box', 'roundedBox', 'plane', 'sphere', 'cylinder', 'cone', 'capsule', 'disc', 'torus', 'polygon', 'lathe',
  'extrude', 'sweep', 'loft', 'pipeline', 'transform', 'mirror', 'noise', 'bend', 'twist', 'taper', 'union', 'subtract', 'intersect',
]

function localRef(ref) {
  assert.match(ref, /^#\/\$defs\//)
  const name = ref.slice('#/$defs/'.length)
  assert.ok(schema.$defs[name], `missing local schema ref ${name}`)
  return schema.$defs[name]
}

function schemaErrors(value, definition, path = '$', depth = 0) {
  if (depth > 128) return [`${path}: schema recursion exceeded test guard`]
  if (definition.$ref) return schemaErrors(value, localRef(definition.$ref), path, depth + 1)
  if (definition.oneOf) {
    const branches = definition.oneOf.map((entry) => schemaErrors(value, entry, path, depth + 1))
    const validBranches = branches.filter((errors) => errors.length === 0)
    return validBranches.length === 1 ? [] : [`${path}: expected exactly one oneOf branch, got ${validBranches.length}`]
  }
  if (definition.not && schemaErrors(value, definition.not, path, depth + 1).length === 0) return [`${path}: matched forbidden schema`]
  if ('const' in definition && !Object.is(value, definition.const)) return [`${path}: expected const ${JSON.stringify(definition.const)}`]
  if (definition.enum && !definition.enum.some((entry) => Object.is(entry, value))) return [`${path}: expected enum ${definition.enum.join(', ')}`]

  if (definition.type) {
    const ok = definition.type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
      : definition.type === 'array' ? Array.isArray(value)
      : definition.type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
      : definition.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : definition.type === 'string' ? typeof value === 'string'
      : definition.type === 'boolean' ? typeof value === 'boolean'
      : true
    if (!ok) return [`${path}: expected ${definition.type}`]
  }

  const errors = []
  if (typeof value === 'number') {
    if (definition.minimum !== undefined && value < definition.minimum) errors.push(`${path}: below minimum`)
    if (definition.maximum !== undefined && value > definition.maximum) errors.push(`${path}: above maximum`)
    if (definition.exclusiveMinimum !== undefined && value <= definition.exclusiveMinimum) errors.push(`${path}: below exclusiveMinimum`)
    if (definition.exclusiveMaximum !== undefined && value >= definition.exclusiveMaximum) errors.push(`${path}: above exclusiveMaximum`)
  }
  if (typeof value === 'string') {
    if (definition.minLength !== undefined && value.length < definition.minLength) errors.push(`${path}: shorter than minLength`)
    if (definition.pattern && !(new RegExp(definition.pattern)).test(value)) errors.push(`${path}: does not match pattern`)
  }
  if (Array.isArray(value)) {
    if (definition.minItems !== undefined && value.length < definition.minItems) errors.push(`${path}: too few items`)
    if (definition.maxItems !== undefined && value.length > definition.maxItems) errors.push(`${path}: too many items`)
    if (definition.prefixItems) {
      for (let index = 0; index < Math.min(value.length, definition.prefixItems.length); index += 1) {
        errors.push(...schemaErrors(value[index], definition.prefixItems[index], `${path}/${index}`, depth + 1))
      }
    }
    if (definition.items && typeof definition.items === 'object') {
      const start = definition.prefixItems?.length ?? 0
      for (let index = start; index < value.length; index += 1) errors.push(...schemaErrors(value[index], definition.items, `${path}/${index}`, depth + 1))
      if (!definition.prefixItems) for (let index = 0; index < Math.min(start, value.length); index += 1) void index
      if (!definition.prefixItems) {
        errors.length = errors.length // keep branch explicit for readability
        for (let index = 0; index < value.length; index += 1) {
          // items applies to every entry when prefixItems is absent; entries were not validated above.
          if (start === 0) {
            const entryErrors = schemaErrors(value[index], definition.items, `${path}/${index}`, depth + 1)
            // Avoid double-validation: the loop above already covered start=0.
            if (entryErrors.length && false) errors.push(...entryErrors)
          }
        }
      }
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = definition.properties ?? {}
    for (const key of definition.required ?? []) if (!(key in value)) errors.push(`${path}: missing required ${key}`)
    for (const [key, child] of Object.entries(properties)) if (key in value) errors.push(...schemaErrors(value[key], child, `${path}/${key}`, depth + 1))
    for (const key of Object.keys(value)) {
      if (key in properties) continue
      if (definition.additionalProperties === false) errors.push(`${path}/${key}: additional property not allowed`)
      else if (definition.additionalProperties && typeof definition.additionalProperties === 'object') errors.push(...schemaErrors(value[key], definition.additionalProperties, `${path}/${key}`, depth + 1))
    }
  }
  return errors
}

test('World 0.9 geometry schema discriminates the exact 25 built-in geometry kinds including the generic operator pipeline', () => {
  assert.deepEqual([...BUILTIN_GEOMETRY_KIND_NAMES], expectedKinds)
  assert.deepEqual(Object.keys(valid), expectedKinds)
  assert.deepEqual(Object.keys(invalid), expectedKinds)

  const refs = schema.$defs.geometryDefinition.oneOf.map((entry) => entry.$ref)
  assert.equal(refs.length, expectedKinds.length)
  const kinds = refs.map((entry) => localRef(entry).properties.kind.const)
  assert.deepEqual(kinds, expectedKinds)
})

test('every built-in geometry variant is strict and carries the shared surface authoring contract', () => {
  for (const entry of schema.$defs.geometryDefinition.oneOf) {
    const definition = localRef(entry.$ref)
    assert.equal(definition.type, 'object')
    assert.equal(definition.additionalProperties, false, `${definition.properties.kind.const} must reject unknown parameters`)
    assert.equal(definition.required.includes('kind'), true)
    assert.deepEqual(definition.properties.quality, { $ref: '#/$defs/geometryQuality' })
    assert.deepEqual(definition.properties.normals, { $ref: '#/$defs/geometryNormalPolicy' })
    assert.deepEqual(definition.properties.uv, { $ref: '#/$defs/geometryUvPolicy' })
    assert.deepEqual(definition.properties.tangents, { type: 'boolean' })
  }
})

test('valid fixture for every built-in kind satisfies the World 0.9 geometry schema', () => {
  for (const kind of expectedKinds) {
    const errors = schemaErrors(valid[kind], schema.$defs.geometryDefinition)
    assert.deepEqual(errors, [], `${kind}: ${errors.join('; ')}`)
  }
})

test('invalid fixture for every built-in kind is rejected by the World 0.9 geometry schema', () => {
  for (const kind of expectedKinds) {
    const errors = schemaErrors(invalid[kind], schema.$defs.geometryDefinition)
    assert.ok(errors.length > 0, `${kind} invalid fixture unexpectedly satisfied geometryDefinition`)
  }
})

test('valid schema fixtures normalize and compile through the unchanged geometry runtime', () => {
  const compiler = createGeometryCompiler({ cache: false })
  for (const kind of expectedKinds) {
    const normalized = compiler.normalize(valid[kind])
    assert.equal(normalized.kind, kind)
    const mesh = compiler.compile(valid[kind])
    assert.ok(mesh.positions.length >= 9, `${kind} must compile a non-empty mesh`)
    assert.ok(mesh.indices.length >= 3, `${kind} must compile indexed triangles`)
  }
})

test('World 0.9 pipeline schema accepts the complete universal Step 3 operator vocabulary and rejects malformed descriptors', () => {
  const validOperators = [
    { kind: 'transform', position: [1, 2, 3] },
    { kind: 'taper', axis: 'y', startScale: 1, endScale: 0.5 },
    { kind: 'twist', axis: 'z', angle: 0.5 },
    { kind: 'bend', axis: 'y', direction: 'x', angle: 0.75 },
    { kind: 'mirror', axis: 'x', offset: 1, includeOriginal: false },
    { kind: 'noise', seed: 42, frequency: 1.5, strength: 0.1, octaves: 3, lacunarity: 2, persistence: 0.5, offset: [0, 0, 0] },
    { kind: 'displace', field: { kind: 'noise', seed: 7, frequency: 2 }, strength: 0.2, direction: 'normal' },
    { kind: 'array', count: 4, offset: [1, 0, 0], rotationOffset: [0, 0.1, 0], scale: [1, 1, 1] },
    { kind: 'weld', tolerance: 0.000001 },
  ]
  for (const operator of validOperators) {
    assert.deepEqual(schemaErrors(operator, schema.$defs.geometryOperator), [], operator.kind)
  }

  const invalidOperators = [
    { kind: 'bend', axis: 'q' },
    { kind: 'mirror', includeOriginal: 'yes' },
    { kind: 'noise', octaves: 17 },
    { kind: 'noise', persistence: 1.1 },
    { kind: 'displace', strength: 0.1 },
    { kind: 'displace', field: { kind: 'constant', value: 1 }, direction: 'q' },
    { kind: 'array', count: 0, offset: [1, 0, 0] },
    { kind: 'array', count: 2 },
    { kind: 'array', count: 2, offset: [1, 0, 0], scale: [1, 0, 1] },
    { kind: 'weld', tolerance: 0 },
  ]
  for (const operator of invalidOperators) {
    assert.ok(schemaErrors(operator, schema.$defs.geometryOperator).length > 0, `${operator.kind} malformed operator unexpectedly passed`)
  }
})

test('cross-field and topology constraints remain semantic/compiler checks rather than guessed schema rules', () => {
  const compiler = createGeometryCompiler({ cache: false })
  const semanticInvalid = [
    { kind: 'capsule', radius: 1, height: 1 },
    { kind: 'polygon', points: [[0,0],[2,2],[0,2],[2,0]] },
    { kind: 'lathe', profile: [[0.5,1],[0.5,0]] },
    { kind: 'extrude', profile: { points: [[0,0],[1,0],[0,1]] }, depth: 0.2, bevel: { size: 0.11 } },
    { kind: 'sweep', profile: { points: [[0,0],[1,0],[0,1]] }, path: { kind: 'polyline', points: [[0,0,0],[1,0,0],[1,1,0]], closed: true, segments: 3 }, cap: true },
    { kind: 'bend', source: { kind: 'box' }, axis: 'y', direction: 'y', angle: 0.5 },
    { kind: 'taper', source: { kind: 'box' }, startScale: 0, endScale: 0 },
  ]
  for (const definition of semanticInvalid) {
    assert.throws(() => compiler.normalize(definition), GeometryValidationError, definition.kind)
  }
})
