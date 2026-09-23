# VR development

Anyo VR support is renderer-independent. Anyo owns the world document, collision, rooms, portals, actions, runtime data, history, and the virtual player rig. The active renderer owns WebXR session creation, headset/controller pose acquisition, stereo rendering, and GPU resources.

The visual editor is not part of this runtime path. Anyo and Sekai64 load and run VR worlds without any editor package.

## Install the release candidates

```bash
npm install @blcklab/anyo@0.7.0-rc.1 @blcklab/sekai64@0.7.0-rc.1
```

Sekai64 remains an optional peer dependency. Headless compilation and non-Sekai renderers do not require it.

## Minimal VR setup

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
  })
})
```

An immersive session must be requested from an explicit user gesture. The ordinary desktop experience remains active when immersive VR is unavailable.

## One authoritative frame loop

Anyo uses one renderer-neutral world step. In desktop mode, the renderer frame driver uses `window.requestAnimationFrame()`. In VR, Sekai64 transfers ownership to `XRSession.requestAnimationFrame()`. The loops never render the world simultaneously.

Each frame still updates the same Anyo plugins, collision, room state, triggers, runtime bindings, and renderer.

## Player rig

Raw headset movement is a physical offset inside an Anyo-controlled virtual rig:

```text
virtual player rig × physical viewer pose = final world-space viewer pose
```

Teleportation, smooth locomotion, and snap turning move the rig. They never overwrite the device-provided headset pose. This preserves room-scale movement and makes entering or leaving XR deterministic.

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
  "version": "0.6",
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

The authoring schema remains version `0.6` because XR is an optional backward-compatible exploration capability. Existing `0.6` documents remain valid.

## Current backend scope

The first release-candidate XR rendering path is WebGL2 through `XRWebGLLayer`. Sekai64 may still use WebGPU for non-XR applications, but a VR-enabled `Sekai64Renderer` should currently be created with `backend: 'webgl2'`.

WebGPU XR presentation is intentionally deferred until the deployment/browser path is reliable.

## Disposal

Dispose the world when the route or application is destroyed:

```ts
world.dispose()
```

This stops the active frame driver, ends or releases XR resources through Sekai64, disposes plugins, cancels pending assets, and clears renderer resources.
