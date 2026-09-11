# Migrate world documents to 0.7

Use `migrateWorldDocument()` to upgrade an older supported document to the current schema. `world.load()` also migrates older documents as part of loading.

## Run the migration

```ts
import { migrateWorldDocument } from '@blcklab/anyo'

const result = migrateWorldDocument(legacyDocument)
console.log(result.from, result.to, result.changes, result.warnings)
```

Review `changes` and `warnings` before saving the result. Migration:

- Sets `version` to `0.7`
- Adds `revision: 0` when absent
- Updates known schema URLs to `world-0.7.schema.json`
- Infers missing asset types and formats where possible
- Preserves known fields, IDs, authoring IDs, metadata, variables, components, prefabs, and extension namespaces
- Moves unknown legacy root fields to `extensions["anyo.legacyRoot"]` rather than discarding them
- Leaves existing interaction, collision, audio, and LOD declarations compatible

## Optional additions

You can adopt cameras, channels, requirements, rendering settings, events, snapshots, and asset metadata as needed. Existing worlds do not need all of them.

A minimal 0.7 world remains:

```json
{
  "$schema": "https://anyo.blcklab.dev/schemas/world-0.7.schema.json",
  "version": "0.7",
  "revision": 0,
  "entities": []
}
```

## Stable revisions

For stable-ID transactions, `baseRevision` must match the document's current revision. Each successful transaction advances it, letting callers detect edits based on an older document.

## Extension migration

Register extension migration hooks through `ExtensionRegistry`. Your app loads the extension code; package names in JSON never trigger automatic imports.

## Compatibility

- Legacy JSON Pointer patch methods remain available.
- Existing public Anyo APIs remain available.
- Specialized physics, animation, audio, avatar, VFX, and hologram data remain owned by their packages.
- Existing renderer adapters can continue mounting worlds; unsupported new capabilities produce diagnostics or use fallback behavior.
