import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { createWorldSchema, inspectWorldDocument, normalizeWorldDocument } from '../dist/esm/schema/index.js'
import { migrateWorldDocument } from '../dist/esm/migrations/index.js'

const schema08Url = new URL('../schemas/world-0.8.schema.json', import.meta.url)
const schema09Url = new URL('../schemas/world-0.9.schema.json', import.meta.url)

class MockCamera {
  getPosition() { return [0, 1.65, 0] }
  setPosition() {}
  getRotation() { return [0, 0] }
  setRotation() {}
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class MockRenderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new MockCamera()
  mounted = null
  async mount(compiled) { this.mounted = compiled }
  async applyChanges(_changes, compiled) { this.mounted = compiled }
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

function baseline(version) {
  return {
    version,
    units: 'meters',
    materials: { graphite: { baseColor: '#20242b', roughness: 0.65 } },
    geometries: { desk: { kind: 'roundedBox', size: [5.4, 1.05, 1.1], radius: 0.08, segments: 4 } },
    compositions: { pair: { children: [{ id: 'left', type: 'geometry', geometry: 'desk', material: 'graphite' }] } },
    entities: [{ id: 'desk-a', type: 'geometry', geometry: 'desk', material: 'graphite' }],
  }
}

test('World 0.8 schema remains available with its original identity and version pattern', async () => {
  const schema08 = JSON.parse(await readFile(schema08Url, 'utf8'))
  assert.equal(schema08.$id, 'https://anyo.blcklab.dev/schemas/world-0.8.schema.json')
  assert.equal(schema08.title, 'Anyo World 0.8')
  assert.equal(schema08.properties.version.pattern, '^0\\.8(?:\\.|$)')
})

test('World 0.9 keeps the 0.8 baseline outside explicitly approved authoring additions', async () => {
  const schema08 = JSON.parse(await readFile(schema08Url, 'utf8'))
  const schema09 = JSON.parse(await readFile(schema09Url, 'utf8'))
  assert.equal(schema09.$id, 'https://anyo.blcklab.dev/schemas/world-0.9.schema.json')
  assert.equal(schema09.title, 'Anyo World 0.9')
  assert.equal(schema09.properties.version.pattern, '^0\\.9(?:\\.|$)')
  const normalize = (schema, world09 = false) => {
    const copy = structuredClone(schema)
    delete copy.$id
    delete copy.title
    delete copy.description
    copy.properties.version.pattern = '<version>'
    if (world09) {
      delete copy.$defs.entity.properties.instanceId
      delete copy.$defs.entity.properties.overrides
      delete copy.$defs.entity.properties.loading
      // Step 11: compositions are canonical and expose optional named parameters/arguments.
      delete copy.$defs.entity.properties.arguments
      delete copy.$defs.entity.dependentRequired
      if (copy.$defs.entity.properties.use) {
        delete copy.$defs.entity.properties.use.description
        delete copy.$defs.entity.properties.use.deprecated
      }
      if (copy.$defs.entity.properties.composition) delete copy.$defs.entity.properties.composition.description
      if (copy.$defs.composition?.properties) delete copy.$defs.composition.properties.parameters
      delete copy.$defs.compositionParameterValue
      delete copy.$defs.compositionParameterDefinition
      if (copy.properties.prefabs) {
        delete copy.properties.prefabs.description
        delete copy.properties.prefabs.deprecated
      }
      if (copy.properties.compositions) copy.properties.compositions.description = schema08.properties.compositions.description
      if (copy.$defs.prefab) delete copy.$defs.prefab.description
      if (copy.$defs.composition) copy.$defs.composition.description = schema08.$defs.composition.description
      copy.$defs.entity.anyOf = copy.$defs.entity.anyOf.filter((variant) => variant.required?.[0] !== 'composition')
      delete copy.$defs.exploration.properties.mode
      delete copy.$defs.exploration.properties.character
      delete copy.$defs.exploration.properties.spawn.properties.rotation
      delete copy.properties.imports
      delete copy.$defs.importDefinition
      // Step 10: standardized metadata + strict built-in authoring objects.
      copy.properties.metadata = structuredClone(schema08.properties.metadata)
      copy.properties.data = structuredClone(schema08.properties.data)
      delete copy.$defs.metadata
      for (const name of ['asset', 'audio', 'building', 'environment', 'exploration', 'floor', 'interaction', 'lod', 'material', 'opening', 'room', 'stair', 'trigger', 'visibility']) {
        copy.$defs[name].additionalProperties = schema08.$defs[name].additionalProperties
      }
      copy.$defs.asset.properties.options = structuredClone(schema08.$defs.asset.properties.options)
      copy.$defs.room.properties.data = structuredClone(schema08.$defs.room.properties.data)
      copy.$defs.entity.properties.data = structuredClone(schema08.$defs.entity.properties.data)
      copy.$defs.geometryDefinition = structuredClone(schema08.$defs.geometryDefinition)
      copy.$defs.constructionDefinition = structuredClone(schema08.$defs.constructionDefinition)
      // Final quality Q3: deterministic area scatter extends only the World 0.9 entity surface.
      delete copy.$defs.entity.properties.scatter
      for (const name of ['scatterArea', 'scatterVariation', 'scatter']) delete copy.$defs[name]
      // Final quality Q2: procedural vertex-color authoring extends only the World 0.9 geometry surface.
      for (const name of ['geometryVertexColorHex', 'geometryVertexColor', 'geometryVertexColorConstant', 'geometryVertexColorGradient', 'geometryVertexColorGradientStop', 'geometryVertexColorNoise']) delete copy.$defs[name]
      // Final quality Q1: spotlight authoring extends only the World 0.9 light surface.
      for (const name of ['entity', 'prefab', 'composition']) {
        const definition = copy.$defs[name]
        definition.properties.lightType = structuredClone(schema08.$defs[name].properties.lightType)
        delete definition.properties.direction
        delete definition.properties.innerCone
        delete definition.properties.outerCone
        delete definition.allOf
      }
      for (const name of [
        'geometryQuality', 'geometryNormalPolicy', 'geometryUvPolicy', 'geometryProfile', 'latheProfile', 'geometryExtrudeBevel', 'geometryCurve',
        'geometryBox', 'geometryRoundedBox', 'geometryPlane', 'geometrySphere', 'geometryCylinder', 'geometryCone', 'geometryCapsule', 'geometryDisc',
        'geometryTorus', 'geometryPolygon', 'geometryLathe', 'geometryExtrude', 'geometrySweep', 'geometrySweepProfileStation', 'geometryLoftSection', 'geometryLoft', 'geometryOperator', 'geometryOperatorTransform', 'geometryOperatorTaper', 'geometryOperatorTwist', 'geometryOperatorBend', 'geometryOperatorMirror', 'geometryOperatorNoise', 'geometryOperatorArray', 'geometryOperatorWeld', 'geometryPipeline', 'geometryTransform', 'geometryMirror', 'geometryNoise',
        'geometryBend', 'geometryTwist', 'geometryTaper', 'geometryUnion', 'geometrySubtract', 'geometryIntersect',
        'constructionWallOpening', 'constructionWall', 'constructionFloor', 'constructionCeiling', 'constructionPanel', 'constructionColumn',
        'constructionBeam', 'constructionStairs', 'constructionRailing', 'constructionTrim', 'constructionRoof', 'constructionDoorOpening',
        'constructionWindowOpening',
      ]) delete copy.$defs[name]
    }
    return copy
  }
  assert.deepEqual(normalize(schema09, true), normalize(schema08))
})

test('World 0.9 passes semantic validation and normalization with the existing 0.8 authoring surface', () => {
  const document = baseline('0.9')
  const validation = inspectWorldDocument(document)
  assert.equal(validation.valid, true, validation.errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  const normalized = normalizeWorldDocument(document)
  assert.equal(normalized.version, '0.9')
  assert.equal(normalized.entities[0].geometry, 'desk')
  assert.ok(normalized.compositions.pair)
})

test('World 0.9 migration is pass-through except for the stable default revision', () => {
  const document = baseline('0.9')
  const result = migrateWorldDocument(document)
  assert.equal(result.from, '0.9')
  assert.equal(result.to, '0.9')
  assert.equal(result.document.version, '0.9')
  assert.equal(result.document.revision, 0)
  assert.equal(result.changed, true)
  const second = migrateWorldDocument(result.document)
  assert.equal(second.changed, false)
  assert.deepEqual(second.changes, [])
})

test('createWorldSchema supports World 0.9 and keeps procedural definitions enabled', () => {
  const schema = createWorldSchema({ version: '0.9' })
  assert.equal(schema.$id, 'https://anyo.blcklab.dev/schemas/world-0.9.schema.json')
  assert.equal(schema.properties.version.pattern, '^0\\.9(?:\\.|$)')
  assert.ok(schema.properties.geometries)
  assert.ok(schema.$defs.geometryDefinition)
})

test('World.load compiles World 0.9 procedural resources through the established 0.8 runtime path', async () => {
  const renderer = new MockRenderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin()], autoResize: false })
  await world.load(baseline('0.9'))
  assert.equal(world.getSourceDocument().version, '0.9')
  assert.ok(world.compiled.resourceGraph)
  assert.equal(world.compiled.resourceGraph.list('geometry').length, 1)
  assert.equal(world.compiled.resourceGraph.list('material').length, 1)
  assert.equal(world.compiled.resourceGraph.list('instance').length, 1)
  world.dispose()
})
