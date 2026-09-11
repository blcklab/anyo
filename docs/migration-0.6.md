# Changes introduced in world 0.6

World 0.6 added editor identity and operation-based history. This guide explains those changes; use the [world 0.7 migration guide](migrations/MIGRATION_WORLD_0.7.md) for current upgrades.

## Version and schema

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.6.schema.json",
  "version": "0.6"
}
```

## Optional authoring IDs

Existing documents do not need an `authoringId`. Editors should save one on directly editable entities so selection can survive structural changes and recompilation. Otherwise, the compiler derives identity for the current session.

```json
{
  "id": "chair",
  "authoringId": "authoring:chair:01",
  "type": "model",
  "asset": "chair-model"
}
```

## History behavior

History stores forward and inverse operations. The public `undo()`, `redo()`, `canUndo`, and `canRedo` APIs remain compatible, and `world.getHistory()` returns summaries.

## Editor package

Import authoring APIs from `@blcklab/anyo/editor`. They work without Vue or the DOM. See [editor APIs](editor-contract.md).

## Generated entities

Compiled entities expose their source and prefab provenance. Detach repeated instances before editing them independently, since one repeat declaration can generate many instances.
