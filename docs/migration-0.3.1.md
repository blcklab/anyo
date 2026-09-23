> Historical migration note. Anyo 0.4 now migrates 0.2 and 0.3 documents directly to 0.4. See `migration-0.4.md`.

# Migrating to 0.3.1

Version `0.2` and `0.3` documents migrate automatically to `0.3.1`. Unknown extension data is preserved.

## Renderer change

Replace:

```ts
import { ThreeRenderer } from '@blcklab/anyo/renderer-three'
```

with:

```ts
import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'
```

Install `@blcklab/sekai64@^0.6.0` as an application dependency. Three.js is no longer used by production examples, but the adapter remains available.

## Schema

Update `$schema` and version:

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.3.1.schema.json",
  "version": "0.3.1"
}
```

## Attachment validation

An attachment with no geometric overlap now throws `ANYO_ATTACHMENT_OVERLAP_INVALID`. Positive `gap` values intentionally preserve walls and do not create an automatic portal.

## Door updates

Door primitives and colliders now have stable identities. Changing `open` updates door visibility, portal state, and collider state incrementally.

## Security

Path-based APIs now reject dangerous prototype segments and malformed JSON Pointer escapes. Code relying on inherited object properties through untrusted paths must move those values to own properties.
