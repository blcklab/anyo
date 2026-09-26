import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorld, entitiesPlugin, inspectWorldDocument, normalizeWorldDocument } from '../dist/esm/index.js'

const loadShowcase = async () => JSON.parse(await readFile(new URL('../examples/step-10-cloud-quality/world.anyo.json', import.meta.url), 'utf8'))

test('Step 10 cloud showcase validates as ordinary Anyo 0.8 content', async () => {
  const world = await loadShowcase()
  const result = inspectWorldDocument(world)
  assert.equal(result.errors.length, 0, result.errors.map(item => `${item.code}: ${item.message}`).join('\n'))
  assert.equal(world.version, '0.8')
  assert.equal(world.compositions['cumulus-mass'].children.length, 8)
  assert.deepEqual(Object.keys(world.geometries).sort(), ['cloud-large', 'cloud-medium', 'cloud-small'])
})

test('Step 10 uses generic geometry/composition vocabulary rather than cloud engine types', async () => {
  const world = await loadShowcase()
  const serialized = JSON.stringify(world)
  for (const forbidden of ['CloudRenderer', 'CloudEntity', 'CloudSystem', 'cloudSystem', 'cloudRenderer']) assert.equal(serialized.includes(forbidden), false)
  for (const geometry of Object.values(world.geometries)) {
    assert.equal(geometry.kind, 'noise')
    assert.equal(geometry.source.kind, 'lathe')
    assert.ok(geometry.source.profile.length >= 6)
    assert.equal(geometry.source.profile[0][1], 0)
  }
})

test('Step 10 authored cloud mass contains deliberate large medium small structure and cool flattened bases', async () => {
  const world = await loadShowcase()
  const children = world.compositions['cumulus-mass'].children
  const geometryUses = new Map()
  for (const child of children) geometryUses.set(child.geometry, (geometryUses.get(child.geometry) ?? 0) + 1)
  assert.ok((geometryUses.get('cloud-large') ?? 0) >= 2)
  assert.ok((geometryUses.get('cloud-medium') ?? 0) >= 3)
  assert.ok((geometryUses.get('cloud-small') ?? 0) >= 2)
  assert.ok(children.some(child => child.materialBindings?.startCap === 'cloud-base'))
  assert.ok(children.some(child => child.position?.[1] >= 2))
})

test('Step 10 drift reuses the existing generic animation property-track contract', async () => {
  const world = await loadShowcase()
  const cloudEntities = world.entities.filter(entity => entity.composition === 'cumulus-mass')
  assert.equal(cloudEntities.length, 3)
  for (const entity of cloudEntities) {
    const animation = entity.components?.find(component => component.type === 'anyo.animation')
    assert.ok(animation)
    assert.equal(animation.autoplay, true)
    assert.equal(animation.tracks.length, 1)
    const track = animation.tracks[0]
    assert.equal(track.target, 'transform.position')
    assert.equal(track.loop, 'repeat')
    assert.equal(track.easing, 'linear')
    assert.ok(track.duration >= 180)
  }
})

test('Step 10 composition normalization preserves shared cloud geometry references', async () => {
  const normalized = normalizeWorldDocument(await loadShowcase())
  const clouds = normalized.entities.filter(entity => entity.id.startsWith('cloud-'))
  assert.equal(clouds.length, 3)
  for (const cloud of clouds) {
    assert.equal(cloud.type, 'group')
    assert.equal(cloud.children.length, 8)
    assert.ok(cloud.children.every(child => typeof child.geometry === 'string'))
  }
})


test('Step 10 cloud instances reuse ResourceGraph geometry instead of baking unique meshes per cloud', async () => {
  const world = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await world.load(await loadShowcase())
  const graph = world.compiled.resourceGraph
  assert.ok(graph)
  const geometryNodes = graph.list('geometry')
  const noiseNodes = geometryNodes.filter(node => node.definition.kind === 'noise')
  const latheNodes = geometryNodes.filter(node => node.definition.kind === 'lathe')
  assert.equal(noiseNodes.length, 3)
  assert.equal(latheNodes.length, 3)
  const cloudInstances = graph.list('instance').filter(node => /^instance:cloud-(near|mid|high)\//.test(node.id))
  assert.equal(cloudInstances.length, 24)
  assert.ok(new Set(cloudInstances.map(node => node.source)).size <= 3)
  world.dispose()
})
