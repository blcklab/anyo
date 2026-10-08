# Current continuation memory

- Version: `0.10.0-rc.3-dev.20`.
- S22.2 exposed an S15 semantic-railing collision bug: a swept polyline rail was represented by one AABB around the entire path, creating invisible blockers across atriums/mezzanines.
- Railing semantic collision now decomposes each swept rail into sampled local segment colliders while keeping posts as per-instance colliders. This is a generic Anyo collision fix; renderer, Player, and animation ownership do not change.
- Do not revert to one-AABB collision for non-convex/polyline rail sweeps. Open space inside a U/L-shaped railing must remain traversable.

# Anyo repository memory

## Current architecture
- Anyo owns renderer-neutral JSON world semantics, validation, normalization, compilation, runtime systems, and renderer adapters.
- `renderer-sekai64` is the preferred renderer path for Anyo worlds in the current project. Three.js remains optional and is not needed by the Sekai64 runtime.
- Procedural geometry definitions and deterministic tessellation now belong in the renderer-neutral `src/geometry/` subsystem of Anyo core. Sekai64 remains responsible only for GPU resources and rendering generated mesh data.

## Current geometry decision
- Built-in visual primitives now include `box`, `plane`, `cylinder`, `disc`, `cone`, and `sphere` plus existing text/image/model/light/audio primitives.
- `disc`: a thin circular solid using `radius` and optional `height` (default 0.04).
- `cone`: Y-up cone using `radius` and optional `height`.
- `sphere`: unit sphere scaled from `radius`; ordinary Anyo transform scale can turn it into an ellipsoid.
- All three new primitives remain renderer-neutral in compiled Anyo output.

## Sekai64 path
- `disc` reuses Sekai64's shared unit cylinder.
- `cone` uses Sekai64 `CylinderGeometry` with `radiusTop: 0`.
- `sphere` uses Sekai64 `SphereGeometry` added as an unreleased change on the Sekai64 0.8.0-rc.33 baseline.
- New primitives participate in the existing static-batching path when they are not dynamic/collidable.

## Recent changes
- Added compiler sizing, primitive kinds, semantic built-in recognition, Sekai64 adapter handling, optional Three parity, and regression tests.

## Packaging
- `.internal/` remains repository-only and is excluded by the npm `files` allow-list.


## 2026-09-15 safe merge
Merged the supplied Anyo/Sekai bug kit onto the existing third-person foundation. Player remains 0.5.1-dev.5 byte-for-byte unchanged. Keep the mesh-local skinning palette correction and Loader VRM0/VRM1 facing controls. Matched versions: Anyo 0.10.0-rc.2-dev.1, Sekai64 0.8.0-rc.34-dev.2, Loader 0.5.4-dev.13. Next milestones: locomotion animation, jump/fall/land animation, real GPU/WebGPU and XR validation.

## 2026-09-17 — Precision procedural geometry S1
- Baseline reconstructed from `0.10.0-rc.2-dev.2`; preserve `Sekai64CameraAdapter.setRotation()` using native `rotation.set(pitch, yaw, 0, 'XYZ')` for current Player compatibility.
- New development version: `0.10.0-rc.3-dev.1`.
- Geometry remains an internal subsystem of `@blcklab/anyo`; do not split a new npm package at this stage.
- Public modular entry point: `@blcklab/anyo/geometry`; geometry is not added to the root export barrel in S1.
- Geometry owns pure deterministic `definition -> mesh data` math only. No Sekai64, Three.js, DOM, Player, VRM, shaders, texture loading, or per-frame work is allowed under `src/geometry/`.
- Coordinate contract is inherited from existing Anyo: right-handed, +X east, +Y up, north -Z / south +Z, meters, Euler radians. Geometry front faces use CCW triangle winding.
- S1 adds renderer-neutral mesh/types, structured validation, conservative safety limits, canonical normalization, FNV-1a 64-bit deterministic cache keys, bounds, `GeometryCache`, and a pluggable `GeometryCompiler`.
- S1 intentionally ships no built-in primitive generators. S2 will register precision box/roundedBox/plane/sphere/cylinder/cone/capsule/disc/torus/polygon kinds through the same compiler.
- Cache boundary: entity transforms/materials are outside `GeometryDefinition`; transform or material changes therefore must not rebuild geometry. Kind-specific defaults must be resolved before hashing once S2 generators land.
- S10 remains distinct from S1 cache infrastructure: S1 caches definition -> mesh resources; S10 will add world-level dependency tracking and targeted invalidation/rebuilds.


