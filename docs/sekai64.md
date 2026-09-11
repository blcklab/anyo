# Sekai64 renderer

Use the Sekai64 adapter to render Anyo worlds with WebGPU or WebGL2. Install the versions tested by this checkout:

```bash
npm install @blcklab/anyo@0.10.0-rc.1 @blcklab/sekai64@0.8.0-rc.33
```

The example assumes an HTML canvas named `canvas`:

```ts
import { createWorld, explorableBuildingPreset } from '@blcklab/anyo'
import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'

const renderer = new Sekai64Renderer({
  canvas,
  backend: 'auto',
  antialias: true,
  pixelRatio: Math.min(devicePixelRatio, 2),
})

const world = createWorld({ renderer, plugins: explorableBuildingPreset() })
await world.load('/world.json')
await world.whenReady()
world.start()
```

## Primitive mapping

```text
Anyo box              → Sekai64 Mesh + shared BoxGeometry
Anyo plane            → Sekai64 Mesh + shared PlaneGeometry
Anyo cylinder         → Sekai64 Mesh + shared CylinderGeometry
Anyo text             → Sekai64 TextMesh
Anyo image            → Sekai64 ImageMesh
Anyo model            → Sekai64 glTF node
Anyo ambient light    → Sekai64 AmbientLight
Anyo directional light→ Sekai64 DirectionalLight
Anyo point light      → Sekai64 PointLight
Anyo room             → Sekai64 Node group
```

## Shared resources

The adapter maps primitive IDs, rooms, and materials to Sekai64 objects. Repeated shapes share unit geometry and use transforms for sizing. Compatible static primitives may use instancing, with a separate Anyo ID for each instance.

## Picking

Interactive products, models, and panels use triangle precision when available. Instanced hits preserve Sekai64’s `instanceId`, which is mapped back to the original Anyo primitive ID. Non-interactive architecture is excluded from the interactive picking layer.

## Assets

Images use `ImageMesh.setSource()` and glTF/GLB models use the registered loader. Loads can be cancelled independently. Results from an earlier world are ignored after replacement. See [assets](assets.md) for custom formats.

## Diagnostics and metrics

Use the renderer's `getDiagnostics()`, `getMetrics()`, and `whenIdle()` methods. Backend and feature reports come from the active Sekai64 engine.

Await `world.disposeAsync()` when removing the player so loading and renderer resources are cleaned up.
