import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  bundleResolvedWorldDocument,
  bundleWorldDocument,
  instantiateResolvedWorldDocument,
  resolveWorldDocumentImports,
  inspectAnyoObjectDocument,
  inspectWorldDocument,
  normalizeWorldDocument,
} from '../dist/esm/index.js'

function positions(document) {
  return normalizeWorldDocument(document).entities.map((entity) => entity.position)
}

function distanceXZ(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

function pointInPolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]
    const [xj, zj] = polygon[j]
    const intersects = ((zi > point[1]) !== (zj > point[1]))
      && (point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

test('Q3 rectangle scatter is deterministic, bounded, varied, and generated instances keep protected provenance', () => {
  const source = {
    version: '0.9',
    entities: [{
      id: 'grass', type: 'box', position: [10, 2, 30],
      scatter: {
        count: 120, seed: 4221,
        area: { type: 'rectangle', size: [18, 12] },
        variation: {
          position: { y: [-0.05, 0.05] },
          rotation: { y: [0, Math.PI * 2] },
          scale: { uniform: [0.75, 1.25] },
        },
      },
    }],
  }
  const first = normalizeWorldDocument(source)
  const second = normalizeWorldDocument(source)
  const changed = normalizeWorldDocument({ ...source, entities: [{ ...source.entities[0], scatter: { ...source.entities[0].scatter, seed: 4222 } }] })
  assert.equal(first.entities.length, 120)
  assert.deepEqual(first.entities.map((entity) => [entity.id, entity.position, entity.rotation, entity.scale]), second.entities.map((entity) => [entity.id, entity.position, entity.rotation, entity.scale]))
  assert.notDeepEqual(first.entities.map((entity) => entity.position), changed.entities.map((entity) => entity.position))
  for (const [index, entity] of first.entities.entries()) {
    assert.equal(entity.id, `grass:scatter:${index}`)
    assert.match(entity.__authoring.id, /#scatter:/)
    assert.equal(entity.__authoring.generatedIndex, index)
    assert.equal(entity.__authoring.editable, false)
    assert.ok(Math.abs(entity.position[0] - 10) <= 9 + 1e-9)
    assert.ok(Math.abs(entity.position[2] - 30) <= 6 + 1e-9)
    assert.ok(entity.position[1] >= 1.95 && entity.position[1] <= 2.05)
  }
})

test('Q3 circle and polygon scatter stay inside their declared parent-local XZ regions', () => {
  const circle = normalizeWorldDocument({
    version: '0.9',
    entities: [{ id: 'circle', type: 'box', scatter: { count: 200, seed: 17, area: { type: 'circle', radius: 4 } } }],
  })
  assert.equal(circle.entities.length, 200)
  assert.ok(circle.entities.every((entity) => entity.position[0] ** 2 + entity.position[2] ** 2 <= 16 + 1e-9))

  const polygon = [[-5, -4], [6, -3], [7, 5], [-4, 6]]
  const poly = normalizeWorldDocument({
    version: '0.9',
    entities: [{ id: 'poly', type: 'box', scatter: { count: 200, seed: 18, area: { type: 'polygon', points: polygon } } }],
  })
  assert.equal(poly.entities.length, 200)
  assert.ok(poly.entities.every((entity) => pointInPolygon([entity.position[0], entity.position[2]], polygon)))
})

test('Q3 minDistance uses final varied XZ origins and impossible densities fail deterministically', () => {
  const source = {
    version: '0.9',
    entities: [{
      id: 'rocks', type: 'sphere',
      scatter: {
        count: 120, seed: 99, area: { type: 'rectangle', size: [18, 12] }, minDistance: 0.35,
        variation: { position: { x: [-0.1, 0.1], z: [-0.1, 0.1] } },
      },
    }],
  }
  const normalized = normalizeWorldDocument(source)
  assert.equal(normalized.entities.length, 120)
  for (let i = 0; i < normalized.entities.length; i += 1) {
    for (let j = i + 1; j < normalized.entities.length; j += 1) {
      assert.ok(distanceXZ(normalized.entities[i].position, normalized.entities[j].position) >= 0.35 - 1e-9)
    }
  }
  const impossible = {
    version: '0.9',
    entities: [{ id: 'dense', type: 'box', scatter: { count: 100, seed: 1, area: { type: 'circle', radius: 0.25 }, minDistance: 0.2 } }],
  }
  assert.throws(() => normalizeWorldDocument(impossible), /ANYO_SCATTER_DENSITY_UNSATISFIABLE.*generated .* of 100.*6400 deterministic candidates/)
})

test('Q3 validation enforces area, seed, variation, exclusivity, surface, reusable-root, and World 0.9 boundaries', () => {
  const cases = [
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', scatter: { count: 0, area: { type: 'rectangle', size: [1, 1] } } }] }, 'ANYO_SCATTER_COUNT_INVALID'],
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', scatter: { count: 1, seed: 2 ** 40, area: { type: 'rectangle', size: [1, 1] } } }] }, 'ANYO_SCATTER_SEED_INVALID'],
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', scatter: { count: 1, minDistance: -1, area: { type: 'circle', radius: 1 } } }] }, 'ANYO_SCATTER_MIN_DISTANCE_INVALID'],
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', scatter: { count: 1, area: { type: 'rectangle', size: [0, 1] } } }] }, 'ANYO_SCATTER_RECTANGLE_SIZE_INVALID'],
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', scatter: { count: 1, area: { type: 'circle', radius: 0 } } }] }, 'ANYO_SCATTER_CIRCLE_RADIUS_INVALID'],
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', scatter: { count: 1, area: { type: 'polygon', points: [[0, 0], [1, 1], [0, 1], [1, 0]] } } }] }, 'ANYO_SCATTER_POLYGON_INVALID'],
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', repeat: { count: 2, axis: 'x', spacing: 1 }, scatter: { count: 1, area: { type: 'circle', radius: 1 } } }] }, 'ANYO_SCATTER_REPEAT_CONFLICT'],
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', surface: { room: 'r', wall: 'north' }, scatter: { count: 1, area: { type: 'circle', radius: 1 } } }] }, 'ANYO_SCATTER_SURFACE_UNSUPPORTED'],
    [{ version: '0.8', entities: [{ id: 'x', type: 'box', scatter: { count: 1, area: { type: 'circle', radius: 1 } } }] }, 'ANYO_SCATTER_REQUIRES_0_9'],
    [{ version: '0.9', prefabs: { p: { type: 'box', scatter: { count: 1, area: { type: 'circle', radius: 1 } } } }, entities: [{ id: 'p', use: 'p' }] }, 'ANYO_SCATTER_REUSABLE_ROOT_UNSUPPORTED'],
    [{ version: '0.9', compositions: { c: { scatter: { count: 1, area: { type: 'circle', radius: 1 } }, children: [] } }, entities: [{ id: 'c', composition: 'c' }] }, 'ANYO_SCATTER_REUSABLE_ROOT_UNSUPPORTED'],
    [{ version: '0.9', entities: [{ id: 'x', type: 'box', scatter: { count: 1, area: { type: 'circle', radius: 1 }, variation: { scale: { uniform: [1, 0.5] } } } }] }, 'SCATTER_VARIATION_RANGE_ORDER_INVALID'],
  ]
  for (const [document, code] of cases) {
    const result = inspectWorldDocument(document)
    assert.ok(result.errors.some((issue) => issue.code === code), `${code}: ${JSON.stringify(result.errors)}`)
  }
})

test('Q3 scatter composes with compositions while legacy repeat remains unchanged', () => {
  const world = {
    version: '0.9',
    compositions: { rock: { children: [{ id: 'body', type: 'sphere', radius: 0.5 }] } },
    entities: [
      { id: 'rocks', composition: 'rock', scatter: { count: 8, seed: 7, area: { type: 'rectangle', size: [4, 4] } } },
      { id: 'repeat', type: 'box', repeat: { count: 3, axis: 'x', spacing: 2 } },
    ],
  }
  const normalized = normalizeWorldDocument(world)
  assert.equal(normalized.entities.length, 11)
  assert.ok(normalized.entities.slice(0, 8).every((entity) => entity.type === 'group' && entity.children[0].id.endsWith('/body')))
  assert.deepEqual(normalized.entities.slice(8).map((entity) => entity.position), [[0, 0, 0], [2, 0, 0], [4, 0, 0]])
})

test('Q3 Object 0.1 rejects root scatter but allows scatter on ordinary root children', () => {
  const invalid = inspectAnyoObjectDocument({
    kind: 'anyo-object', version: '0.1',
    root: { scatter: { count: 2, area: { type: 'circle', radius: 1 } }, children: [] },
  })
  assert.ok(invalid.errors.some((issue) => issue.code === 'ANYO_OBJECT_ROOT_FIELD_INVALID'))
  const valid = inspectAnyoObjectDocument({
    kind: 'anyo-object', version: '0.1',
    root: { children: [{ id: 'detail', type: 'box', scatter: { count: 3, seed: 4, area: { type: 'rectangle', size: [2, 2] } } }] },
  })
  assert.equal(valid.valid, true, JSON.stringify(valid.errors))
})

test('Q3 imported native-object scatter is deterministic and bundling preserves standalone placement semantics', async () => {
  const ROOT = 'https://example.test/world/world.anyo.json'
  const OBJECT = 'https://example.test/world/models/rock.anyo.json'
  const root = {
    version: '0.9',
    imports: { rock: { src: './models/rock.anyo.json' } },
    entities: [{ id: 'rocks', composition: 'rock', scatter: { count: 12, seed: 44, area: { type: 'circle', radius: 5 }, minDistance: 0.4 } }],
  }
  const rock = { kind: 'anyo-object', version: '0.1', root: { children: [{ id: 'body', type: 'sphere', radius: 0.4 }] } }
  const loader = async ({ url }) => ({ document: structuredClone(url === OBJECT ? rock : root), documentUrl: url })
  const options = { sourceContext: { documentUrl: ROOT, baseUrl: 'https://example.test/world/' }, documentLoader: loader }
  const graph = await resolveWorldDocumentImports(root, options)
  const lowered = instantiateResolvedWorldDocument(graph)
  const bundled = bundleResolvedWorldDocument(graph)
  assert.equal('imports' in bundled, false)
  assert.ok(bundled.entities[0].scatter)
  const modular = normalizeWorldDocument(lowered, { sourceContext: graph.sourceContext })
  const standalone = normalizeWorldDocument(bundled)
  assert.deepEqual(modular.entities.map((entity) => [entity.id, entity.position]), standalone.entities.map((entity) => [entity.id, entity.position]))
  assert.ok(bundled.compositions['rock::root'])
  assert.ok(standalone.entities.every((entity) => entity.children[0].__authoring.sourceDocumentUrl === OBJECT))
  const again = await bundleWorldDocument(root, options)
  assert.deepEqual(standalone.entities.map((entity) => entity.position), positions(again))
})

test('Q3 published types and World 0.9 schema expose scatter while Object 0.1 root excludes it', async () => {
  const declarations = await readFile(new URL('../dist/types/core/types.d.ts', import.meta.url), 'utf8')
  assert.match(declarations, /export type ScatterAreaDefinition/)
  assert.match(declarations, /export interface EntityScatterDefinition/)
  assert.match(declarations, /scatter\?: EntityScatterDefinition/)
  const worldSchema = JSON.parse(await readFile(new URL('../schemas/world-0.9.schema.json', import.meta.url), 'utf8'))
  assert.deepEqual(worldSchema.$defs.entity.properties.scatter, { $ref: '#/$defs/scatter' })
  assert.equal(worldSchema.$defs.scatter.additionalProperties, false)
  const objectSchema = JSON.parse(await readFile(new URL('../schemas/object-0.1.schema.json', import.meta.url), 'utf8'))
  assert.ok(objectSchema.properties.root.allOf[1].not.anyOf.some((entry) => entry.required?.[0] === 'scatter'))
})
