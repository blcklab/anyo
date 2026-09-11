# VR development

Add XR exploration to the same world you use on desktop. Anyo handles movement, collision, rooms, and actions; the renderer handles the XR session, device poses, and stereo rendering. No editor package is needed.

## Install the release candidates

```bash
npm install @blcklab/anyo@0.10.0-rc.1 @blcklab/sekai64@0.8.0-rc.33
```

Sekai64 remains an optional peer dependency. Headless compilation and non-Sekai renderers do not require it.

## Enter VR

This example expects a canvas with ID `world` and a button with ID `enter-vr`.

```ts
import {
  createWorld,
  explorableBuildingPreset,
  xrExplorationPlugin,
} from '@blcklab/anyo'

import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'

const canvas = document.querySelector<HTMLCanvasElement>('#world')!

const renderer = new Sekai64Renderer({
  canvas,
  backend: 'webgl2',
  antialias: true,
  pixelRatio: Math.min(devicePixelRatio, 2),
})

const world = createWorld({
  renderer,
  plugins: [
    ...explorableBuildingPreset(),
    xrExplorationPlugin({
      locomotion: 'teleport',
      turning: 'snap',
      snapAngle: 30,
    }),
  ],
})

await world.load('/world.json')
world.start()

const enterButton = document.querySelector<HTMLButtonElement>('#enter-vr')!
enterButton.disabled = !(await world.xr.isSupported('immersive-vr'))
enterButton.addEventListener('click', () => {
  void world.xr.enter({
    mode: 'immersive-vr',
    referenceSpace: 'local-floor',
  }).catch(error => console.error('Could not enter VR:', error))
})
```

An immersive session must be requested from an explicit user gesture. The ordinary desktop experience remains active when immersive VR is unavailable.

## Frame scheduling

The frame driver uses `window.requestAnimationFrame()` on desktop and switches to `XRSession.requestAnimationFrame()` in VR. Only one loop renders the world at a time.

Each frame still updates the same Anyo plugins, collision, room state, triggers, runtime bindings, and renderer.

## Player rig

Raw headset movement is a physical offset inside an Anyo-controlled virtual rig:

```text
virtual player rig × physical viewer pose = final world-space viewer pose
```

Teleportation and turning move the rig while preserving the headset's physical offset, so the player can still move within their room.

## Locomotion

The optional `@blcklab/anyo/explore-xr` module supports:

- Teleport locomotion using Anyo floor, stair, wall, door, and collider data
- Room-scale-only movement
- Optional smooth locomotion
- Snap turning
- Optional smooth turning
- Collision-aware player clearance
- Active-room updates after movement

Teleport rays are rejected when they hit a closed wall or solid collider before reaching a valid floor or stair surface.

## Interaction

Controller and gaze selection reuse the same Anyo interaction and action registry used by mouse, touch, and desktop crosshair input.

```ts
world.registerAction('open-product', ({ sku }) => {
  openProductDetails(sku)
})
```

Sekai64 performs ray picking and returns a stable Anyo primitive ID, hit position, normal, distance, and optional `instanceId`. Anyo resolves the entity and dispatches the existing action.

## JSON configuration

XR configuration is optional and does not create a separate VR world format:

```json
{
  "version": "0.7",
  "exploration": {
    "spawn": {
      "room": "lobby",
      "position": [0, 1.65, 2]
    },
    "xr": {
      "enabled": true,
      "mode": "immersive-vr",
      "referenceSpace": "local-floor",
      "locomotion": "teleport",
      "turning": "snap",
      "snapAngle": 30,
      "movementSpeed": 1.5,
      "turnSpeed": 90,
      "dominantHand": "auto",
      "interactionDistance": 10,
      "collision": true
    }
  }
}
```

XR settings live inside the normal world schema. Older supported documents migrate to the current schema; see [world 0.7 migration](migrations/MIGRATION_WORLD_0.7.md).

## Current backend scope

XR presentation currently uses WebGL2 through `XRWebGLLayer`. Create a VR-enabled adapter with `backend: 'webgl2'`; WebGPU remains available for ordinary rendering.

## Disposal

Dispose the world when the route or application is destroyed:

```ts
await world.disposeAsync()
```

This waits for XR exit and world cleanup. Before release, work through the [VR checklist](vr-production-checklist.md).
