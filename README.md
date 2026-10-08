<p align="center">
  <strong>Anyo</strong><br />
  A renderer-independent JSON world runtime for the web.
</p>

# @blcklab/anyo

`@blcklab/anyo` defines, validates, compiles, updates, and runs spatial worlds from declarative JSON. Rendering stays behind explicit adapters, so authored world data remains portable across supported renderers and headless environments.

> `0.10.0-rc.8` is a release candidate on the JSON-native world-authoring track. Install it explicitly or through the `next` npm dist-tag.

## Installation

```bash
npm install @blcklab/anyo@next
```

Install a renderer only when your application needs one. The official Sekai64 adapter supports the current `@blcklab/sekai64@0.8.x` release-candidate line through the declared peer range.

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
- Entities, components, assets, canonical World 0.9 compositions, backward-compatible prefabs, buildings, rooms, portals, zones, and interactions
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

### S25 realism foundation — deterministic variation and UV transforms

S25 adds two small, generic authoring tools instead of object-specific realism systems. Repeated entities can receive deterministic transform variation during normalization, and authored materials can request a shared UV scale/offset/rotation that capable renderers apply consistently.

```json
{
  "id": "rock",
  "type": "geometry",
  "geometry": "rock-shape",
  "repeat": {
    "count": 16,
    "axis": "x",
    "spacing": 2.5,
    "variation": {
      "seed": 8128,
      "position": { "z": [-1.2, 1.2] },
      "rotation": { "y": [-3.14159, 3.14159] },
      "scale": { "uniform": [0.78, 1.24] }
    }
  }
}
```

Variation is expanded once at authoring normalization time. It does not add a runtime random system or a per-frame cost.

```json
{
  "baseColorTexture": "./stone.webp",
  "normalTexture": "./stone-normal.webp",
  "roughness": 0.82,
  "textureTransform": {
    "scale": [4, 4],
    "offset": [0.125, 0],
    "rotation": 0.08
  },
  "textureWrap": "repeat"
}
```

`textureTransform` is renderer-neutral. Pair it with `textureWrap: "repeat"` (or per-axis `{ "s", "t" }`) when UVs should tile beyond the 0–1 range. The Sekai64 adapter reports both capabilities and Sekai64 0.8.0-rc.37 implements them in WebGL2 and WebGPU. Anyo still has no `TreeSystem`, `CloudRenderer`, `RockEntity`, or other object-specific realism subsystem.
### Runtime procedural clouds

When a renderer exposes the optional procedural-cloud runtime capability, host code may update the existing procedural sky without changing authored World JSON:

```ts
world.setProceduralCloudState({
  offset: [0.2, -0.05],
  evolution: 1.4,
  coverage: 0.55,
  density: 0.8,
})
```

`seed` selects the deterministic cloud family. Keep the seed stable for continuous clouds; change `offset` for drift and `evolution` for gradual shape change. `resetProceduralCloudState()` restores the authored/default cloud state.


### World-authored procedural-cloud appearance

`World.setProceduralCloudState()` is the renderer-neutral runtime surface for dynamic skies. Besides coverage/density/scale/seed and macro `offset`/`evolution`, rc.20 accepts an independent `detailOffset`/`detailEvolution` channel and bounded appearance controls (`macroScale`, `detailScale`, `detailStrength`, `edgeSoftness`, `warpStrength`, `horizonVisibility`, `horizonSoftness`, `horizonExtension`, `horizonCompression`, `horizonAtmosphericFade`, lighting strengths, and cloud colors). The horizon-underlap fields let a renderer continue distant cloud banks slightly beneath the mathematical horizon while fading them before downward-looking directions; ordinary scene geometry remains independent and renders in front. These values remain runtime-only and do not rewrite authored World JSON.

This contract exists so host/world data can define cloud identity and art direction while Anyo and Sekai64 remain frozen.

### Runtime environment state (rc.22)

Hosts may update generic sky and lighting presentation without rebuilding or rewriting the authored world:

```ts
world.setEnvironmentRuntimeState({
  background: '#081126',
  sky: {
    zenithColor: '#10214a',
    horizonColor: '#3a385b',
    groundColor: '#0c101b',
    sunDirection: [0.2, -0.3, -0.93],
    sunIntensity: 0,
  },
  ambientLight: { intensity: 0.18 },
  sun: { color: '#ffb078', intensity: 0.08, position: [20, -30, -90] },
})
```

The contract is deliberately provider-neutral. Astronomy, weather, time-of-day, or game systems may produce these generic values externally; Anyo does not import or identify those providers. `resetEnvironmentRuntimeState()` restores the authored environment. Active runtime clouds are re-lit from the latest runtime sky sun direction/intensity.

### Final modeling completeness freeze candidate

`0.11.0-rc.24` adds generic multi-profile `loft` geometry and optional `sweep.profileStations`. Together with existing curves, extrusion/bevel, CSG, modifiers, generated UVs, tangents, PBR authoring, repeat variation, and composition reuse, these close the main procedural-organic authoring gap needed for portfolio worlds without adding tree/flower/rock-specific systems. Both features lower into the ordinary renderer-neutral geometry mesh contract; Sekai64 needs no special semantic knowledge.