## 2026-09-17 — Precision procedural geometry S2
- Version: `0.10.0-rc.3-dev.2`.
- S2 registers built-in `box`, `roundedBox`, `plane`, `sphere`, `cylinder`, `cone`, `capsule`, `disc`, `torus`, and simple `polygon` generators under `@blcklab/anyo/geometry`.
- Built-ins are available by default through `compileGeometry()` and `createGeometryCompiler()`. Extension kind compilers remain supported.
- Curved primitive quality presets resolve into explicit segment/ring counts before hashing; explicit authored values override presets and the `quality` hint is removed from normalized cache identity.
- `plane`, `disc`, and `polygon` use the existing XY/+Z front convention. Cylinder/cone/capsule/torus are Y-up. All generated triangle fronts must remain CCW/outward.
- `roundedBox` preserves the requested outer dimensions, clamps radius to half the smallest dimension, and uses segmented edge/corner rounding with outward normals.
- Polygon S2 is simple-contour only: duplicate closure/consecutive and collinear points are cleaned, winding is canonicalized, self-intersection is rejected, and concave contours use deterministic ear clipping. Holes remain S4 work.
- S2 emits practical primitive normals/UVs, but generalized normal modes/crease angles, projection-quality UV policy, tangents, and surface material groups remain S3.
- `circle` and `ring` from the long-term vocabulary are intentionally not introduced in S2 because the approved S2 development sequence names the ten primitives above.
- No Sekai64, Player, world schema, legacy entity primitive, VRM, animation, or camera behavior changed.


## 2026-09-17 — Architecture refinements queued after S2
- Keep S2 focused on precision primitive generators; do not redesign the compiler mid-stage.
- Future semantic architecture should resolve through an explicit Construction IR / geometry expression layer rather than emitting vertices directly.
- Construction resources should be modeled as a DAG so profiles, curves, geometry definitions, and other reusable resources can be shared without duplicated compilation.
- Formalize geometry identity separately from entity/instance identity: transforms and material assignment must never alter the cached geometry resource.
- Keep material compilation as a separate domain from geometry compilation so identical geometry can be instanced with different visual materials.
- Prefer semantic/procedural authoring levels for humans and AI; raw mesh data remains an escape hatch, not the primary authoring model.
- Anchors and constraints (attach, align, snap, offset, fit, repeat, mirror, parallel/perpendicular) are future construction-language features and must not be embedded ad hoc into primitive generators.
- Before renderer integration, establish a runtime resource model for GeometryResource, MaterialResource, InstanceResource, and AssetResource.
- Structured geometry/construction errors should retain machine-readable code/path/message and may later include repair suggestions for AI authoring.
- Stage discipline remains mandatory: complete, validate, and freeze one stage before modifying the next.


## 2026-09-17 — Surface quality S3
- Version: `0.10.0-rc.3-dev.3`.
- S3 adds a reusable renderer-neutral attribute-processing layer under `src/geometry/attributes/`; primitives remain responsible for topology while surface policy derives normals, UVs, and tangents.
- `normals` supports `flat` and `smooth` with a radian `creaseAngle`.
- `uv` supports `generated`, `planar`, `box`, `cylindrical`, and `spherical` projection plus `metersPerTile`, scale, rotation, and offset.
- `tangents: true` generates xyzw tangent attributes after normals/UVs are resolved; `w` stores handedness.
- Surface-policy normalization occurs before hashing, so attribute/topology-changing policy is part of geometry identity. Entity transforms and material assignment remain outside geometry identity.
- S2 primitives now emit renderer-neutral semantic groups. Face/cap/region names describe future assignment regions; every built-in defaults to material slot 0 and no material resource enters geometry compilation.
- S3 does not add profiles, extrusion, sweep, Construction IR, renderer integration, or world-schema changes. Those remain later stages.


## 2026-09-17 — Profiles and extrusion S4
- Version: `0.10.0-rc.3-dev.4`.
- S4 adds renderer-neutral `profiles/`, `triangulation/`, and `extrusion/` subsystems under `src/geometry/`; no new npm package is introduced.
- `normalizeProfile()` canonicalizes outer contours CCW, holes CW, removes duplicate closure/consecutive and safe collinear points, sorts holes deterministically, and rejects self-intersection, outside/touching holes, and overlapping/nested holes.
- `triangulateProfile()` performs deterministic visibility bridging plus ear clipping for valid concave profiles with holes; no new runtime triangulation dependency is added.
- Built-in `extrude` runs along local Z, supports caps/open extrusion, semantic regions (`front`, `back`, `outerSide`, `holeSide:N`), generated UVs, and S3 normal/UV/tangent policy reuse.
- Multi-segment bevels offset profile boundaries into solid material; every ring is validated and invalid/collapsed offsets fail with `EXTRUSION_BEVEL_COLLAPSE`.
- Architectural openings should use profile holes in S4. General CSG remains later work. Curves/sweep remain S5. Construction IR, Sekai64 integration, world-schema architecture, Player, VRM, animation, and camera behavior remain unchanged.


