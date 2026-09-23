<p align="center">
  <strong>Anyo</strong><br />
  A renderer-independent JSON world runtime for the web.
</p>

# @blcklab/anyo

`@blcklab/anyo` defines, validates, compiles, updates, and runs spatial worlds from declarative JSON. Rendering stays behind explicit adapters, so authored world data remains portable across supported renderers and headless environments.

> `0.10.0-rc.3-dev.21` is a development release candidate on the JSON-native world-authoring track. Install it explicitly or through the `next` npm dist-tag.

## Installation

```bash
npm install @blcklab/anyo@next
```

Install a renderer only when your application needs one. The official Sekai64 adapter supports `@blcklab/sekai64@0.8.0-rc.33`.

```bash
npm install @blcklab/sekai64@next
```

## Quick start with Sekai64

```html
<canvas id="world"></canvas>
```

```ts
import { createWorld, explorableBuildingPreset } from '@blcklab/anyo'
import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'

const canvas = document.querySelector<HTMLCanvasElement>('#world')!

const renderer = new Sekai64Renderer({
  canvas,
  backend: 'auto',
  antialias: true,
  pixelRatio: Math.min(devicePixelRatio, 2),
})

const world = createWorld({
  renderer,
  plugins: explorableBuildingPreset(),
})

await world.load('/world.json')
await world.whenReady()
world.start()

// When the page or route is disposed:
await world.disposeAsync()
```

## Core capabilities

- Versioned JSON world documents, schema validation, normalization, and deterministic migrations
- Stable IDs, patches, transactions, history, and canonical serialization
- Entities, components, assets, prefabs, schema-0.8 compositions, buildings, rooms, portals, zones, and interactions
- Renderer-independent runtime systems and transient transforms
- First-person exploration, collision-aware world navigation, and optional WebXR integration
- Optional editor, web-surface, renderer, and runtime subpaths
- Asset progress, renderer diagnostics, explicit pause/resume, and async disposal

## Package entry points

Common subpaths include:

```text
@blcklab/anyo
@blcklab/anyo/core
@blcklab/anyo/geometry
@blcklab/anyo/resources
@blcklab/anyo/document
@blcklab/anyo/entities
@blcklab/anyo/components
@blcklab/anyo/assets
@blcklab/anyo/systems
@blcklab/anyo/explore
@blcklab/anyo/explore-xr
@blcklab/anyo/editor
@blcklab/anyo/renderer-sekai64
@blcklab/anyo/web-surface
```

Only import the capabilities your application uses.

## World documents

