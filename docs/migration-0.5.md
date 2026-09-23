# Migrating to Anyo 0.5

Anyo automatically migrates `0.2`, `0.3`, and `0.4` documents to `0.5` during `world.load()` and `migrateWorldDocument()`.

## Required document header

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.5.schema.json",
  "version": "0.5"
}
```

## What migration changes

- Sets the target version and schema reference to 0.5.
- Preserves buildings, entities, IDs, transforms, materials, actions, bindings, extension data, and legacy component-like fields.
- Infers missing legacy asset types and formats where possible.
- Does not automatically rewrite `interaction`, `collision`, `audio`, `lod`, `trigger`, or `visible` into explicit components.

Keeping legacy fields avoids unexpected source rewrites. New documents may use explicit components immediately.

## Optional manual modernization

Before:

```json
{
  "id": "product",
  "type": "box",
  "collision": true,
  "interaction": {
    "action": "open-product"
  }
}
```

After:

```json
{
  "id": "product",
  "type": "box",
  "components": [
    { "type": "anyo.collider" },
    {
      "type": "anyo.interactable",
      "action": "open-product"
    }
  ]
}
```

Both forms compile to equivalent runtime semantics in 0.5.

## Renderer compatibility

The 0.5 Sekai64 adapter requires `@blcklab/sekai64@^0.6.1` because it uses the public asset-loader registry and textured material contracts introduced in that release.
