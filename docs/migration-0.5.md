# Changes introduced in world 0.5

World 0.5 added explicit components while keeping older entity fields valid. For a current upgrade, use the [world 0.7 migration guide](migrations/MIGRATION_WORLD_0.7.md).

## Document header

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.5.schema.json",
  "version": "0.5"
}
```

## What the 0.5 migration changed

- Sets the target version and schema reference to 0.5.
- Preserves buildings, entities, IDs, transforms, materials, actions, bindings, extension data, and legacy component-like fields.
- Infers missing legacy asset types and formats where possible.
- Does not automatically rewrite `interaction`, `collision`, `audio`, `lod`, `trigger`, or `visible` into explicit components.

You can keep the older fields or adopt components where they make the document clearer.

## Moving to components

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

Both forms describe the same interaction and collider behavior.

## Renderer compatibility

The original 0.5 adapter used Sekai64 `^0.6.1` for its asset-loader registry and material textures. See [Sekai64 setup](sekai64.md) for the current package pair.