## 2026-09-17 — Curves, sweep, and path arrays S5
- Version: `0.10.0-rc.3-dev.5`.
- S5 adds renderer-neutral `curves/`, `sweep/`, and `path-array/` subsystems under `src/geometry/`; no new npm package is introduced.
- Supported curves: `line`, `polyline`, `quadraticBezier`, `cubicBezier`, and `catmullRom`. Sampling is deterministic, bounded by `maxCurveSegments`, and normalized before sweep hashing.
- `computeCurveFrames()` uses parallel-transport-style frame propagation, deterministic vertical/parallel fallback, and closed-loop seam correction. Do not replace it with per-sample world-up cross products because that reintroduces random sweep twisting.
- The authored `up` vector is profile +Y/binormal; profile +X is derived so `cross(profileX, profileY)` follows the tangent.
- Built-in `sweep` supports S4 profiles/holes, open or closed paths, optional open-path caps, semantic regions (`startCap`, `endCap`, `outerSide`, `holeSide:N`), generated perimeter/path UVs, and S3 normal/UV/tangent reuse.
- `layoutPathArray()` returns renderer-neutral placement/frame data and intentionally does not merge/bake repeated source geometry. Future instancing/resource stages should consume these placements while sharing one geometry resource.
- S5 preserves all S1-S4 cache/safety/surface contracts. No CSG, S6 modifiers, S7 architecture semantics, Construction IR, Sekai64, Player, world-schema, VRM, animation, or camera behavior changed.


## 2026-09-17 — Stable modifiers S6
- Version: `0.10.0-rc.3-dev.6`.
- S6 adds renderer-neutral `geometry/modifiers/` while keeping the package boundary unchanged.
- Built-in `transform` is a geometry-local expression with position, XYZ Euler rotation in radians, and non-zero scale. It recursively normalizes/compiles its `source` through the same `GeometryCompiler` and cache.
- Non-uniform scale transforms normals with inverse-scale + rotation; negative determinant transforms repair triangle winding and flip tangent `w` handedness.
- Built-in `mirror` supports x/y/z plane reflection, finite offset in meters, and `includeOriginal` (default true) for symmetry.
- Recursive modifier composition is bounded by the existing `maxModifierDepth` safety limit and reports `GEOMETRY_MODIFIER_LIMIT` instead of recursing unboundedly.
- `layoutGeometryArray()` returns deterministic renderer-neutral placements and one source definition. There is intentionally no baked `array` GeometryMesh kind in S6 because repeated geometry should become instances/resources later.
- Array placement count is bounded by `maxGeneratedInstances` with `GEOMETRY_INSTANCE_LIMIT`.
- Entity/world transforms remain outside geometry identity. Geometry-local transform/mirror parameters are inside geometry identity because they alter mesh data.
- Bend/twist/taper remain deferred. No S7 architecture semantics, CSG, Sekai64, Player, world-schema, VRM, animation, or camera behavior changed.


## 2026-09-17 — Semantic architecture S7
- Version: `0.10.0-rc.3-dev.7`.
- S7 adds renderer-neutral `geometry/architecture/` and the public `lowerArchitecture()` API. It is a scoped Construction IR: semantic definitions lower to `ArchitectureAssembly` parts, instance groups, and anchors; S7 does not change the existing Anyo world/entity schema.
- Architecture semantics are not added to `BUILTIN_GEOMETRY_KIND_NAMES`. They compose S2-S6 operations instead of generating custom vertices.
- Supported semantics: wall, floor, ceiling, doorOpening, windowOpening, stairs, railing, column, beam, roof, panel, and trim.
- Wall door/window openings are lowered by deterministic solid-region decomposition, not CSG. This allows floor-touching doors while preserving S4's strict profile-hole rules. Overlapping/out-of-bounds openings fail with structured architecture errors.
- Stairs keep tread/riser geometry shared and emit placements. Railings reuse S5 sweep for rails and path-array placement for posts. Trim is a sweep. Roof panels/columns/beams/slabs reuse lower-level primitive/transform definitions.
- Assemblies expose semantic anchors as future attach/snap/constraint inputs. S7 does not yet implement general constraints.
- Material assignment, GPU resources, renderer instancing, world-level resource DAGs, CSG, arbitrary-axis sloped wall/beam semantics, and runtime integration remain later work.
- Keep Sekai64, Player/MMORPG camera, VRM, animation, GLB, WebGPU/WebGL behavior, and existing world JSON semantics unchanged during S7.


