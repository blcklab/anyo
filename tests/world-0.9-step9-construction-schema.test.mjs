import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  GeometryValidationError,
  lowerArchitecture,
} from '../dist/esm/geometry/index.js'

const schema = JSON.parse(readFileSync(new URL('../schemas/world-0.9.schema.json', import.meta.url), 'utf8'))
const valid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-construction-kinds-valid.json', import.meta.url), 'utf8'))
const invalid = JSON.parse(readFileSync(new URL('./fixtures/world-0.9-construction-kinds-invalid.json', import.meta.url), 'utf8'))

const expectedTypes = [
  'wall', 'floor', 'ceiling', 'panel', 'column', 'beam', 'stairs', 'railing', 'trim', 'roof', 'doorOpening', 'windowOpening',
]

const expectedProperties = {
  wall: ['bevel', 'bevelSegments', 'from', 'height', 'id', 'openings', 'thickness', 'to', 'type'],
  floor: ['bevel', 'bevelSegments', 'id', 'position', 'rotation', 'size', 'thickness', 'type'],
  ceiling: ['bevel', 'bevelSegments', 'id', 'position', 'rotation', 'size', 'thickness', 'type'],
  panel: ['bevel', 'bevelSegments', 'id', 'position', 'rotation', 'size', 'thickness', 'type'],
  column: ['bevel', 'bevelSegments', 'height', 'id', 'position', 'radius', 'segments', 'shape', 'size', 'type'],
  beam: ['bevel', 'bevelSegments', 'depth', 'from', 'height', 'id', 'to', 'type'],
  stairs: ['bevel', 'bevelSegments', 'closedRisers', 'depth', 'height', 'id', 'landingDepth', 'position', 'riserThickness', 'rotationY', 'steps', 'treadThickness', 'type', 'width'],
  railing: ['height', 'id', 'includePosts', 'midRailHeight', 'path', 'postSpacing', 'postWidth', 'railRadius', 'railSegments', 'type'],
  trim: ['depth', 'id', 'path', 'profile', 'type', 'up', 'width'],
  roof: ['bevel', 'bevelSegments', 'id', 'kind', 'pitch', 'position', 'rotationY', 'size', 'thickness', 'type'],
  doorOpening: ['height', 'id', 'type', 'width'],
  windowOpening: ['height', 'id', 'sillHeight', 'type', 'width'],
}

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
    const count = branches.filter((errors) => errors.length === 0).length
    return count === 1 ? [] : [`${path}: expected exactly one oneOf branch, got ${count}`]
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
      for (let index = start; index < value.length; index += 1) {
        errors.push(...schemaErrors(value[index], definition.items, `${path}/${index}`, depth + 1))
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

test('World 0.9 construction schema discriminates the exact 12 rc.8 public construction types', () => {
  assert.deepEqual(Object.keys(valid), expectedTypes)
  assert.deepEqual(Object.keys(invalid), expectedTypes)
  const refs = schema.$defs.constructionDefinition.oneOf.map((entry) => entry.$ref)
  assert.equal(refs.length, expectedTypes.length)
  const types = refs.map((entry) => localRef(entry).properties.type.const)
  assert.deepEqual(types, expectedTypes)
})

test('every construction variant is strict and exposes only its audited public fields', () => {
  for (const entry of schema.$defs.constructionDefinition.oneOf) {
    const definition = localRef(entry.$ref)
    const type = definition.properties.type.const
    assert.equal(definition.type, 'object')
    assert.equal(definition.additionalProperties, false, `${type} must reject unknown parameters`)
    assert.equal(definition.required.includes('type'), true)
    assert.deepEqual(Object.keys(definition.properties).sort(), expectedProperties[type])
  }
})

test('wall opening schema strongly discriminates door and window openings', () => {
  const opening = schema.$defs.constructionWallOpening
  assert.equal(opening.oneOf.length, 2)
  const [door, window] = opening.oneOf
  assert.equal(door.properties.kind.const, 'door')
  assert.equal(window.properties.kind.const, 'window')
  assert.equal(door.additionalProperties, false)
  assert.equal(window.additionalProperties, false)
  assert.ok(window.required.includes('sillHeight'))
  assert.equal(schemaErrors({ kind: 'door', offset: 0, width: 1, height: 2, sillHeight: 1 }, opening).length > 0, true)
})

test('valid fixture for every public construction type satisfies the World 0.9 construction schema', () => {
  for (const type of expectedTypes) {
    const errors = schemaErrors(valid[type], schema.$defs.constructionDefinition)
    assert.deepEqual(errors, [], `${type}: ${errors.join('; ')}`)
  }
})

test('invalid fixture for every public construction type is rejected by the World 0.9 construction schema', () => {
  for (const type of expectedTypes) {
    const errors = schemaErrors(invalid[type], schema.$defs.constructionDefinition)
    assert.ok(errors.length > 0, `${type} invalid fixture unexpectedly satisfied constructionDefinition`)
  }
})

test('all valid construction fixtures lower through the unchanged architecture runtime', () => {
  for (const type of expectedTypes) {
    const assembly = lowerArchitecture(valid[type])
    assert.equal(assembly.type, type)
    assert.ok(Array.isArray(assembly.parts))
    assert.ok(Array.isArray(assembly.instanceGroups))
    assert.ok(Array.isArray(assembly.anchors))
  }
})

test('relationship and dynamic safety constraints remain semantic architecture checks', () => {
  const semanticInvalid = [
    { type: 'wall', from: [0, 0, 0], to: [4, 0, 0], height: 3, thickness: 0.2, openings: [
      { kind: 'door', offset: 1, width: 1.2, height: 2.2 },
      { kind: 'window', offset: 1.5, width: 1, height: 1, sillHeight: 1 },
    ] },
    { type: 'beam', from: [0, 0, 0], to: [3, 1, 0], height: 0.3, depth: 0.2 },
    { type: 'railing', path: { kind: 'line', points: [[0, 0, 0], [2, 0, 0]] }, height: 1, midRailHeight: 1 },
  ]
  for (const definition of semanticInvalid) {
    assert.deepEqual(schemaErrors(definition, schema.$defs.constructionDefinition), [], `${definition.type} should be structurally valid`)
    assert.throws(() => lowerArchitecture(definition), GeometryValidationError, definition.type)
  }
  const dynamicLimit = { type: 'stairs', width: 1, height: 1.5, steps: 4, depth: 2, closedRisers: true }
  assert.deepEqual(schemaErrors(dynamicLimit, schema.$defs.constructionDefinition), [])
  assert.throws(() => lowerArchitecture(dynamicLimit, { limits: { maxGeneratedInstances: 4 } }), GeometryValidationError)
})
