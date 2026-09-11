import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { createEditorSession } from '../dist/esm/editor/index.js'

function createEditorWorld(document) {
  const world = createWorld({ plugins: [entitiesPlugin()] })
  return world.load(document).then(() => ({ world, editor: createEditorSession(world, {
    createAuthoringId: (base) => `authoring:${base}:${Math.random().toString(36).slice(2, 7)}`,
  }) }))
}

function worldPosition(world, authoringId) {
  return world.compiled.entityByAuthoringId.get(authoringId).transform.position
}

test('compiled entities expose authoring provenance, hierarchy, and group bounds', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [{
      id: 'display', authoringId: 'display-authoring', type: 'group', position: [2, 0, 0],
      children: [
        { id: 'left', authoringId: 'left-authoring', type: 'box', position: [-1, 0, 0], size: [1, 2, 1] },
        { id: 'right', authoringId: 'right-authoring', type: 'box', position: [1, 0, 0], size: [1, 2, 1] },
      ],
    }],
  })
  const hierarchy = editor.getHierarchy()
  assert.equal(hierarchy.length, 1)
  assert.equal(hierarchy[0].authoringId, 'display-authoring')
  assert.equal(hierarchy[0].children.length, 2)
  const bounds = world.getEntityBounds('display-authoring')
  assert.deepEqual(bounds.center, [2, 0, 0])
  assert.deepEqual(bounds.size, [3, 2, 1])
  const primitive = world.compiled.primitives.find((item) => item.entityId === 'display/left')
  assert.equal(primitive.authoring.id, 'left-authoring')
  world.dispose()
})

test('transform previews update live state and create one operation history entry on commit', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [{ id: 'cube', authoringId: 'cube-authoring', type: 'box', position: [0, 0, 0] }],
  })
  editor.beginTransformPreview('cube-authoring', 'Move cube')
  await editor.updateTransformPreview('cube-authoring', { position: [2, 0, 0] })
  await editor.updateTransformPreview('cube-authoring', { position: [4, 0, 0] })
  assert.deepEqual(worldPosition(world, 'cube-authoring'), [4, 0, 0])
  assert.equal(world.getHistory().undo.length, 0)
  assert.equal(await editor.commitTransformPreview(), true)
  assert.equal(world.getHistory().undo.length, 1)
  assert.ok(world.getHistory().undo[0].operationCount >= 1)
  assert.equal(await world.undo(), true)
  assert.deepEqual(worldPosition(world, 'cube-authoring'), [0, 0, 0])
  assert.equal(await world.redo(), true)
  assert.deepEqual(worldPosition(world, 'cube-authoring'), [4, 0, 0])
  world.dispose()
})

test('canceling a transform preview restores the source and compiled world', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [{ id: 'cube', authoringId: 'cube-authoring', type: 'box', position: [1, 0, 0] }],
  })
  editor.beginTransformPreview('cube-authoring')
  await editor.updateTransformPreview('cube-authoring', { position: [8, 0, 0] })
  assert.deepEqual(worldPosition(world, 'cube-authoring'), [8, 0, 0])
  assert.equal(await editor.cancelTransformPreview(), true)
  assert.deepEqual(worldPosition(world, 'cube-authoring'), [1, 0, 0])
  assert.equal(world.canUndo, false)
  world.dispose()
})

test('reparent preserves world transforms and stable authoring selection identity', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [
      {
        id: 'left-parent', authoringId: 'left-parent-authoring', type: 'group', position: [5, 0, 0],
        children: [{ id: 'child', authoringId: 'child-authoring', type: 'box', position: [2, 0, 0] }],
      },
      { id: 'right-parent', authoringId: 'right-parent-authoring', type: 'group', position: [-3, 0, 0] },
    ],
  })
  assert.deepEqual(worldPosition(world, 'child-authoring'), [7, 0, 0])
  await editor.reparent('child-authoring', 'right-parent-authoring')
  assert.deepEqual(worldPosition(world, 'child-authoring'), [7, 0, 0])
  assert.deepEqual(world.getSourceDocument().entities[1].children[0].position, [10, 0, 0])
  assert.deepEqual(editor.getSelection(), [{ kind: 'entity', id: 'child-authoring' }])
  world.dispose()
})

test('copy, paste, duplicate, and remove use ordinary Anyo entity JSON', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [{ id: 'chair', authoringId: 'chair-authoring', type: 'box', position: [0, 0, 0] }],
  })
  const payload = editor.copy(['chair-authoring'])
  assert.equal(payload.kind, 'anyo/entities')
  const pasted = await editor.paste(payload, { offset: [2, 0, 0] })
  assert.equal(pasted.authoringIds.length, 1)
  assert.equal(world.getSourceDocument().entities.length, 2)
  const duplicate = await editor.duplicate(pasted.authoringIds, { offset: [2, 0, 0] })
  assert.equal(world.getSourceDocument().entities.length, 3)
  await editor.remove(duplicate.authoringIds)
  assert.equal(world.getSourceDocument().entities.length, 2)
  world.dispose()
})