## 2026-09-17 — Safe CSG S8
- Version: `0.10.0-rc.3-dev.8`.
- S8 adds built-in renderer-neutral `union`, `subtract`, and `intersect` geometry expressions under `src/geometry/csg/`; no new npm package is introduced.
- CSG operands must already compile to closed, outward-wound 2-manifold solids. Open/zero-volume/non-manifold operands fail before BSP processing with structured `CSG_SOLID_INVALID` guidance.
- Boolean nesting uses the previously reserved `maxBooleanDepth` independently from `maxModifierDepth`; BSP work/tree depth and input triangle counts are conservatively bounded to fail closed on pathological AI-authored inputs.
- The BSP core interpolates normals/UVs/tangents/colors on split edges. Subtraction flips cavity normals and tangent handedness correctly through polygon inversion.
- Raw BSP output is post-processed to conform collinear T-junction boundary vertices, then deterministically triangulated and revalidated as a closed 2-manifold triangle mesh. Do not remove this conformance step: classic BSP output can have mathematically closed but non-conforming T-junction edge segmentation.
- CSG semantic groups are renderer/material-neutral: `left:<region>`, `right:<region>`, and subtraction cutter surfaces `cut:<region>`; all default to material slot 0.
- Top-level S3 normal/UV/tangent policy remains reusable after CSG. CSG parameters/children are geometry identity; entity transforms/material assignment remain outside geometry identity.
- S7 architecture remains independent from CSG: ordinary rectangular door/window openings still lower by solid-region decomposition. CSG is an opt-in lower-level construction tool for shapes that cannot be represented cleanly by profile holes/decomposition.
- Sekai64, Player/MMORPG camera, VRM, animation, GLB, WebGPU/WebGL behavior, and existing Anyo world JSON semantics remain unchanged in S8.


## 2026-09-17 — Resource/composition DAG S9
- Version: `0.10.0-rc.3-dev.9`.
- S9 adds the opt-in renderer-neutral `@blcklab/anyo/resources` subpath under `src/resources/`; no new npm package is introduced and the root barrel remains unchanged.
- Resource domains are explicit: `GeometryResource`, `MaterialResource`, `AssetResource`, and `InstanceResource`.
- Geometry/material/asset resources are content-addressed and deduplicated. `InstanceResource` deliberately keeps semantic identity (`instance:<id>`) separate from its `i1-*` content key, so identical instances never collapse into one authored object.
- Geometry resources normalize through the existing `GeometryCompiler` before identity. Nested transform/mirror and union/subtract/intersect children become explicit geometry-resource dependency edges.
- Material resources normalize through the existing visual contract before hashing. Material-to-asset dependencies are explicit; never guess asset ids from opaque texture strings.
- `ResourceGraph` validates missing/wrong-kind references and cycles, provides deterministic dependencies-first topological order, direct/transitive dependency/dependent queries, deterministic graph snapshots/identity, and `invalidationSet()` impact planning.
- S9 invalidation is metadata only. Do not perform renderer allocation, GPU mutation, or incremental recompilation inside the resource graph; that belongs to the next runtime/incremental stage.
- S6 linear arrays become shared geometry + instance resources. S5 path-array instances preserve transported tangent/normal/binormal frames so future renderers can orient instances without reconstructing path math.
- S7 architecture assemblies lower directly into shared geometry resources and semantic instances; optional materials may be assigned by S7 role without changing geometry identity.
- Resource graph safety limits bound resource, edge, and instance counts for AI-authored data.
- Existing world JSON/entity semantics, Sekai64, Player/MMORPG camera, VRM, animation, GLB, and WebGPU/WebGL behavior remain unchanged in S9.


## 2026-09-17 — Incremental resource planning S10
- Version: `0.10.0-rc.3-dev.10`.
- S10 remains inside `@blcklab/anyo/resources`; no new npm package and no renderer integration.
- `diffResourceGraphs(previous, next)` deterministically classifies added, removed, reused, and stable instance updates.
- `planResourceGraphTransition(previous, next)` produces pure reuse/compile/create/invalidate/update/remove/release metadata; it performs no compilation, GPU allocation, renderer mutation, or disposal itself.
- Geometry/material/asset resources are content-addressed and immutable by id across a transition. Changed content must receive a new id. Manual graphs that mutate a content-addressed id or reuse the same key for different canonical content fail with `RESOURCE_DIFF_IDENTITY_MISMATCH`.
- `InstanceResource` keeps semantic id stability and may update source/materials/transform/frame/metadata in place. Deltas classify exact changed fields, using `composite` for multi-field edits.
- Compile order is next-graph dependencies-first. Removed instances detach before obsolete non-instance resources release; release order is previous-graph dependents-first.
- Initial mount is represented by `previous = null`; full disposal by `next = null`; identical graph transitions are true no-ops.
- S5 path arrays and S6 arrays preserve shared source geometry through transitions; placement edits become instance deltas/removals instead of geometry churn.
- S10 is the execution boundary before renderer integration. The next stage may consume transition plans to realize/cache/release renderer resources, but must not collapse semantic instance identity or move renderer code into Anyo geometry/resource definitions.
- Sekai64, Player/MMORPG camera, World Loader, VRM, animation, GLB, WebGPU/WebGL behavior, and existing world JSON semantics remain unchanged in S10.


