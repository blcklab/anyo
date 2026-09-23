# Migrating Anyo World Documents to 0.7

## Automatic migration

`migrateWorldDocument()` upgrades documents from 0.2, 0.3, 0.4, 0.5, or 0.6 to 0.7.

```ts
import { migrateWorldDocument } from '@blcklab/anyo'

const result = migrateWorldDocument(legacyDocument)
console.log(result.from, result.to, result.changes, result.warnings)
```

The migration:

- Sets `version` to `0.7`
- Adds `revision: 0` when absent
- Updates known schema URLs to `world-0.7.schema.json`
- Infers missing asset types and formats where possible
- Preserves known fields, IDs, authoring IDs, metadata, variables, components, prefabs, and extension namespaces
- Moves unknown legacy root fields to `extensions["anyo.legacyRoot"]` rather than discarding them
- Leaves existing interaction, collision, audio, and LOD declarations compatible

## New optional fields

Existing worlds do not need to add cameras, channels, requirements, rendering intent, events, snapshots, or asset metadata immediately.

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

Stable-ID transactions require the patch `baseRevision` to match the document revision. Successful transactions increase the revision monotonically.

## Extension migration

Extension code can register migration hooks through `ExtensionRegistry`. Package loading remains controlled by the host; package names found in JSON are never imported automatically.

## Compatibility

- Legacy JSON Pointer patch methods remain available.
- Existing public Anyo APIs remain available.
- Specialized physics, animation, audio, avatar, VFX, and hologram data remain owned by their packages.
- Existing renderer adapters can continue mounting worlds; unsupported new capabilities produce diagnostics or use fallback behavior.
