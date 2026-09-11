# Preparing a release

Pin the package versions you test together. This checkout uses Anyo `0.10.0-rc.1` and Sekai64 `0.8.0-rc.33`; check your app's lockfile before deploying an upgrade.

## Validate the world and package

Run `npm run check` before publishing Anyo. It runs type checks, tests, and package verification. See [tests](../tests/README.md) for individual commands.

For world content, use `inspectWorldDocument()` during your build and `world.validate()` to inspect the loaded source. Production validation also checks registered actions, references, and renderer capabilities. See [validation modes](world-schema.md#validation-modes).

## Handle lifecycle and persistence

Await `world.disposeAsync()` when replacing a player or leaving a route. It stops the loop, exits XR, cleans up plugins and systems, and cancels pending renderer assets.

Use `world.setData()` for values that update bindings without changing saved JSON. Call `world.commitRuntimeData()` when those values should become persistent. For animation and physics, use [runtime transforms](runtime-systems.md).

Editor tools should commit one transform preview after a drag ends. Use `world.transaction()` for broader document changes; see [editor APIs](editor-contract.md).

## Check the actual application

Test world replacement, asset failures, resize, pointer lock, touch controls, incremental updates, context loss, and repeated disposal in each supported browser and renderer backend. Use the [VR checklist](vr-production-checklist.md) for headset builds.

Cap pixel ratio on high-density displays to control rendering cost. For example, pass `pixelRatio: Math.min(devicePixelRatio, 2)` to the renderer and measure on your target devices.

Set trusted asset origins, response-size limits, and a Content Security Policy in your host app. Keep credentials out of world JSON. See [security](../SECURITY.md).