## 2026-09-17 — Resource realization/cache lifecycle S11
- Version: `0.10.0-rc.3-dev.11`.
- S11 remains inside the opt-in `@blcklab/anyo/resources` subpath; no new package and no renderer dependency is introduced.
- `ResourceRealizer` consumes the pure S10 `ResourceTransitionPlan` through adapter-owned `prepare`, `createInstance`, `updateInstance`, `removeInstance`, and `release` hooks. Opaque adapter handles are cached by S9/S10 resource identity.
- Transition rule: stage new geometry/material/asset handles first, then new semantic instances, then stable instance updates. Only after those succeed does the next graph become active and obsolete handles retire.
- Failed prepare/create/update triggers best-effort rollback in reverse order: reverse stable-instance deltas, remove staged instances, release staged resources. Any rollback failure faults the realizer and blocks future transitions because adapter state can no longer be proven consistent.
- Post-commit cleanup failures are different: the graph stays committed, failed removals/releases remain in a retryable retired queue, and `flushRetired()` or the next transition retries them. Do not treat cleanup failure as pre-commit rollback.
- Concurrent transitions are rejected. Cache/graph mismatches fail closed with `RESOURCE_REALIZATION_STATE_MISMATCH`. `dispose()` is `transition(null)`.
- Keep S11 renderer-neutral. Do not import Sekai64 into `src/resources/realization.ts` and do not teach resource definitions about GPU/renderer handles. Sekai64 should implement the S11 hooks in the next integration stage.
- Existing world schema/runtime semantics, Player/MMORPG camera, VRM, animation, GLB, WebGPU/WebGL behavior remain unchanged in S11.


## 2026-09-17 — Sekai64 realization adapter S12
- Version: `0.10.0-rc.3-dev.12`.
- S12 does not modify `src/resources/` or geometry architecture. Integration lives only in the existing `@blcklab/anyo/renderer-sekai64` subpath to avoid a circular Sekai64 -> Anyo dependency.
- `Sekai64ResourceAdapter` consumes the S11 lifecycle: geometry -> Sekai64 `Geometry`, material -> shared `StandardMaterial`, texture/image assets -> shared `Texture`, semantic instances -> non-owning native nodes. Mesh disposal never owns shared resource handles; S11 retirement owns release order.
- Stable semantic instance deltas update the same native node. Source/material replacement uses `Mesh.setGeometry` / `setMaterial` with `disposePrevious:false`, so old shared handles remain alive until S11 post-commit retirement.
- S5 transported frame convention is preserved as local +X=normal, +Y=binormal, +Z=tangent; authored local XYZ rotation composes after the frame orientation.
- Material texture references remain explicit: do not guess opaque aliases. Exact src match and the unambiguous one-reference/one-dependency case are supported; ambiguous materials require `resolveMaterialAsset`.
- Built-in asset preparation covers texture/image resources. Model/VRM/GLB/custom resources use host-provided `prepareAsset`, `createAssetInstance`, and optional `releaseAsset` hooks so the existing Sekai64 loader stack can be reused without moving it into core.
- `createSekai64RendererResourceAdapter()` binds to mounted `Sekai64Renderer.getNativeAccess()` and registers realized nodes through the existing trusted external-node identity/picking bridge.
- Current Sekai64 Mesh supports one material. S12 rejects multiple material resources explicitly instead of ignoring geometry material slots. Add true Sekai64 material-group rendering before relaxing this.
- Sekai64 package source itself remains unchanged in S12. Player/MMORPG camera, World Loader, VRM animation, GLB, WebGPU/WebGL behavior, and existing world JSON semantics remain frozen.


