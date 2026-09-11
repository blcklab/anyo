# Editor APIs

Use `@blcklab/anyo/editor` to build selection, property panels, transform previews, and clipboard operations around a loaded world. The APIs work without a particular renderer or UI framework.

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

A repeat declaration can create many runtime instances. Detach an instance before editing it independently.

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

The inspector model describes fields for identity, transforms, appearance, content, assets, materials, and behavior. Use it to build property forms in your UI. Identity fields are read-only, and edits still use Anyo's validation and transactions.

## Create and clipboard operations

```ts
const created = await editor.create({ id: 'chair', type: 'box' })
const payload = editor.copy(created.authoringIds)
const pasted = await editor.paste(payload, { offset: [1, 0, 1] })
await editor.duplicate(pasted.authoringIds)
await editor.remove(pasted.authoringIds)
```

Clipboard payloads contain entity JSON that your app can inspect, save, or transfer. Pasting assigns new IDs.

## Transform previews

```ts
editor.beginTransformPreview(authoringId, 'Move object')
await editor.updateTransformPreview(authoringId, { position: [2, 0, -1] })
await editor.updateTransformPreview(authoringId, { position: [2.2, 0, -1] })
await editor.commitTransformPreview()
```

A preview updates the compiled world and renderer while the user drags. Committing adds one history entry; canceling restores the original source and compiled state.

## Reparenting, grouping, and TRS limits

```ts
await editor.reparent(childAuthoringId, parentAuthoringId, { preserve: 'world' })
const group = await editor.group([firstId, secondId])
await editor.ungroup(group.authoringIds[0])
```

Preserving world position can produce a transform that needs shear. Anyo reports `ANYO_EDITOR_TRANSFORM_SHEAR_UNREPRESENTABLE` if position, Euler rotation, and scale cannot represent it. Cyclic parenting is also rejected without applying the edit.

## History

```ts
const history = world.getHistory()
await world.undo()
await world.redo()
```

History stores forward and inverse JSON operations rather than full before/after document snapshots.

## UI responsibilities

Your editor owns panels, dialogs, shortcuts, camera controls, grids, gizmos, and asset browsing. Connect them through these public APIs and keep their UI state outside world JSON.