The current authoritative world-document version is `0.7`. Earlier supported documents migrate deterministically through the public migration APIs. See [World schema](docs/world-schema.md) and the [migration guides](docs/README.md#migrations).

## Renderer ownership

Anyo owns world data, lifecycle, compilation, runtime state, and renderer-independent behavior. Renderer adapters own GPU resources, draw submission, textures, materials, models, cameras, lights, and picking implementation.

## Documentation

See the [documentation index](docs/README.md) for user guides, renderer integration, production guidance, performance, migrations, and the world schema.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and security guidance.

## License

MIT

## Procedural construction (S7 semantic architecture)

The procedural construction foundation is exposed from `@blcklab/anyo/geometry`. It is renderer-neutral and deterministic: definitions normalize to stable cache keys, generated meshes use typed arrays and explicit bounds, and safety limits reject unreasonable inputs before allocation.

S2 precision primitives remain built in: `box`, `roundedBox`, `plane`, `sphere`, `cylinder`, `cone`, `capsule`, `disc`, `torus`, and simple `polygon`. Quality presets resolve to explicit tessellation values before hashing, so equivalent effective geometry shares one cache identity.

```ts
import { compileGeometry } from '@blcklab/anyo/geometry'

const mesh = compileGeometry({
  kind: 'roundedBox',
  size: [4, 2, 1],
  radius: 0.04,
  quality: 'high',
})
```


S3 adds renderer-neutral surface policy on top of those primitives. Definitions may request flat or smooth normals with a crease angle, generated/planar/box/cylindrical/spherical UV projection, real-world `metersPerTile` texture density, and tangent generation for normal mapping. Semantic geometry groups such as `front`, `top`, `side`, and caps remain material-slot metadata only; material resources are still a separate domain.

```ts
const panel = compileGeometry({
  kind: 'box',
  size: [4, 2, 0.12],
  normals: { mode: 'smooth', creaseAngle: Math.PI / 4 },
  uv: { mode: 'box', metersPerTile: 1 },
  tangents: true,
})
```

These kinds are low-level geometry expressions, not new world entity types. Existing Anyo JSON entity semantics are unchanged. S7 now adds an opt-in semantic architecture lowering layer that resolves walls, slabs, stairs, railings, columns, beams, roofs, panels, and trims into reusable geometry expressions and instance placements instead of embedding custom vertex generation in each semantic type. Human and AI authoring should prefer semantic and procedural definitions; raw mesh arrays are an escape hatch, not the primary authoring model.


S4 adds reusable 2D profiles, canonical contour/hole validation, deterministic hole-aware triangulation, extrusion, semantic cap/side regions, and bounded multi-segment bevels. Profiles normalize outer contours CCW and holes CW before hashing so equivalent authoring forms share geometry identity.

```ts
const wallPanel = compileGeometry({
  kind: 'extrude',
  profile: {
    points: [[0, 0], [6, 0], [6, 3], [0, 3]],
    holes: [[[1, 0.8], [1, 2.2], [2.5, 2.2], [2.5, 0.8]]],
  },
  depth: 0.2,
  bevel: { size: 0.025, segments: 3 },
  uv: { mode: 'generated', metersPerTile: 1 },
  tangents: true,
})
```

S4 uses profile holes for architectural openings; it does not introduce general CSG. Extrusion output reuses the S3 surface pipeline, and semantic groups (`front`, `back`, `outerSide`, `holeSide:N`, `frontBevel`, `backBevel`) remain renderer-neutral material-assignment metadata.


S5 adds deterministic 3D curves, transported sweep frames, `sweep` geometry, and `layoutPathArray()` placement resources. Repeated path-array elements stay as placement data so future instancing can share one geometry resource instead of baking copies.

S6 adds composable geometry-local modifiers. `transform` changes vertices in local geometry space and therefore intentionally creates a new geometry identity, while entity/world transforms remain outside the geometry cache. Negative scales repair winding and tangent handedness automatically. `mirror` reflects across x/y/z planes and keeps the original by default for symmetry.

```ts
const frame = compileGeometry({
  kind: 'transform',
  source: {
    kind: 'mirror',
    source: { kind: 'extrude', profile: { points: [[0,0],[2,0],[2,1],[0,1]] }, depth: 0.1 },
    axis: 'x',
    offset: 1,
  },
  position: [0, 2, 0],
  rotation: [0, Math.PI / 4, 0],
  scale: [1, 1, 1],
})
```

Linear repetition uses `layoutGeometryArray()` rather than a baked `array` mesh kind:

```ts
const posts = layoutGeometryArray({
  source: { kind: 'roundedBox', size: [0.05, 1, 0.05], radius: 0.01 },
  count: 20,
  offset: [0.5, 0, 0],
})
```

This keeps array placement/instance identity separate from source geometry identity and prepares the future runtime resource/instancing model. `maxModifierDepth` and `maxGeneratedInstances` bound recursive and repeated AI-authored input. Bend, twist, and taper remain intentionally deferred until the stable transform/array/mirror layer is frozen.


### S7 semantic architecture

`lowerArchitecture()` is the first scoped construction IR for architectural authoring. It returns renderer-neutral `parts`, shared `instanceGroups`, and semantic `anchors`; it does not allocate GPU resources or mutate the world.

```ts
import { lowerArchitecture } from '@blcklab/anyo/geometry'

const wall = lowerArchitecture({
  type: 'wall',
  id: 'lobby-wall',
  from: [0, 0, 0],
  to: [8, 0, 0],
  height: 3.2,
  thickness: 0.15,
  openings: [
    { kind: 'door', id: 'entry', offset: 1.2, width: 1, height: 2.2 },
    { kind: 'window', id: 'glass', offset: 4, width: 1.8, height: 1.4, sillHeight: 0.9 },
  ],
})
```

Wall openings are lowered into ordinary solid wall segments; no CSG is required. Stairs reuse shared tread/riser geometry with placements, railings combine S5 sweep rails with path-array post placements, and trims are sweep expressions. Architecture remains separate from renderer/material ownership and existing Anyo world entity semantics.


### S8 safe CSG

S8 adds opt-in renderer-neutral Boolean geometry as composable `union`, `subtract`, and `intersect` expressions. CSG is intentionally a lower-level construction tool: S7 walls still use deterministic opening decomposition and do not become dependent on Boolean geometry.

```ts
const doorwayCut = compileGeometry({
  kind: 'subtract',
  left: { kind: 'box', size: [4, 3, 0.2] },
  right: {
    kind: 'transform',
    source: { kind: 'box', size: [1, 2.2, 0.5] },
    position: [0, -0.4, 0],
  },
  normals: { mode: 'flat' },
  uv: { mode: 'box', metersPerTile: 1 },
  tangents: true,
})
```

Boolean operands must be closed, outward-wound 2-manifold solids. Open planes/discs, zero-volume shapes, boundary/non-manifold meshes, excessive nesting, numerically unstable intersections, and empty results fail closed with structured `CSG_*` errors and repair suggestions. S8 performs deterministic BSP clipping, interpolates vertex attributes on cut edges, conforms T-junction boundaries before final triangulation, and validates the result as a closed solid. `maxBooleanDepth` is enforced independently from modifier depth.

CSG result groups remain material-neutral. Left/right source regions are emitted as `left:<region>` / `right:<region>`; subtraction surfaces sourced from the cutter are named `cut:<region>`. Material resources remain outside geometry identity and compilation.


### S9 resource/composition DAG

S9 formalizes the shared-resource layer prepared by the geometry and architecture milestones. Import it explicitly from `@blcklab/anyo/resources`; it remains renderer-neutral and does not allocate GPU resources.

```ts
import { createResourceGraphBuilder } from '@blcklab/anyo/resources'

const resources = createResourceGraphBuilder()
const texture = resources.addAsset({ src: './concrete.ktx2', type: 'texture' })
const concrete = resources.addMaterial({ baseColorTexture: 'concrete' }, { assets: [texture] })
const wall = resources.addGeometry({ kind: 'box', size: [8, 3, 0.15] })
resources.addInstance({ id: 'hq/lobby/wall', source: wall, materials: [concrete] })

const graph = resources.build()
const affected = graph.invalidationSet([texture])
```

`GeometryResource`, `MaterialResource`, and `AssetResource` are content-addressed and deduplicated. `InstanceResource` deliberately keeps a separate semantic id plus a content key, so two identical chairs remain two instances while sharing geometry/material resources. Nested transform/mirror/CSG expressions become explicit geometry-resource dependencies. S5 path arrays preserve transported orientation frames, S6 arrays share one geometry node, and S7 architecture assemblies lower into shared geometry plus semantic instances.

`ResourceGraph` exposes deterministic topological order, direct/transitive dependency and dependent queries, graph snapshots, and a dependencies-first invalidation plan. S9 only models resource identity and impact; targeted recompilation, renderer instancing, GPU allocation, streaming/eviction, and world-schema integration remain later runtime work.


### S10 incremental resource planning

S10 adds deterministic graph diffing and transition planning on top of S9. It remains renderer-neutral: a plan describes what can be reused, which new non-instance resources must be compiled/prepared, which semantic instances can be updated in place, and which obsolete resources may be released after their dependents are detached.

```ts
import { planResourceGraphTransition } from '@blcklab/anyo/resources'

const plan = planResourceGraphTransition(previousGraph, nextGraph)

console.log(plan.reuse)
console.log(plan.compile)
console.log(plan.updateInstances)
console.log(plan.release)
```

Geometry, material, and asset ids are content-addressed and immutable across a transition. Changed content therefore receives a new resource id. `InstanceResource` is the exception: its stable semantic id may remain while source, materials, transform, transported frame, or metadata changes. S10 returns a field-level `InstanceResourceDelta` for that update instead of forcing remove/create churn.

`compile` is ordered dependencies-first. Removed instances are detached before obsolete resources are released, and `release` is ordered dependents-first. S10 does not execute those operations or allocate renderer/GPU resources; renderer realization remains a later integration stage.


### S11 resource realization lifecycle

S11 executes the pure S10 transition plan through renderer-neutral adapter hooks while keeping renderer/GPU objects outside Anyo Core. The realizer caches only opaque handles and enforces dependency-safe staging, stable-instance updates, retirement, rollback, and retryable cleanup.

```ts
import { createResourceRealizer } from '@blcklab/anyo/resources'

const realizer = createResourceRealizer({
  prepare(resource, context) {
    // Create an adapter-owned geometry/material/asset handle.
    // Resource dependencies are already available through context.
    return adapter.prepare(resource, context)
  },
  createInstance(instance, context) {
    return adapter.createInstance(instance, context)
  },
  updateInstance(delta, handle, context) {
    adapter.updateInstance(handle, delta, context)
  },
  removeInstance(instance, handle) {
    adapter.removeInstance(handle)
  },
  release(resource, handle) {
    adapter.release(handle)
  },
})

await realizer.transition(nextGraph)
```

New resources and instances are staged before the active graph changes. If `prepare`, `createInstance`, or `updateInstance` fails, S11 attempts to reverse successful stable-instance updates, remove newly-created instances, and release newly-prepared resources. If rollback itself fails, the realizer becomes faulted so callers cannot continue on an adapter state that may no longer match the active graph.

After a successful commit, obsolete instances/resources are moved to a retired queue and cleaned up in S10's dependency-safe order. Cleanup failure does **not** undo a committed graph; it is reported as `RESOURCE_REALIZATION_CLEANUP_FAILED` and may be retried with `flushRetired()`. A new transition first retries pending cleanup before advancing.

`ResourceRealizer` is intentionally adapter-agnostic. S11 does not import Sekai64, allocate GPU buffers/textures, mutate the existing world schema, or implement renderer-specific cache objects. The next integration stage can implement these hooks for Sekai64 without moving renderer ownership into Anyo's geometry/resource model.


### S12/S13 Sekai64 realization and semantic materials

`@blcklab/anyo/renderer-sekai64` realizes S9-S11 resources into Sekai64 without moving renderer ownership into Anyo Core. S13 adds true multi-material region realization on top of S12. Geometry stays shared; one semantic Mesh may select several material resources through its authored geometry groups.

```ts
const resources = createResourceGraphBuilder()
const box = resources.addGeometry({ kind: 'box', size: [4, 2, 0.2] })
const concrete = resources.addMaterial({ baseColor: '#303030', roughness: 0.9 })
const accent = resources.addMaterial({ baseColor: '#7c3aed', roughness: 0.5 })

resources.addInstance({
  id: 'hq/panel',
  source: box,
  materials: [concrete],
  materialBindings: { front: accent },
})
```

`materials[]` remains the ordered numeric slot table. `materialBindings` overrides slots by semantic geometry-group name per instance, so the same cached geometry can be reused with different region materials. Unknown region names or unavailable numeric material slots fail closed instead of silently rendering with the wrong material. Region/material assignment remains outside geometry identity.