## 2026-09-18 — Semantic multi-material realization S13
- Version: `0.10.0-rc.3-dev.13`.
- S13 keeps geometry identity material-neutral and adds per-instance `materialBindings` from semantic GeometryGroup names to MaterialResource ids.
- `materials[]` remains the numeric material-slot table; semantic bindings are per-instance overrides and are explicit ResourceGraph dependencies/content identity.
- S10 classifies binding changes as stable `materials` instance deltas; S11 updates the existing realized instance transactionally.
- `Sekai64ResourceAdapter` forwards GeometryMesh.groups to Sekai64 and builds one Mesh with shared Geometry plus multiple Material slots; it does not clone geometry per region.
- Unknown group-name bindings report `SEKAI64_RESOURCE_MATERIAL_REGION_UNKNOWN`; unavailable numeric slots report `SEKAI64_RESOURCE_MATERIAL_SLOT_MISSING`.
- Sekai64 dev.4 supplies native material draw groups and per-group render ranges. Do not reintroduce the old S12 multi-material rejection or per-region geometry cloning.
- Player/MMORPG camera, VRM, animation, GLB, world schema, and existing S1-S12 construction/resource semantics remain compatibility boundaries.
## 2026-09-18 — S14 JSON-native procedural resources
- Version: `0.10.0-rc.3-dev.14`.
- World schema `0.8` is additive/opt-in; `@blcklab/anyo/schema` remains the 0.7 default for compatibility and `@blcklab/anyo/schema/0.8` exposes the procedural schema.
- `geometries` is a reusable world-level geometry library. `type: "geometry"` accepts a named id or inline GeometryDefinition. `type: "construction"` lowers the existing S7 ArchitectureDefinition; no renderer-specific wall/stair/etc. types were added.
- Schema-0.8 procedural entities compile internally to the existing S9-S13 ResourceGraph. Stable entity nodes own ResourceGraph instance ids and authored instance transforms so runtime entity movement updates realized nodes without rebuilding geometry or collapsing multi-part construction offsets.
- S13 `materialBindings` is exposed directly in JSON; do not create another material-region system.
- Sekai64 integration realizes `CompiledWorld.resourceGraph` through the existing S12 adapter. Player, camera, VRM, animation, and Sekai64 package source remain regression boundaries.
- S14 deliberately does not add procedural collision. S15 must lower procedural collision into Anyo's collider domain without a duplicate invisible world shell.
- Validation rejects procedural declarations on 0.7 and checks named geometry/material-binding references.
- S14 targeted tests: 9/9 pass. Full Anyo regression after hardening: 354/354 pass.


## 2026-09-18 — JSON-native procedural collision S15
- Version: `0.10.0-rc.3-dev.15`.
- S15 lowers schema-0.8 procedural collision into the existing renderer-neutral `CompiledCollider`/AABB domain; no second physics path and no triangle-mesh engine were added.
- Procedural authoring adds `collisionPolicy: none | bounds | semantic | parts`. `collision: true` remains compatible: geometry defaults to `bounds`, construction defaults to semantic part lowering. An explicit collision policy may opt a procedural entity in without legacy `collision: true`; `collision: false` or a disabled `anyo.collider` disables it.
- `bounds` compiles deterministic geometry bounds through the entity transform. Construction `semantic`/`parts` reuse S7 lowering and emit colliders per part/placement, preserving wall door/window openings.
- S7 floors lower to `floor` colliders; stairs lower to `stair` colliders; other supported construction parts lower to `solid` colliders.
- Generic geometry does not accept `semantic`/`parts` yet. It fails with `ANYO_PROCEDURAL_COLLISION_POLICY_UNSUPPORTED` instead of silently creating incorrect collision.
- Procedural colliders carry `entityId`, participate in normal room collider lists when room-scoped, and therefore reuse existing change classification/full-rebuild behavior for authored collidable transform edits.
- Runtime-only transform layers do not mutate collision topology; dynamic/moving collision remains a later explicit physics/runtime concern, matching existing legacy collision behavior.
- Player remains frozen at the dev.9 MMORPG camera/orbit baseline; Sekai64 and animation packages are unchanged in S15.


## 2026-09-18 — Generic organic noise modifier S16
- Version: `0.10.0-rc.3-dev.16`.
- `kind: "noise"` is a generic geometry modifier, not a cloud/rock/mountain object type. It wraps `source` and deforms the compiled mesh along source normals using a small deterministic 3D value-noise/fBm implementation with no runtime dependency.
- Normalized parameters: signed 32-bit `seed` (default 0), positive `frequency` (1), non-negative `strength` (0.1m), `octaves` 1..16 (1), positive `lacunarity` (2), `persistence` 0..1 (0.5), and sampling-space `offset` ([0,0,0]).
- Noise coordinates are `localPosition * frequency + offset`; this keeps `offset` independent of frequency and suitable for future bounded procedural regeneration without changing its meaning.
- Source UVs/colors/groups/indices survive deformation; bounds and normals are rebuilt and source tangent capability is regenerated when present. Do not retain stale surface attributes after CPU deformation.
- `ResourceGraphBuilder.geometryChildren()` treats noise like transform/mirror so the wrapped source is an explicit geometry dependency.
- Runtime entity movement remains an S14 resource-instance transform and never recompiles noise geometry. S15 bounds collision can consume the deformed bounds without a new collision engine.
- S16 does not animate `noise.offset` per frame. Generic property animation remains S18 and CPU geometry-parameter animation must stay bounded/separate.
- Sekai64, Player dev.9, Anyo Animation, Animation Clip, VRM/camera behavior remain frozen.

