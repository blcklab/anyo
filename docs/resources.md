# Resource graph

`@blcklab/anyo/resources` is the renderer-neutral resource/composition layer introduced in `0.10.0-rc.3-dev.9` (S9) and extended with incremental transition planning in `0.10.0-rc.3-dev.10` (S10). It formalizes identity, sharing, dependency edges, invalidation, and safe graph transitions without allocating renderer or GPU objects.

## Resource domains

- `GeometryResource` owns one normalized procedural geometry definition and its geometry-resource dependencies.
- `MaterialResource` owns one normalized Anyo material definition and explicit asset-resource dependencies.
- `AssetResource` owns one canonical authored asset definition and optional asset-resource dependencies.
- `InstanceResource` references one geometry or asset resource plus zero or more material resources and a transform.

Geometry, material, and asset resources are content-addressed. Equivalent normalized definitions share the same resource id. Instances are intentionally different: the semantic instance id is authoritative, while a separate content key records whether two instance payloads are otherwise identical.

```ts
import { createResourceGraphBuilder } from '@blcklab/anyo/resources'

const builder = createResourceGraphBuilder()
const geometry = builder.addGeometry({ kind: 'roundedBox', size: [1, 2, 0.2], radius: 0.03 })
const material = builder.addMaterial({ baseColor: '#222222', roughness: 0.8 })

builder.addInstance({
  id: 'lobby/panel-left',
  source: geometry,
  materials: [material],
  transform: { position: [-1, 1, 0] },
})
builder.addInstance({
  id: 'lobby/panel-right',
  source: geometry,
  materials: [material],
  transform: { position: [1, 1, 0] },
})

const graph = builder.build()
```

The two instances above remain distinct while sharing one geometry resource and one material resource.

## Explicit dependency DAG

Nested procedural expressions are represented as dependencies instead of hidden implementation detail. A CSG expression such as `subtract(transform(box), sphere)` produces separate geometry resources for the normalized child expressions and a parent resource that depends on them.

The graph is required to be acyclic. Missing references, wrong resource kinds, cycles, and configured graph limits fail with structured `ResourceGraphError` issues.

```ts
const snapshot = graph.snapshot()
console.log(snapshot.key)
console.log(snapshot.topologicalOrder)
```

`topologicalOrder` is deterministic and dependencies-first.

## Materials and assets

S9 normalizes material defaults through Anyo's existing visual contract before hashing. This means an omitted default and the equivalent explicitly-authored default share a material resource.

Asset links from a material remain explicit:

```ts
const texture = builder.addAsset({
  type: 'texture',
  src: './textures/wall.ktx2',
  colorSpace: 'srgb',
})

const wallMaterial = builder.addMaterial(
  { baseColorTexture: 'wall' },
  { assets: [texture] },
)
```

S9 does not guess whether arbitrary texture strings are URLs, world asset keys, or package references.

## Arrays, path arrays, and architecture

`addGeometryArray()` consumes the S6 linear-array contract and produces many instance resources that all reference one geometry resource.

`addPathArray()` consumes the S5 path-array contract. Transported tangent/normal/binormal frames are preserved on the instance resources so path-aligned orientation is not lost before renderer integration.

`addArchitecture()` lowers an S7 semantic architecture definition first, then converts its parts and instance groups into shared resources. Optional materials can be mapped by architecture role.

```ts
const { instances } = builder.addArchitecture(
  {
    type: 'stairs',
    id: 'main-stairs',
    width: 1.8,
    height: 3,
    steps: 14,
    depth: 4.5,
  },
  {
    materialsByRole: {
      'stairs:tread': { baseColor: '#242424' },
      'stairs:riser': { baseColor: '#181818' },
    },
  },
)
```

## Invalidation planning

S9 does not execute incremental recompilation. It only gives the next runtime stage the dependency information required to do it safely.

```ts
const affected = graph.invalidationSet([texture])
```

If `texture -> material -> wall instance`, the returned set contains those resources in dependencies-first topological order. Unrelated geometry and instances remain outside the invalidation plan.

Use `dependenciesOf(id, { transitive: true })` and `dependentsOf(id, { transitive: true })` for inspection and tooling.

## Deliberate S9 boundaries

S9 does not:

- allocate GPU buffers, textures, materials, or renderer objects;
- change the existing world/entity JSON schema;
- run incremental compilation or hot replacement;
- change Sekai64, Anyo Player, VRM, animation, camera, GLB, or WebGPU/WebGL behavior;
- merge instance identity into geometry identity;
- infer asset dependencies from opaque material texture strings.

The resource graph is the stable intermediate model for future incremental compilation, renderer instancing, resource streaming/eviction, and world-level dependency compilation.


## S10 graph diffs and transition plans

S10 adds two pure planning APIs:

```ts
import { diffResourceGraphs, planResourceGraphTransition } from '@blcklab/anyo/resources'

const diff = diffResourceGraphs(previousGraph, nextGraph)
const plan = planResourceGraphTransition(previousGraph, nextGraph)
```

`diffResourceGraphs()` classifies new, removed, reused, and in-place-updated semantic instances. A content-addressed geometry/material/asset id is immutable: if canonical content changes, the changed content must appear under a new resource id. The planner rejects manual graphs that mutate a content-addressed id or reuse a content key for different canonical content.