test('group and ungroup preserve child world positions', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [
      { id: 'a', authoringId: 'a-authoring', type: 'box', position: [-2, 0, 0] },
      { id: 'b', authoringId: 'b-authoring', type: 'box', position: [2, 0, 0] },
    ],
  })
  const beforeA = worldPosition(world, 'a-authoring')
  const beforeB = worldPosition(world, 'b-authoring')
  const grouped = await editor.group(['a-authoring', 'b-authoring'])
  assert.deepEqual(worldPosition(world, 'a-authoring'), beforeA)
  assert.deepEqual(worldPosition(world, 'b-authoring'), beforeB)
  await editor.ungroup(grouped.authoringIds[0])
  assert.deepEqual(worldPosition(world, 'a-authoring'), beforeA)
  assert.deepEqual(worldPosition(world, 'b-authoring'), beforeB)
  world.dispose()
})

test('renderer picks resolve to authoring selection and generated repeat instances are protected', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [{
      id: 'product', authoringId: 'product-authoring', type: 'box',
      repeat: { count: 2, axis: 'x', spacing: 2 },
    }],
  })
  const generated = world.compiled.entities[0]
  const primitive = world.compiled.primitiveById.get(`entity:${generated.id}`)
  const resolved = editor.resolvePick({ primitiveId: primitive.id, entityId: generated.id })
  assert.equal(resolved.target.kind, 'entity')
  assert.equal(resolved.target.id, generated.authoringId)
  assert.throws(() => editor.copy([generated.authoringId]), /ANYO_EDITOR_TARGET_GENERATED/)
  world.dispose()
})

test('create inserts ordinary entity JSON, resolves duplicate IDs, and selects stable authoring identity', async () => {
  let authoringIndex = 0
  const world = createWorld({ plugins: [entitiesPlugin()] })
  await world.load({
    version: '0.6',
    entities: [{ id: 'cube', authoringId: 'existing-cube', type: 'box' }],
  })
  const editor = createEditorSession(world, {
    createAuthoringId: (base) => `created:${base}:${++authoringIndex}`,
  })
  const created = await editor.create({
    id: 'cube',
    type: 'group',
    children: [{ id: 'label', type: 'text', content: 'Hello' }],
  })
  assert.deepEqual(created.entityIds, ['cube-2'])
  assert.equal(created.authoringIds[0], 'created:cube-2:1')
  assert.equal(world.getSourceDocument().entities[1].children[0].authoringId, 'created:label:2')
  assert.deepEqual(editor.getSelection(), [{ kind: 'entity', id: 'created:cube-2:1' }])
  assert.equal(world.getHistory().undo.at(-1).label, 'Create cube-2')
  world.dispose()
})

test('reparent rejects hierarchy cycles atomically', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [{
      id: 'parent', authoringId: 'parent-authoring', type: 'group',
      children: [{ id: 'child', authoringId: 'child-authoring', type: 'group' }],
    }],
  })
  const before = world.serialize()
  await assert.rejects(
    editor.reparent('parent-authoring', 'child-authoring'),
    /ANYO_EDITOR_HIERARCHY_CYCLE/,
  )
  assert.equal(world.serialize(), before)
  assert.equal(world.canUndo, false)
  world.dispose()
})

test('world-preserving reparent rejects transforms that require shear', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [
      { id: 'scaled', authoringId: 'scaled-authoring', type: 'group', scale: [2, 1, 0.5] },
      { id: 'rotated', authoringId: 'rotated-authoring', type: 'box', rotation: [Math.PI / 6, 0, 0] },
    ],
  })
  const before = world.serialize()
  await assert.rejects(
    editor.reparent('rotated-authoring', 'scaled-authoring'),
    /ANYO_EDITOR_TRANSFORM_SHEAR_UNREPRESENTABLE/,
  )
  assert.equal(world.serialize(), before)
  assert.equal(world.canUndo, false)
  world.dispose()
})

test('inspector model exposes renderer-neutral field definitions for generated forms', async () => {
  const { world, editor } = await createEditorWorld({
    version: '0.6',
    entities: [{
      id: 'poster', authoringId: 'poster-authoring', type: 'image',
      position: [1, 2, 3], size: [2, 1], src: './poster.webp', visible: true,
      components: [{ type: 'anyo.interactable', action: 'open-poster' }],
    }],
  })
  const inspector = editor.getInspector('poster-authoring')
  assert.equal(inspector.authoringId, 'poster-authoring')
  assert.equal(inspector.type, 'image')
  assert.ok(inspector.sections.some((section) => section.id === 'transform'))
  const fields = inspector.sections.flatMap((section) => section.fields)
  assert.equal(fields.find((field) => field.path === '/position').kind, 'vec3')
  assert.equal(fields.find((field) => field.path === '/size').kind, 'vec2')
  assert.equal(fields.find((field) => field.path === '/src').kind, 'string')
  assert.equal(fields.find((field) => field.path === '/id').readOnly, true)
  world.dispose()
})
