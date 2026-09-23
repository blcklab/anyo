# Player Foundation — Anyo 0.9.0-rc.3

This contract lets a reusable browser shell display and explore an Anyo world without duplicating world, collision, interaction, or XR logic.

## Readiness

```ts
await world.load(document)
await world.whenReady()      // validated, compiled, mounted, runtime installed
await world.whenIdle()       // renderer-managed assets have settled
```

Use `world.getAssetProgress()` for the current snapshot and `assets:progress` for updates. A renderer that does not expose asynchronous asset tracking safely reports a completed empty workload.

## Input ownership

The built-in exploration plugin may own canvas-scoped browser input, or a player can disable it and drive abstract controls:

```ts
explorePlugin({ browserInput: false })

world.exploration.setMoveAxes(right, forward)
world.exploration.setRun(true)
world.exploration.addLookDelta(deltaX, deltaY)
world.exploration.clearInput()
world.exploration.releasePointerLock()
```

`setMoveAxes()` uses values from -1 to 1. Anyo retains collision and movement rules; the host only maps keyboard, touch, gamepad, switch, or accessibility input to abstract controls.

## Pause and resume

```ts
world.pause()
world.resume()
```

Stopping or pausing clears active movement and releases pointer lock. Starting or resuming re-enables input only when the host has not explicitly disabled it.

## Diagnostics

```ts
world.on('renderer:diagnostic', diagnostic => {
  console.log(diagnostic.code, diagnostic.message)
})
```

Sekai64 forwards WebGL context loss/restoration, WebGPU device loss, asset failures, and other renderer diagnostics through this event.

## XR-safe shutdown

```ts
await world.disposeAsync()
```

Asynchronous disposal stops the frame loop, awaits native XR session exit, clears exploration input, disposes plugins and systems, aborts renderer assets, and then releases GPU resources. Existing synchronous `dispose()` remains available for backward compatibility, but browser players should use `disposeAsync()`.

## Material texture channels

Sekai64 supports `baseColorTexture`, `metallicRoughnessTexture`, `normalTexture`, `emissiveTexture`, and `occlusionTexture`. The metallic-roughness texture follows glTF packing: roughness in the green channel and metalness in the blue channel. Renderer-neutral separate `roughnessTexture` and `metalnessTexture` fields are not advertised by the Sekai64 adapter.