Stable `InstanceResource` ids may update in place. Each `InstanceResourceDelta` reports the exact changed fields from `source`, `materials`, `transform`, `frame`, and `metadata`; a multi-field edit is classified as `composite`. This lets a future renderer distinguish transform-only work from source/material replacement without losing semantic identity.

`planResourceGraphTransition()` returns deterministic phases:

- `reuse` — unchanged resources carried forward with no work;
- `compile` — new geometry/material/asset resources in dependencies-first order;
- `createInstances` — newly authored semantic instances;
- `invalidate` / `updateInstances` — stable instances whose payload changed;
- `removeInstances` — obsolete instances detached before dependencies are released;
- `release` — obsolete non-instance resources in dependents-first order.

Passing `null` as the previous graph creates an initial-mount plan. Passing `null` as the next graph creates a full-disposal plan. A graph-to-identical-graph transition is a true no-op with all resources in `reuse`.

S10 does not execute compilation or release callbacks. It deliberately stops at a deterministic renderer-neutral plan; GPU/resource realization and adapter integration remain the next stage.


## S11 realization/cache lifecycle

S11 adds a renderer-neutral executor for S10 plans:

```ts
import { createResourceRealizer } from '@blcklab/anyo/resources'

const realizer = createResourceRealizer({
  prepare,
  createInstance,
  updateInstance,
  removeInstance,
  release,
})

const result = await realizer.transition(nextGraph)
```

The hooks own every concrete handle. Anyo stores those handles opaquely and only controls dependency-safe lifecycle order. `prepare()` receives geometry/material/asset resources in dependencies-first order. `createInstance()` runs after required source/material handles exist. Stable semantic instances are updated through the exact S10 `InstanceResourceDelta`.

### Transaction boundary

Before commit, S11 stages all new non-instance handles and new instance handles. If prepare/create/update fails, it attempts to restore the previous realization by:

1. applying reverse instance deltas in reverse update order;
2. removing newly-created instances in reverse creation order;
3. releasing newly-prepared resources in reverse prepare order.

If any rollback hook fails, the realizer is marked faulted and rejects later transitions with `RESOURCE_REALIZATION_FAULTED`. This is intentionally conservative: S11 will not claim the old graph is safely realized when adapter rollback is incomplete.

### Post-commit retirement

Once staging and stable-instance updates succeed, the next graph becomes active. Obsolete instance/resource handles are moved into a retired queue and cleaned up using S10's `removeInstances` and dependents-first `release` order. A cleanup hook failure is retryable and is returned in `result.cleanup`; it does not roll back the committed graph. Call `flushRetired()` to retry. New transitions automatically retry pending retirement first.

`dispose()` is shorthand for `transition(null)`. `snapshot()` exposes deterministic active/retired ids for diagnostics. Concurrent transitions are rejected with `RESOURCE_REALIZATION_BUSY`.

### Deliberate S11 boundary

S11 still does not know what a GPU buffer, WebGL/WebGPU object, Sekai64 mesh/material, streaming resource, or renderer scene node is. Those belong to an adapter implementing the hooks above. This keeps Anyo's resource graph/lifecycle reusable across renderers and leaves Sekai64 integration as the next explicit stage.


## S12 Sekai64 realization adapter

The first concrete S11 adapter lives in the optional `@blcklab/anyo/renderer-sekai64` subpath rather than in `@blcklab/anyo/resources`. This keeps the resource DAG/lifecycle renderer-neutral while avoiding a circular dependency from Sekai64 back to Anyo.

```ts
import { Scene } from '@blcklab/sekai64'
import { createSekai64ResourceAdapter } from '@blcklab/anyo/renderer-sekai64'

const adapter = createSekai64ResourceAdapter({ scene: new Scene() })
await adapter.transition(graph)
```

Geometry resources compile through the existing Anyo `GeometryCompiler` and become Sekai64 `Geometry` objects. Materials become shared `StandardMaterial` objects, texture/image assets become shared `Texture` objects, and semantic instances become non-owning native nodes. S11 remains responsible for dependency-safe release.

Stable instance transforms, transported S5 frames, geometry replacement, and material replacement update the same native semantic instance. The adapter never lets a mesh dispose shared geometry/material handles during replacement.

Texture aliases are not guessed. If a material has exactly one texture reference and one explicit asset dependency, the binding is unambiguous. Exact asset `src` matches are also accepted. Ambiguous multi-texture materials must provide `resolveMaterialAsset`.

Model/VRM/GLB/custom assets are deliberately host-extensible through `prepareAsset`, `createAssetInstance`, and `releaseAsset`, allowing the existing Sekai64 loader stack to remain the owner of those formats.

### S20 static world-model assets

In schema 0.8, ordinary static `type: "model"` entities backed by an asset whose `type` is `model` are compiled into the same ResourceGraph as procedural geometry. A single content-addressed `AssetResource` can therefore feed multiple semantic `InstanceResource` nodes. The Sekai64 renderer bridge resolves those resources through its existing `AssetLoaderRegistry`; no GLB-specific object type is added to ResourceGraph or Sekai64 core.

VRM and `animated-model` assets remain on the established legacy/Player path. This is intentional: character normalization, humanoid animation targets, root motion, and third-person ownership remain separate from generic static-prop realization. World schema 0.7 keeps its legacy model behavior unchanged.

Sekai64 dev.4 supports geometry draw groups and multiple material slots. S13 maps `GeometryGroup` ranges plus `InstanceResource.materialBindings` into those slots while preserving shared geometry; unknown semantic regions fail closed instead of silently rendering the wrong material.
