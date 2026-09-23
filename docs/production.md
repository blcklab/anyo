# Production guide

## Pin compatible versions

```json
{
  "dependencies": {
    "@blcklab/anyo": "0.6.0",
    "@blcklab/sekai64": "0.6.1"
  }
}
```

## Validate before deployment

Use `inspectWorldDocument` for build-time checks and `world.validate()` for the loaded source. Treat warnings and renderer capability diagnostics as deployment signals.

## Dispose worlds

Call `world.dispose()` when replacing a world or unmounting the host application. Disposal is idempotent and cancels pending renderer assets.

## Keep runtime and persistent data intentional

`world.setData()` updates bindings without modifying serialized JSON. Use `world.commitRuntimeData()` only for values intended to persist.

## Use the editor contract for authoring tools

Use `@blcklab/anyo/editor` for selection, previews, clipboard operations, grouping, and world-preserving reparenting. Use `world.transaction()` for broader CMS/document changes. Commit one preview after a drag ends rather than creating one history entry per pointer movement.

## Security

Allowlist asset origins, apply Content Security Policy, limit remote asset sizes, and never place secrets in world JSON. Anyo does not execute code from documents.

## Pixel ratio

Use a conservative cap on high-density devices:

```ts
pixelRatio: Math.min(devicePixelRatio, 2)
```

## Browser matrix

Verify the actual application in every supported browser/device/backend. Include world replacement, context loss, media/model failures, pointer lock, touch controls, resize, incremental updates, and repeated disposal.
