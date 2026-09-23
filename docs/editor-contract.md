# Editor contract

Anyo 0.6 provides a renderer- and framework-independent authoring contract. It is suitable for Vue, React, plain DOM, CLI, testing, or other editor frontends, but none of those are required by Anyo.

## Create a session

```ts
import { createEditorSession } from '@blcklab/anyo/editor'

const editor = createEditorSession(world)
```

The world must already be loaded. Editor session state is not added to serialized JSON.

## Stable identity and provenance

An editable entity can carry `authoringId`. Compiled entities expose:

- runtime/compiler `id`
- stable `authoringId`
- JSON Pointer `sourcePath`
- optional prefab `templatePath` and `instancePath`
- optional repeat `generatedIndex`
- `editable` status

Generated repeated instances are intentionally protected from direct source mutation because one source repeat declaration can create many runtime instances.

## Selection and picking

```ts
const resolved = editor.selectPick(rendererPickResult)
console.log(resolved.target)
```

Anyo maps a picked compiled entity back to its authoring identity. Selection supports entities, primitives, rooms, and floors, while selection state stays outside world JSON.

## Hierarchy and bounds

```ts
const hierarchy = editor.getHierarchy()
const bounds = editor.getSelectionBounds()
```

Group bounds include compiled descendants and remain renderer-independent.

## Inspector definitions

```ts
const model = editor.getInspector(authoringId)
```

The model contains renderer-neutral sections and field definitions for identity, transforms, appearance, content, assets, materials, and behavior. Vue can generate property forms from these definitions without importing private compiler state. Identity fields are read-only; editing remains subject to normal Anyo validation and transactions.

## Create and clipboard operations

```ts
const created = await editor.create({ id: 'chair', type: 'box' })
const payload = editor.copy(created.authoringIds)
const pasted = await editor.paste(payload, { offset: [1, 0, 1] })
await editor.duplicate(pasted.authoringIds)
await editor.remove(pasted.authoringIds)
```

Clipboard payloads contain ordinary Anyo entity JSON and can be inspected, saved, or transferred by a host application. IDs are regenerated safely when pasted.

## Transform previews

```ts
editor.beginTransformPreview(authoringId, 'Move object')
await editor.updateTransformPreview(authoringId, { position: [2, 0, -1] })
await editor.updateTransformPreview(authoringId, { position: [2.2, 0, -1] })
await editor.commitTransformPreview()
```

Preview updates affect the compiled world and connected renderer but do not create intermediate history entries. Committing creates one forward/inverse operation entry. Canceling restores the original source and compiled state.

## Reparenting, grouping, and TRS limits

```ts
await editor.reparent(childAuthoringId, parentAuthoringId, { preserve: 'world' })
const group = await editor.group([firstId, secondId])
await editor.ungroup(group.authoringIds[0])
```

World-preserving operations use matrix inversion and decomposition. Anyo explicitly rejects `ANYO_EDITOR_TRANSFORM_SHEAR_UNREPRESENTABLE` when the resulting transform requires shear that cannot be represented by JSON position, Euler rotation, and scale. Cyclic parenting is rejected atomically.

## History

```ts
const history = world.getHistory()
await world.undo()
await world.redo()
```

History stores forward and inverse JSON operations rather than full before/after document snapshots.

## What remains outside Anyo

The frontend owns panels, dialogs, shortcuts, editor camera, grid state, gizmo visuals, asset-browser UI, and other presentation state. The future Vue editor will consume these public APIs rather than access private compiler or renderer objects.