### Universal geometry operator pipeline

`0.11.0-rc.26` adds an ordered, renderer-neutral operator pipeline without removing the established nested modifier syntax. A pipeline owns one geometry source and applies source-free operators in order:

```json
{
  "kind": "pipeline",
  "source": { "kind": "box", "size": [1, 3, 1] },
  "modifiers": [
    { "kind": "taper", "axis": "y", "startScale": 1, "endScale": 0.6 },
    { "kind": "twist", "axis": "y", "angle": 0.5 },
    { "kind": "transform", "position": [1, 0, 0] }
  ]
}
```

The built-in Step 2 operator set is intentionally small: `transform`, `taper`, and `twist`. Legacy nested forms use the same underlying algorithms. Operators compile to ordinary `GeometryMesh` values; Sekai64 does not know whether a mesh came from a primitive, loft/sweep, a legacy modifier chain, or the generic pipeline.

### Universal geometry modifier set (rc.27)

The generic pipeline now supports `transform`, `taper`, `twist`, `bend`, `mirror`, deterministic `noise`, baked-mesh `array`, and conservative `weld`. Existing nested bend/mirror/noise authoring remains compatible and shares the same implementation as the operator path.

Use the `array` operator when repeated copies need to become one mesh for later deformation or welding. For large ordinary repetition, keep using Anyo's instance-array/resource path so geometry is shared instead of duplicated. `weld` preserves UV/normal/tangent/color seams by merging only attribute-identical vertices within tolerance.


### Arbitrary indexed mesh escape hatch (rc.28)

World 0.9 may author a generic `mesh` source with flat `positions` and triangle-list `indices`, plus optional raw `attributes` and semantic/material `groups`. Raw vertex normals live at `attributes.normals`; the existing top-level `normals` field remains the normal-generation policy. The source compiles to the same validated `GeometryMesh` contract as procedural geometry and can be fed directly into the universal operator pipeline. Sekai64 requires no special mesh-authoring semantics.


### Reusable curve resources (rc.29)

World 0.9 can declare renderer-neutral top-level `curves` and reuse them from generic sweep/path consumers. Inline curves remain fully supported. Curve references resolve to normalized curve content before geometry hashing, so equivalent inline and named curves deduplicate naturally while edits invalidate dependent geometry deterministically.

```json
{
  "curves": {
    "main-spine": {
      "kind": "helix",
      "radius": 1.2,
      "height": 5,
      "turns": 2.5,
      "segments": 64
    }
  },
  "geometries": {
    "tube": {
      "kind": "sweep",
      "profile": { "points": [[-0.08,-0.08],[0.08,-0.08],[0.08,0.08],[-0.08,0.08]] },
      "path": "main-spine"
    }
  }
}
```

`arc`, `circle`, and `helix` are analytic authoring conveniences that lower into Anyo's existing sampled-curve/frame implementation. Curves remain authoring resources rather than renderer resources; Sekai64 still receives only finalized `GeometryMesh` data.

### Reusable profile resources (rc.30)

World 0.9 can declare top-level `profiles` and reuse one canonical 2D contour definition across extrusion, sweep, variable-profile sweep stations, and loft sections. Inline profiles remain supported. Named references resolve to canonical contour content before geometry hashing, so the resource name itself does not affect geometry identity.

```json
{
  "profiles": {
    "beam-section": {
      "points": [[-0.2,-0.1],[0.2,-0.1],[0.2,0.1],[-0.2,0.1]]
    }
  },
  "geometries": {
    "beam": {
      "kind": "extrude",
      "profile": "beam-section",
      "depth": 4
    }
  }
}
```

Profiles preserve the existing canonical winding, hole topology, and compatibility rules; there is no second profile engine. They are authoring resources only and never become renderer nodes. Native Object 0.1 imports namespace local profile IDs and rewrite dependent geometry references. Construction trim remains inline-only in this milestone because its architecture lowering path does not receive profile-resource context.
### Generic scalar fields (rc.31)

World 0.9 can declare reusable renderer-neutral scalar fields and use them to drive generic geometry operations. A field is only mathematical authoring data: it maps a 3D position to one scalar value and does not represent terrain, clouds, vegetation, or any other semantic object.

```json
{
  "fields": {
    "rock-shape": {
      "kind": "multiply",
      "fields": [
        { "kind": "noise", "seed": 42, "frequency": 1.5, "octaves": 3 },
        { "kind": "radial", "center": [0, 0, 0], "radius": 4 }
      ]
    }
  },
  "geometries": {
    "rock": {
      "kind": "pipeline",
      "source": { "kind": "sphere", "radius": 1 },
      "modifiers": [
        { "kind": "displace", "field": "rock-shape", "strength": 0.25, "direction": "normal" }
      ]
    }
  }
}
```

