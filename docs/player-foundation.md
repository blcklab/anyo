# Player integration

Use these APIs to connect your viewer's UI, loading state, and input to an Anyo world. Anyo keeps handling world behavior, collision, interaction, and XR.

## Readiness

```ts
await world.load(document)
await world.whenReady()      // validated, compiled, mounted, runtime installed
await world.whenIdle()       // renderer-managed assets have settled
```

Read `world.getAssetProgress()` for a progress snapshot and listen to `assets:progress` for updates. A renderer without asset tracking reports a completed empty workload.

## Input ownership

The exploration plugin can listen to canvas input directly. To use your own keyboard, touch, gamepad, or accessibility controls, disable browser input and forward movement commands:

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

Awaiting disposal stops the frame loop, exits XR, clears input, disposes plugins and systems, cancels asset loads, and releases renderer resources. Use this when your viewer unmounts or switches to a new player instance.

## Material texture channels

The current Sekai64 adapter maps base-color, normal, roughness, metalness, packed metallic-roughness, emissive, and occlusion textures. Packed metallic-roughness uses green for roughness and blue for metalness. Read `renderer.info.capabilities.materialTextureChannels` for the active backend and see [assets](assets.md).
