import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorld, entitiesPlugin, inspectWorldDocument } from '../dist/esm/index.js'

const worldUrl = new URL('../examples/step-04-particles/world.anyo.json', import.meta.url)

test('Step 4 showcase compiles dust, rain, snow, embers, and fireflies through one generic anyo.vfx contract', async () => {
  const document = JSON.parse(await readFile(worldUrl, 'utf8'))
  const inspected = inspectWorldDocument(document, { mode: 'strict' })
  assert.equal(inspected.valid, true, JSON.stringify(inspected.errors))
  assert.deepEqual(document.entities.map((entity) => entity.id), ['dust', 'rain', 'snow', 'embers', 'fireflies'])
  for (const entity of document.entities) {
    assert.equal(entity.components.length, 1)
    assert.equal(entity.components[0].type, 'anyo.vfx')
    assert.equal(entity.components[0].preset, undefined, `${entity.id} must not depend on a semantic VFX preset`)
  }

  const runtime = createWorld({ plugins: [entitiesPlugin()], autoResize: false })
  await runtime.load(document)
  for (const id of ['dust', 'rain', 'snow', 'embers', 'fireflies']) {
    const component = runtime.compiled.entityById.get(id)?.components?.[0]
    assert.equal(component?.type, 'anyo.vfx')
    assert.equal(component?.data.effect, 'sprite-particles')
  }
})
