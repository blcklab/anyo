> Historical migration note. Anyo 0.5 now migrates 0.2, 0.3, and 0.4 documents to 0.5. See `migration-0.5.md`.

# Migrating to Anyo 0.4

Anyo automatically migrates `0.2` and `0.3` documents to `0.4` during `world.load()` and `migrateWorldDocument()`.

## Main changes

- `building` is optional.
- The migration target is `0.4`.
- Legacy asset declarations receive inferred `type` and, when possible, `format` values.
- Unknown entity types no longer compile as boxes.
- Nested group rotations use quaternion composition.
- Entity collider and trigger bounds account for rotation.

## New schema

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

Asset loading and decoding remain renderer-adapter responsibilities.