## 2026-09-18 — Lathe/revolve and generic deformation S17
- Version: `0.10.0-rc.3-dev.17`.
- `kind: "lathe"` revolves a strictly increasing `[radius,height]` profile around local Y. Non-negative radii are allowed, zero-radius poles are handled without duplicate degenerate quads, quality defaults resolve radial segments, and optional non-zero-radius end caps produce semantic `surface`, `startCap`, and `endCap` groups.
- `kind: "bend"`, `kind: "twist"`, and `kind: "taper"` are generic source-wrapping CPU geometry modifiers. Do not add vase/lamp/column/cloud/rock-specific geometry in their place.
- `bend` uses `axis` + perpendicular `direction` + total `angle`; `twist` uses `axis` + total `angle`; `taper` uses `axis`, non-negative `startScale`, and non-negative `endScale` (not both zero).
- Deformation maps source vertices, preserves UV/color/index/group semantics, then repairs normals and tangents. Bounds are recomputed by finalization.
- ResourceGraph source traversal must continue treating bend/twist/taper exactly like transform/mirror/noise so wrapped geometry is an explicit dependency.
- Lathe uses existing maxProfilePoints/maxCurveSegments/maxGeometryVertices; bend/twist/taper use maxModifierDepth. No new dependency or renderer feature was introduced.
- Schema 0.8 accepts all S17 definitions through the existing generic geometry-definition surface; runtime transforms remain outside geometry identity and S15 bounds collision consumes final deformed bounds.
- Full Anyo regression after S17 implementation: 382/382 pass before release hardening.
- Sekai64 dev.4, Player dev.9, Anyo Animation, Animation Clip, VRM/camera behavior remain frozen.



## 2026-09-18 — Mixed external assets S20
- Version: `0.10.0-rc.3-dev.18`.
- Schema-0.8 static model entities (`type: model` + asset `type: model`, excluding VRM) now compile into `AssetResource -> InstanceResource`; world 0.7 remains on the legacy model primitive path.
- VRM and `animated-model` assets intentionally remain legacy/Player-owned. Do not route them through the generic S20 path unless a later milestone explicitly redesigns the character ownership contract.
- ResourceGraph-backed static model entities have no duplicate model primitive. Their stable entity node owns a resource-instance id, so S14 runtime transforms move the realized asset node without rebuilding ResourceGraph.
- Static model collision remains optional authored AABB collision; S20 does not add triangle-mesh physics.
- `renderer-sekai64/resourceAssetHooks.ts` adapts AssetResource definitions to Sekai64's existing `AssetLoaderRegistry`. The prepared handle is an immutable loader recipe; concrete semantic instances call the registered loader with the instance id and own their normal loader lifecycle.
- The same content-addressed AssetResource can feed multiple instances. Underlying fetch/resource caching stays inside the registered Sekai64 loader/AssetManager rather than being duplicated in Anyo core.
- Sekai64 package source, Player dev.9, Anyo Animation dev.29, and Animation Clip remain frozen in S20.


## S22.1 multi-texture ResourceGraph hotfix (dev.19)
- Version: `0.10.0-rc.3-dev.19`.
- `compileWorldResourceGraph()` lowers schema-0.8 material texture asset keys to explicit content-addressed `AssetResource` ids.
- Sekai64 ResourceAdapter resolves direct dependency ResourceIds before source-string fallback, removing ambiguity for materials with multiple textures.
- Regression coverage includes normal + metallic-roughness + AO material realization.

## S23 generic compositions (dev.21)

- Schema 0.8 adds top-level `compositions` and entity `composition` references as a clearer authoring surface for reusable semantic subtrees.
- Compositions normalize to ordinary `group` roots and reuse the existing prefab/template expansion machinery. Do not add renderer-specific composition ownership.
- Supports nested compositions, legacy prefab children, JSON-pointer overrides, repeat, composition inheritance, deterministic namespacing/provenance, cycle/depth validation, dependency graph tracking, and stable patch targeting with `compositionId`.
- Existing schema 0.7 and `prefabs` stay compatible.
- ResourceGraph continues to share geometry/material resources across instances; runtime transforms are not part of composition resource identity.

