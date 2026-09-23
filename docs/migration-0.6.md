# Migrating to Anyo 0.6

Anyo automatically migrates documents from 0.2 through 0.5 to 0.6 during `world.load()` and `migrateWorldDocument()`. Existing runtime, building, component, asset, and material semantics remain compatible.

## Version and schema

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.6.schema.json",
  "version": "0.6"
}
```

## Optional authoring IDs

No existing document must add `authoringId`. The compiler derives session-stable provenance when it is absent. Authoring tools should persist `authoringId` on directly editable entities so selection survives structural changes and recompilation.

```json
{
  "id": "chair",
  "authoringId": "authoring:chair:01",
  "type": "model",
  "asset": "chair-model"
}
```

## History behavior

History entries now store forward and inverse operations instead of complete document snapshots. Public `undo()`, `redo()`, `canUndo`, and `canRedo` behavior remains compatible. `world.getHistory()` exposes safe summaries.

## Editor package

Import the optional authoring APIs from `@blcklab/anyo/editor`. No Vue or DOM dependency was added. Runtime-only applications do not need this subpath.

## Generated entities

Repeated or prefab-generated runtime entities expose provenance. Repeated instances are protected from direct mutation until detached by an authoring workflow, preventing ambiguous edits to one instance of a mathematical source declaration.
