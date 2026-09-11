# Changes introduced in world 0.3.1

This guide records the 0.3.1 changes for older integrations. For a current upgrade, use the [world 0.7 migration guide](migrations/MIGRATION_WORLD_0.7.md).

## Renderer change

To switch an older app from Three.js to Sekai64, replace:

```ts
import { ThreeRenderer } from '@blcklab/anyo/renderer-three'
```

with:

```ts
import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'
```

The original 0.3.1 integration used Sekai64 `^0.6.0`. Current package versions are covered in [Sekai64 setup](sekai64.md). The Three.js adapter remains available.

## Schema

The 0.3.1 document header was:

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.3.1.schema.json",
  "version": "0.3.1"
}
```

## Attachment validation

An attachment with no geometric overlap throws `ANYO_ATTACHMENT_OVERLAP_INVALID`. Positive `gap` values intentionally preserve walls and do not create an automatic portal.

## Door updates

Door primitives and colliders gained stable identities. Changing `open` updates door visibility, portal state, and collider state incrementally.

## Security

Path APIs reject prototype-related segments and malformed JSON Pointer escapes. If older code read inherited properties through these paths, move the values to own properties.