## 2026-09-21 — S24 DOM projection hotfix (0.10.0-rc.3-dev.22)
- Focused blocker proven by World Loader placement-lab video: the DOM Web Surface fallback used width/height + rotation only, so oblique screens drifted away from their physical plane.
- `projectWebSurface()` now returns projected top-left/top-right/bottom-right/bottom-left corners in addition to the legacy rectangle fields.
- `WebSurfaceRuntime` maps the live DOM rectangle to those corners with a projective CSS `matrix3d()` transform.
- Existing renderer-neutral world schema and target ownership remain unchanged.
- Important limitation: DOM fallback is not GPU depth-tested and can draw over VRM/scene geometry. True occlusion still requires texture presentation / a host browser provider.

## 2026-09-21 — S24 perspective precision hotfix (0.10.0-rc.3-dev.23)
- Root cause from real Chrome video: `matrix3d()` coefficients were serialized with 1e-3 layout rounding; projective denominator terms near 1e-4/1e-5 were therefore doubled or collapsed to zero at oblique view angles.
- `WebSurfaceRuntime` now serializes projective coefficients at 1e-12 precision while retaining ordinary 1e-3 layout rounding for pixel width/height.
- A regression reconstructs the four CSS-transformed corners and requires <0.01 px error versus `projectWebSurface()` corners.
- This remains DOM-overlay presentation; it does not add GPU depth occlusion against VRM/scene geometry.
### 2026-09-21 — dev.24 Web Surface nested-root origin fix
- `WebSurfaceRuntime` still receives renderer projections in browser viewport coordinates. When a host supplies a DOM fallback `root` inside an offset player viewport, runtime layout now subtracts `root.getBoundingClientRect().left/top` before building the homography or fallback translate transform.
- This is generic host-root localization, not World Loader-specific math. A body/fullscreen root at `(0,0)` is unchanged.
- Regression: custom root at `(600,150)` must map viewport projected top-left `(800,300)` to local `(200,150)`.
- This fixes the dev.59 fullscreen-root regression where fullscreen worked but windowed Loader presentation was clipped/offscreen.


## 2026-09-21 — dev.25 stable Web Surface DOM viewport
- Preserve dev.24 placement/homography/origin math.
- When a DOM Web Surface declares `presentation.resolution`, use that as the stable element/CSS viewport and project it to the current four screen corners.
- Camera distance must never resize the logical web layout viewport; only projection changes. Legacy surfaces without presentation resolution retain projected-pixel sizing.

## 2026-09-22 — S24 browser-native overlay contract (0.10.0-rc.3-dev.26)
- Added `presentation.type: "overlay"` as the first-class standards DOM/iframe presentation above the renderer canvas.
- `resolution` is a stable logical CSS viewport; the existing four-corner projective CSS transform maps it to the world-space plane.
- Omitted `renderMode` compiles overlay presentation to `dom-overlay`; explicit legacy `renderMode: "dom-overlay"` remains supported.
- Overlay is intentionally not GPU-depth-tested. Use physical texture presentation for monitors/TVs/world geometry that must occlude correctly.

## 2026-09-23 — published baseline → frozen S24 reconciliation
- Supplied published baseline: `0.10.0-rc.1`.
- Frozen S24 implementation baseline: `0.10.0-rc.3-dev.26`.
- Runtime/source behavior follows the frozen S24 handoff; target-only useful docs/examples/tests and repository release identity were preserved where a target baseline was supplied.
- No post-S24 Web Surface/browser features were added.
- Development pins between BLCKLAB packages were aligned to the reconciled S24 versions; release packages remain peer-dependency based.
- `.internal/` is repository-only and must remain excluded from npm package contents.
- Validation status for this reconciliation is recorded in the final validation report; real GPU/browser/VRM checks remain a separate real-machine gate.
## 2026-09-23 — S24 published-baseline reconciliation validation
- Published baseline supplied: `0.10.0-rc.1`; reconciled frozen S24 version: `0.10.0-rc.3-dev.26`.
- Runtime `src/` and schemas remain byte-identical to the frozen S24 handoff.
- Automated validation: TypeScript typecheck PASS; build PASS; Node regressions 408/408 PASS; exports/boundaries/stability/package/size/Track-F gates PASS when local S24 Sekai64 is linked for validation.
- Final `npm pack --dry-run` PASS and excludes `.internal/`, tests, node_modules, patches, and build cache.
- Real WebGL2/WebGPU/browser/VRM visual validation remains a real-machine gate and was not run in this sandbox.