The field vocabulary is deliberately small and composable: `constant`, `gradient`, `distance`, `radial`, deterministic `noise`, `add`, `multiply`, `min`, `max`, `invert`, and `clamp`. Named references resolve to canonical content before geometry hashing, so resource names are not geometry identity. Fields remain authoring-only and do not create ResourceGraph or renderer nodes. Native Object 0.1 imports namespace field IDs and nested references automatically.

### Namespaced geometry extensions (rc.32)

Trusted host code can register geometry providers without adding semantic shape kinds to Anyo Core. Extension kinds use lowercase namespaced identifiers such as `blcklab.architecture:spiral-stair` and receive provider-specific JSON under `params`.

```ts
import { GeometryExtensionRegistry, createGeometryCompiler } from '@blcklab/anyo/geometry'

const extensions = new GeometryExtensionRegistry([myTrustedProvider])
const compiler = createGeometryCompiler({ extensions })
```

World JSON may reference a registered kind, but it cannot install or execute a provider. The strict authoring envelope allows only `kind`, `params`, and the existing geometry surface policies. During ResourceGraph creation, extension-containing expressions are compiled and baked to the built-in indexed `mesh` source before renderer realization, so Sekai64 and other adapters remain completely unaware of extension packages.

Provider namespace/version metadata now participates in rc.33 canonical build identity. `hashGeometryDefinition()` remains the pure canonical-source `g1` hash; `GeometryCompiler.keyFor()` and ResourceGraph geometry ids use provenance-aware `g2` build keys.

### Deterministic geometry build identity (rc.33)

Geometry now has two intentionally different identities. `hashGeometryDefinition()` remains the compatibility-safe `g1` hash of canonical source JSON only. Compilation and ResourceGraph geometry use `g2`, produced from `GeometryBuildIdentity`: the normalized source, `anyo.geometry/1` build ABI, and sorted namespaced extension provider namespace/version/kind provenance. Reusable curves, profiles, and fields are resolved to canonical content before the identity is built, and ordered operators already live inside that normalized source.

`GeometryCompiler.identityFor()` exposes the exact identity object used by `keyFor()`/cache. Versioned extension providers must bump their provider version when executable geometry semantics change; unversioned providers are represented explicitly with `version: null` and therefore cannot provide cross-release implementation invalidation guarantees.


### Geometry validation & hardening (rc.34)

`0.11.0-rc.34` hardens the renderer-neutral mesh boundary without making unusual geometry illegal. `inspectGeometryMesh()` now reports non-fatal diagnostics for degenerate triangles, shared-edge winding conflicts, malformed normal/tangent vectors, overlapping groups, and stale supplied bounds. Final bounds are always recomputed canonically from positions. Strict callers can promote selected diagnostics to errors through `GeometryCompiler({ validation: ... })`, while `onDiagnostic` receives structured warnings with geometry/operator context when available.

New safety guards bound semantic groups and optional attribute values in addition to the established vertex/index/depth/instance limits. Validation policy remains outside `g2` build identity because it decides whether a build is accepted, not what accepted canonical geometry means. World 0.8/0.9 authoring syntax and Sekai64 remain unchanged.


### Universal geometry showcase (rc.35)

`0.11.0-rc.35` is the Step 11 proof milestone for the universal geometry architecture. `examples/universal-geometry-showcase/world.anyo.json` builds a spiral tower, curved bridge, procedural tree-like form, twisted sculpture, arched doorway, rocky formation, cable network, and pavilion using only generic World 0.9 geometry composition.

The showcase intentionally introduces no `tree`, `bridge`, `tower`, `rock`, or pavilion-specific geometry kinds. It combines reusable curves, profiles, scalar fields, arbitrary indexed mesh, sweep/loft/extrude, CSG, ordered modifiers, mirroring, baked arrays, and deterministic `g2` identity through the ordinary renderer-neutral ResourceGraph path. Sekai64 receives normal geometry resources only.

### Universal geometry long-term freeze

`0.11.0-rc.36` closes the rc.25–rc.35 universal-geometry series. The default policy is now to build worlds/tooling/extensions rather than add Core geometry vocabulary. See [`docs/GEOMETRY-LONG-TERM-FREEZE.md`](docs/GEOMETRY-LONG-TERM-FREEZE.md) for the decision order and [`docs/geometry-freeze-contract.json`](docs/geometry-freeze-contract.json) for the CI-enforced snapshot.

### Post-freeze extension integration (rc.37)

`0.11.0-rc.37` is the first post-freeze proof milestone. It does not reopen Geometry Core. `examples/geometry-extension-provider/` is a private reference package that is copied outside the repository during release verification and loaded only through public Anyo APIs. It demonstrates a provider kind that composes built-in geometry plus a provider kind that generates custom indexed topology, with ordinary modifier composition, `g2` provenance, ResourceGraph mesh baking, and procedural collision. See [`docs/GEOMETRY-EXTENSION-AUTHORING.md`](docs/GEOMETRY-EXTENSION-AUTHORING.md).
