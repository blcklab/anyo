# Changes introduced in world 0.4

This guide records the 0.4 changes. Use the [world 0.7 migration guide](migrations/MIGRATION_WORLD_0.7.md) when upgrading with the current package.

## Main changes

- `building` is optional.
- The document format advanced to `0.4`.
- Legacy asset declarations receive inferred `type` and, when possible, `format` values.
- Unknown entity types no longer compile as boxes.
- Nested group rotations use quaternion composition.
- Entity collider and trigger bounds account for rotation.

## Document header

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.4.schema.json",
  "version": "0.4"
}
```

## Typed assets

```json
{
  "assets": {
    "avatar": {
      "type": "model",
      "format": "vrm",
      "src": "./avatar.vrm"
    }
  }
}
```

A typed asset still needs a renderer or loader that supports its format.
