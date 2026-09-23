# Sekai64 renderer

Install:

```bash
npm install @blcklab/anyo @blcklab/sekai64
```

Use:

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
await world.load(document)
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

## Stable mappings

The adapter maintains deterministic primitive-node, room-group, material, and instance mappings. Shared unit geometry is scaled through transforms. Compatible static primitives may be instanced while preserving per-instance primitive identity.

## Picking

Interactive products, models, and panels use triangle precision when available. Instanced hits preserve Sekai64’s `instanceId`, which is mapped back to the original Anyo primitive ID. Non-interactive architecture is excluded from the interactive picking layer.

## Assets

Images use `ImageMesh.setSource()` and models use the glTF loader. Loads are independently cancellable and guarded by a world-generation token so stale completions cannot attach to a replacement world.

## Diagnostics and metrics

Use `getDiagnostics()`, `getMetrics()`, and `whenIdle()`. Reported backend and features come from Sekai64’s actual engine capabilities.


## Resource DAG realization (S12)

`@blcklab/anyo/renderer-sekai64` can now realize the S9-S11 resource graph directly. For an already-mounted `Sekai64Renderer`, use the convenience bridge:

```ts
import { createSekai64RendererResourceAdapter } from '@blcklab/anyo/renderer-sekai64'

const resources = createSekai64RendererResourceAdapter(renderer)
await resources.transition(graph)
```

The factory uses `renderer.getNativeAccess()` and registers each realized semantic instance through the existing external-node identity bridge, so trusted resource-graph nodes can participate in Sekai64/Anyo picking identity while the adapter remains responsible for their lifetime. The renderer itself does not own the resource DAG.

S12 does not modify the Sekai64 package and does not replace the legacy compiled-world mount path. It is an additive bridge for the procedural/resource pipeline.
