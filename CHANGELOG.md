## 0.10.0-rc.4 — generic realism authoring foundation

- Added deterministic `repeat.variation` for author-time position, rotation, and scale variation without per-frame runtime cost.
- Variation is seeded and identity-stable so repeated vegetation, rocks, props, clouds, debris, and architectural details remain reproducible.
- Added generic material `textureTransform` authoring with UV scale, offset, and rotation, realized by Sekai64 WebGL2/WebGPU.
- Added renderer-neutral `textureWrap` (`clamp-to-edge`, `repeat`, `mirror-repeat`, including per-axis control) so transformed UVs can intentionally tile instead of clamping at the 0–1 range.
- Kept the feature renderer-neutral and object-agnostic: no tree, cloud, rock, weather, or realism-specific engine systems were introduced.
- Added validation for bounded variation ranges, safe non-zero texture scales, and valid texture wrap modes.

## 0.10.0-rc.3 — first-class browser-native Web Surface overlay

- Add `presentation.type: "overlay"` as the canonical browser-native DOM/iframe-over-canvas presentation contract.
- Overlay presentation may declare a stable logical CSS `resolution`; camera distance changes projection without changing responsive page layout.
- Omitted `renderMode` routes overlay presentation directly to the existing `dom-overlay` runtime. Existing `renderMode: "dom-overlay"` remains backward-compatible.
- Keep the boundary explicit: overlay surfaces are not renderer-depth-tested; physical depth/occlusion remains `presentation.type: "texture"`.

## 0.10.0-rc.3-dev.25 — stable DOM Web Surface logical viewport

- Managed DOM Web Surfaces that declare `presentation.resolution` now keep that authored logical CSS viewport fixed while camera projection changes.
- Camera distance changes only the projective transform/onscreen size; it no longer changes the iframe/application layout viewport and therefore does not trigger distance-driven responsive reflow.
- Legacy DOM surfaces without `presentation.resolution` preserve projected-pixel sizing for compatibility.
- No world placement, four-corner homography, or nested-root origin math changed from dev.24.

# 0.10.0-rc.3-dev.24

- Fixed managed DOM Web Surface placement when the overlay root is nested inside a non-zero-offset host such as World Loader. Viewport-projected monitor corners are now localized against the DOM root bounds before the projective transform is applied, so windowed and fullscreen presentation share the same coordinate space.
- Added regression coverage for custom overlay roots whose viewport origin is not `(0, 0)`.

# 0.10.0-rc.3-dev.23

- Preserve high-precision projective CSS matrix coefficients for DOM Web Surfaces so oblique monitor placement does not drift or peel away from the projected plane.
- Add a regression that maps all four transformed DOM corners back to the projected surface within 0.01 px.

# 0.10.0-rc.3-dev.22

- Fix managed DOM Web Surface placement at oblique camera angles by projecting all four plane corners and applying a projective CSS matrix.
- Preserve the existing renderer-neutral Web Surface contract and DOM fallback semantics; this does not add DOM depth testing.

# 0.10.0-rc.3-dev.21

Generic semantic compositions S23 for world schema 0.8.

- Add top-level `compositions` plus entity `composition` references as a clear schema-0.8 authoring surface for reusable semantic subtrees.
- Reuse the existing prefab/template expansion machinery internally rather than creating a second scene ownership system. Composition roots normalize to ordinary renderer-neutral `group` entities.
- Support nested compositions, legacy prefab children, JSON-Pointer `overrides`, `repeat`, deterministic child id namespacing, stable authoring provenance, inheritance, cycle/depth diagnostics, and explicit dependency-graph tracking.
- Add stable transaction targeting for composition definitions through `compositionId`.
- ResourceGraph remains content-addressed: composition instances duplicate semantic transforms/instances, not geometry/material buffers. Runtime transforms remain outside composition/resource identity.
- Keep schema 0.7 and existing `prefabs` fully compatible. Compositions are opt-in schema 0.8 authoring only.
- No Sekai64, Player, VRM, animation, camera, collision, or renderer behavior changes.

# Changelog

## 0.10.0-rc.3-dev.20

- Fix semantic railing collision so swept top/mid rails are lowered into local path-segment AABBs instead of one giant AABB spanning the whole polyline.
- Preserve per-post railing colliders and existing wall/stair/floor collision semantics.
- Prevent mezzanine/atrium railings from creating invisible blocking volumes across open interior space.
- Add regression coverage proving the railing interior remains traversable while the physical rail segments still block.

## 0.10.0-rc.3-dev.19

- Fix ResourceGraph material texture binding for schema-0.8 worlds with multiple PBR texture dependencies.
- World-authored texture asset IDs are lowered to explicit content-addressed `AssetResource` IDs inside `MaterialResource` definitions.
- Sekai64 ResourceAdapter now resolves explicit texture `ResourceId` references before source-string fallbacks.
- Preserves legacy single-texture/source-string ResourceGraph material behavior.

# 0.10.0-rc.3-dev.18

## S20 — ResourceGraph-backed static model assets

- Route schema-0.8 static `type: "model"` entities with ordinary `model` assets (GLB/glTF/other registered static formats) through the existing `AssetResource -> InstanceResource` architecture instead of compiling duplicate legacy model primitives.
- Keep world 0.7 model semantics unchanged. VRM assets and `animated-model` assets deliberately remain on the established legacy/Player animation path so character fitting, humanoid targets, root motion, and MMORPG camera ownership are not changed.
- Reuse one content-addressed `AssetResource` across multiple semantic model instances; entity runtime transforms target the ResourceGraph instance and do not rebuild or replace the authored asset resource.
- Preserve optional authored model collision as an explicit bounds collider without introducing mesh physics.
- Connect Sekai64 ResourceGraph asset realization to the renderer's existing generic asset-loader registry. Each semantic asset instance receives its own loader-owned Node lifecycle while the registered loader/AssetManager remains responsible for format handling and underlying fetch caching.
- Do not add GLB/VRM semantics to Sekai64 core or construction semantics to the renderer.
- Prove coexistence of procedural geometry and ResourceGraph model assets while preserving Player/VRM as a regression boundary.

# 0.10.0-rc.3-dev.17

## S17 — lathe/revolve and generic shape deformation

- Add renderer-neutral `lathe` geometry that revolves a strictly ordered `[radius, height]` profile around local Y; quality presets resolve radial segments before hashing.
- Add optional deterministic lathe end caps plus semantic `surface`, `startCap`, and `endCap` groups for S13 material-region binding.
- Add generic `bend`, `twist`, and `taper` modifiers wrapping any existing `GeometryDefinition`; no vase/lamp/column/cloud/rock-specific primitive or renderer semantic is introduced.
- `bend` curves a chosen longitudinal axis toward an explicit perpendicular direction, `twist` rotates cross-sections across source bounds, and `taper` interpolates perpendicular scale from `startScale` to `endScale`.
- Preserve source UVs, colors, indices, and semantic groups through deformation; recompute normals/bounds and regenerate tangents when the source had tangent-space data.
- Normalize all modifier defaults before hashing and record every wrapped source as an explicit ResourceGraph dependency for deterministic targeted invalidation.
- Reuse existing `maxProfilePoints`, `maxCurveSegments`, `maxGeometryVertices`, and `maxModifierDepth` safety boundaries rather than adding an independent deformation budget.
- Prove schema-0.8 JSON composition of lathe+taper+twist+bend, shared content-addressed geometry, runtime-transform reuse, and S15 bounds collision.
- Keep Sekai64, Player/MMORPG camera, VRM, animation, and collision architecture unchanged.

# 0.10.0-rc.3-dev.16

## S16 — deterministic organic noise modifier

- Add built-in renderer-neutral `noise` geometry modifier wrapping any existing `GeometryDefinition`; no cloud/rock/mountain-specific primitive or renderer semantic is introduced.
- Implement a small dependency-free deterministic 3D value-noise/fBm field with signed 32-bit `seed`, `frequency`, `strength`, `octaves`, `lacunarity`, `persistence`, and sampling-space `offset`.
- Bound authored fBm layers to 1..16 and reuse the existing `maxModifierDepth` contract for nested modifier safety.
- Displace vertices along stable source surface normals, recompute bounds and normals after deformation, and regenerate tangents when the source carried tangent-space data. UVs, colors, indices, and semantic geometry groups remain preserved.
- Normalize all noise defaults before hashing so equivalent definitions share cache/resource identity; seed and offset changes deterministically produce new geometry identities.
- Record `noise.source` as an explicit ResourceGraph geometry dependency so targeted invalidation and resource DAG ordering remain correct.
- Prove schema-0.8 JSON-native reuse, runtime-transform-without-regeneration, and S15 bounds collision for noise-deformed geometry.
- Keep Sekai64, Player/MMORPG camera, VRM, animation, and world collision architecture unchanged.

# 0.10.0-rc.3-dev.15

## S15 — procedural collision lowering

- Add renderer-neutral procedural collision lowering from schema-0.8 geometry/construction entities into the existing `CompiledCollider` domain.
- Add additive `collisionPolicy: "none" | "bounds" | "semantic" | "parts"` authoring for procedural entities while preserving legacy `collision: boolean` behavior.
- Default collidable geometry entities to transformed bounds collision and collidable construction entities to semantic/part collision.
- Reuse S7 architecture lowering for walls, floors, stairs, railings, columns, beams, roofs, panels, and trims rather than creating collision-specific renderer objects.
- Preserve wall door/window voids by generating colliders from S7 solid parts instead of one whole-wall AABB.
- Lower procedural floors as `floor` colliders and stair parts as `stair` colliders so the existing exploration/XR collision systems can support and step on them.
- Reject `semantic`/`parts` collision for arbitrary geometry until a safe semantic decomposition exists; no triangle-mesh physics engine is introduced.
- Keep authored transform edits on the existing full-compile path for collidable entities so procedural collider bounds are rebuilt deterministically.
- Keep `@blcklab/anyo-player`, animation, camera, VRM, and Sekai64 package behavior unchanged.

# 0.10.0-rc.3-dev.14

## S14 — JSON-native procedural resources

- Added opt-in Anyo world schema `0.8` while keeping `0.7` as the default stable schema and preserving existing 0.7 behavior.
- Added reusable top-level `geometries`, inline/named `geometry` entities, semantic `materialBindings`, and `construction` entities that lower through the existing S7 architecture subsystem.
- Compile schema-0.8 procedural authoring into the existing S9-S13 `ResourceGraph`; ordinary applications no longer need a parallel handcrafted graph to realize procedural JSON entities.
- Preserve content-addressed geometry/material sharing and stable semantic instance identity instead of introducing procedural renderer primitives.
- Integrate compiled resource graphs into the existing Sekai64 renderer lifecycle and external-node identity path while keeping Sekai64 semantically ignorant of geometry/construction meaning.
- Extend runtime transform updates to ResourceGraph-backed instances without recompiling geometry. Multi-part S7 constructions preserve each part's authored offset while the owning entity moves.
- Add strict procedural-version, named-geometry, and material-binding reference validation while retaining automatic legacy migrations through world 0.7.
- Add S14 regression coverage for named reuse, inline geometry, material regions, architecture lowering, nested identity, runtime transforms, invalid references, and 0.7 compatibility.
- No `@blcklab/anyo-player`, animation, camera, VRM, collision, or Sekai64 package behavior is redesigned in S14. Procedural collision remains S15.

# 0.10.0-rc.3-dev.13

## S13 — semantic multi-material Sekai64 realization

- Added `InstanceResource.materialBindings`: semantic geometry-group name -> MaterialResource id.
- Material bindings are normalized, content-hashed, validated as explicit dependencies, and classified as stable `materials` deltas by S10.
- `Sekai64ResourceAdapter` now forwards Anyo `GeometryGroup` ranges to Sekai64 Geometry and realizes multiple material slots without duplicating geometry.
- Region bindings such as `front`, `top`, `bevel`, `holeSide:0`, and CSG provenance names map per semantic instance to Sekai64 material slots.
- Unknown region bindings and missing numeric slots fail closed with structured adapter errors.
- Material-region edits update an existing Mesh in place through S10/S11 while geometry handles remain shared/reused.
- Requires Sekai64 material draw-group support (`@blcklab/sekai64@0.8.0-rc.34-dev.4` compatible range).

# 0.10.0-rc.3-dev.12

Sekai64 realization adapter integration S12.

- Add `Sekai64ResourceAdapter` under the existing opt-in `@blcklab/anyo/renderer-sekai64` subpath; Anyo Core/resources remain renderer-neutral and Sekai64 does not depend back on Anyo.
- Map S11 `GeometryResource` handles to Sekai64 `Geometry`, `MaterialResource` handles to shared `StandardMaterial`, texture/image `AssetResource` handles to shared `Texture`, and semantic instances to non-owning `Mesh`/custom `Node` handles.
- Preserve S10/S11 stable instance identity: transform/frame updates mutate the existing Sekai64 node, geometry/material replacement swaps shared resources without disposing them from the mesh, and retirement remains owned by the S11 realizer.
- Preserve S5 transported tangent/normal/binormal frames when orienting path-aligned instances.
- Add explicit material-to-asset texture binding resolution, with a safe single-reference/single-dependency fallback and a caller resolver for ambiguous multi-texture materials.
- Add custom `prepareAsset` / `createAssetInstance` / `releaseAsset` hooks for model/VRM/GLB or custom asset pipelines without adding a new package.
- Add `createSekai64RendererResourceAdapter()` / native-access factory support so realized resource instances can participate in the existing Sekai64 external-node picking identity.
- Fail explicitly on unsupported multi-material Mesh instances rather than silently dropping semantic material slots; material-group rendering remains a renderer capability follow-up.
- Keep Sekai64 source, Player/MMORPG camera, World Loader, VRM animation, GLB loaders, and WebGPU/WebGL behavior unchanged in S12.

# 0.10.0-rc.3-dev.11

Renderer-neutral resource realization/cache lifecycle S11.

- Add `ResourceRealizer` / `createResourceRealizer()` under `@blcklab/anyo/resources` to execute S10 transition plans through adapter-owned `prepare`, `createInstance`, `updateInstance`, `removeInstance`, and `release` hooks.
- Keep all realized handles opaque and renderer-neutral; Anyo owns lifecycle ordering/cache identity only and does not allocate GPU or Sekai64 objects.
- Stage new non-instance resources and new semantic instances before committing the next graph, then apply stable instance deltas and retire obsolete handles only after the next state is ready.
- Roll back staged resources/instances and reverse attempted stable-instance updates when prepare/create/update fails. A rollback failure marks the realizer faulted rather than pretending the previous adapter state is safe.
- Treat post-commit remove/release failures as retryable retired cleanup. `flushRetired()` retries pending cleanup while preserving the already-committed graph boundary.
- Add deterministic realization snapshots, busy-state protection, cache/graph consistency validation, full-disposal realization, and structured `RESOURCE_REALIZATION_*` errors.
- Preserve S9 content-addressed resource sharing and S10 semantic-instance identity; no renderer integration, world-schema changes, Sekai64, Player, VRM, animation, GLB, or WebGPU/WebGL changes are introduced in S11.

# 0.10.0-rc.3-dev.10

Renderer-neutral incremental resource planning S10.

- Add deterministic `diffResourceGraphs()` and `planResourceGraphTransition()` APIs under `@blcklab/anyo/resources`.
- Reuse unchanged geometry/material/asset/instance resources without churn and compile only newly introduced non-instance resources in dependencies-first order.
- Keep content-addressed geometry/material/asset ids immutable across transitions and reject identity/key corruption in manually-constructed graphs.
- Add stable field-level instance deltas for source, materials, transform, transported frame, metadata, and composite updates.
- Detach removed instances before releasing obsolete resources, with non-instance release ordered dependents-first.
- Support deterministic initial-mount and full-disposal plans through null graph boundaries.
- Preserve S5 path-array and S6 shared-array resource reuse so placement edits do not force source-geometry recompilation.
- Keep transition planning side-effect free and renderer-neutral; no Sekai64/GPU allocation or execution is introduced in S10.

# 0.10.0-rc.3-dev.9

Renderer-neutral resource/composition DAG S9.

- Add the opt-in `@blcklab/anyo/resources` subpath with deterministic `GeometryResource`, `MaterialResource`, `AssetResource`, and semantic `InstanceResource` contracts.
- Content-address geometry/material/asset resources while keeping instance identity separate from instance content so identical placements are never accidentally merged.
- Model nested transform/mirror/CSG geometry as explicit geometry-resource dependencies and expose deterministic graph snapshots/topological ordering.
- Add reverse dependency queries and `invalidationSet()` planning for targeted future recompilation without performing renderer/GPU work in S9.
- Add resource helpers for S6 linear arrays, S5 path arrays (including transported orientation frames), and S7 architecture assemblies with shared geometry.
- Normalize material defaults before identity, keep material-to-asset dependencies explicit, and preserve assets as renderer-neutral authored definitions.
- Add cycle/reference/type/resource-count safety validation with structured `RESOURCE_*` errors.
- Keep world schema/runtime compilation, renderer allocation, Sekai64, Player, VRM, animation, camera, GLB, and WebGPU/WebGL behavior unchanged.

# 0.10.0-rc.3-dev.8

Safe renderer-neutral CSG S8 for the procedural construction subsystem.

- Add composable built-in `union`, `subtract`, and `intersect` geometry expressions with nested child normalization before deterministic hashing/caching.
- Require closed, outward-wound 2-manifold operands; reject planes/open meshes, zero-volume/non-manifold inputs, numerical instability, and empty results with structured `CSG_*` errors and repair suggestions.
- Add bounded BSP Boolean work with an independent `maxBooleanDepth` guard, derived polygon/work budgets, and bounded BSP tree depth.
- Interpolate positions/normals/UVs/tangents/colors across split edges and conform T-junction boundaries before deterministic convex-polygon triangulation so final output validates as a watertight 2-manifold triangle mesh.
- Preserve the S3 surface pipeline after CSG; top-level normal/UV/tangent policies can regenerate production-ready attributes after the Boolean.
- Emit renderer-neutral semantic result groups (`left:<region>`, `right:<region>`, and subtraction `cut:<region>`) while keeping material resources outside geometry ownership.
- Keep S7 architecture opening decomposition unchanged; ordinary walls/doors/windows do not become dependent on CSG. No Sekai64, Player, VRM, animation, camera, GLB, world-schema, or WebGPU/WebGL behavior changes.

# 0.10.0-rc.3-dev.7

Semantic architecture S7 for the renderer-neutral procedural construction subsystem.

- Add `lowerArchitecture()` as a scoped renderer-neutral construction IR that lowers semantic architecture into reusable geometry parts, instance groups, and anchors.
- Add wall semantics with horizontal from/to spans, height/thickness, deterministic door/window opening decomposition, semantic opening anchors, and no CSG dependency.
- Add floor, ceiling, panel, rectangular/round column, horizontal beam, stairs with shared tread/riser placements and optional landing, railing with sweep rails/path-array posts, trim sweeps, and gable/shed roofs.
- Add first-class negative-space `doorOpening` / `windowOpening` normalization without fabricating standalone meshes.
- Keep architecture definitions outside the built-in geometry-kind registry: S7 semantics lower into S2-S6 `box`/`roundedBox`/`cylinder`/`sweep`/transform and placement resources rather than custom vertex generation.
- Add semantic anchors and structured architecture validation/safety errors while preserving material, renderer, entity/world transform, and runtime ownership boundaries.
- Do not modify existing Anyo world schema, Sekai64, Player, VRM, animation, camera, GLB, or WebGPU/WebGL behavior. CSG remains a later milestone.

# 0.10.0-rc.3-dev.6

Stable geometry modifiers S6 for the renderer-neutral procedural geometry subsystem.

- Add composable built-in `transform` geometry expressions with geometry-local position, XYZ Euler rotation, and non-zero scale.
- Preserve correct normals, tangent handedness, semantic groups, and CCW front-face winding under non-uniform and negative scales.
- Add composable built-in `mirror` geometry with x/y/z planes, finite plane offsets, and optional source retention for symmetry.
- Add renderer-neutral `layoutGeometryArray()` placement resources for deterministic linear repetition without baking duplicate mesh data.
- Enforce `maxModifierDepth` for recursive geometry expressions and `maxGeneratedInstances` for array placements with structured recovery errors.
- Preserve S1-S5 geometry/cache/surface contracts and keep bend/twist/taper, architecture semantics, CSG, Sekai64, Player, VRM, animation, camera, and world-schema changes out of S6.

# 0.10.0-rc.3-dev.5

Curves, stable sweep frames, sweep geometry, and path-array placement S5 for the renderer-neutral procedural geometry subsystem.

- Add renderer-neutral line, polyline, quadratic Bezier, cubic Bezier, and Catmull-Rom curve definitions with deterministic bounded sampling.
- Add rotation-minimizing/parallel-transport-style curve frames with stable vertical-path fallback and closed-loop seam correction to avoid random profile twisting.
- Add built-in `sweep` geometry for open/closed paths, profile holes, optional end caps, generated perimeter/path UVs, semantic regions, and S3 normal/UV/tangent policy reuse.
- Resolve nested curve quality/default segment counts before sweep hashing so equivalent authored definitions share geometry cache identity.
- Add renderer-neutral `layoutPathArray()` placements with optional transported orientation frames and `maxGeneratedInstances` safety limits; repeated source geometry is intentionally not merged or duplicated in S5.
- Keep CSG, modifiers, architecture semantics, Construction IR, world-schema changes, Sekai64, Player, VRM, animation, and camera behavior out of S5.

# 0.10.0-rc.3-dev.4

Profiles and extrusion S4 for the renderer-neutral procedural geometry subsystem.

- Add canonical reusable 2D profile normalization with CCW outer contours, CW holes, duplicate/collinear cleanup, deterministic hole ordering, and structured validation errors.
- Add deterministic hole-aware profile triangulation without a new runtime geometry dependency.
- Add built-in `extrude` geometry with front/back caps, outer and hole side walls, generated UVs, exact bounds, and semantic regions.
- Add bounded multi-segment extrusion bevels with collapse/self-intersection rejection instead of emitting invalid meshes.
- Reuse the S3 normal/UV/tangent surface pipeline; generated extrusion UVs support real-world `metersPerTile`.
- Keep profile holes as the S4 opening mechanism; no general CSG, curves/sweep, Construction IR, world-schema, Sekai64, Player, VRM, animation, or camera changes.

# 0.10.0-rc.3-dev.3

Surface-quality S3 for the renderer-neutral procedural geometry subsystem.

- Add reusable flat/smooth normal generation with configurable crease angles.
- Add generated, planar, box, cylindrical, and spherical UV policies plus real-world `metersPerTile` density, scale, rotation, and offset.
- Add deterministic xyzw tangent generation for normal-map-ready geometry.
- Add semantic geometry groups for primitive faces/surfaces/caps without coupling geometry to material resources.
- Include surface policy in normalized geometry identity/cache keys while keeping entity transforms and material assignment outside geometry identity.
- Preserve S1/S2 contracts and existing world/runtime behavior; no Sekai64, Player, VRM, animation, or world-schema change.

# 0.10.0-rc.3-dev.2

Add S2 precision procedural primitives to `@blcklab/anyo/geometry`: box, roundedBox, plane, sphere, cylinder, cone, capsule, disc, torus, and polygon. Built-ins now resolve deterministic quality presets before hashing, enforce bounded parameter validation, preserve the S1 coordinate/winding/cache contracts, and produce renderer-neutral indexed meshes with practical normals/UVs. No Sekai64, Player, world-schema, or existing entity primitive behavior changes in this revision.

# 0.10.0-rc.3-dev.1

Start the precision procedural-geometry milestone with a renderer-neutral S1 foundation. Add stable coordinate conventions, JSON-safe definition normalization, deterministic hashing, safety limits, mesh validation, bounds, reusable caching, a pluggable compiler registry, and the `@blcklab/anyo/geometry` subpath. No renderer, Player, world-schema, or existing primitive semantics change in this revision.

# Changelog

## 0.10.0-rc.2-dev.2

- Restore the rc.1 Sekai64 CameraAdapter setRotation compatibility contract (`rotation.set(..., XYZ)`) while retaining rc.2 primitives and renderer improvements. Player already uses Sekai64 native `setViewAngles()` for authoritative first/third-person view updates, so the adapter fallback must remain backward-compatible.

## Local World Loader integration (2026-09-15)

- Fix Sekai64 camera adapter yaw/pitch application by using native `setViewAngles()` YXZ semantics.
- Convert Anyo environment sun position to Sekai64 directional-light ray direction so authored sun angle actually controls shadows.

## 0.9.1-rc.15

- Make `cloneWorldDocument()` resilient to framework reactive proxies by falling back to a plain JSON-contract clone when `structuredClone()` rejects a Proxy.
- Prevent portal entry and source-document capture failures when a `World` instance is observed through Vue or another reactive framework.
- Add a regression test covering browser-compatible Proxy clone behavior.

## 0.9.1-rc.14

- Fixed live DOM Web Surface ownership so the renderer snapshot/plane is hidden only while the live surface is visible, eliminating duplicate striped rendering and mirrored fallback text.
- Restores the renderer fallback automatically for XR, hidden/off-screen surfaces, failed presentation, disposal, and ordinary runtime handoff.
- Preserves optional presenter handoff through `shouldPresent` without forcing the fallback visible over a texture-backed owner.
- Normalized projected DOM orientation into a readable half-turn range so wall-mounted interfaces do not rotate text by 180 degrees when the projected basis reverses.
- Added regression coverage for fallback suppression, XR restoration, disposal restoration, and readable orientation.

## 0.9.1-rc.13

- Added a renderer-neutral visual contract with fixed sRGB and linear texture-channel semantics.
- Added normalized material defaults for PBR, emissive intensity, normal scale, occlusion strength, transparency, and shadow participation.
- Added normalized world environment controls for hemisphere lighting, color management, exposure, shadows, and image quality.
- Expanded portable point-light controls with range, decay, and shadow intent.
- Added diagnostics for destructive light values, transparent opaque-shadow requests, missing environment assets, and unsupported renderer features.
- Hardened the Sekai64 adapter so world visual settings and material channels reach both WebGL2 and WebGPU consistently while runtime overrides remain possible.
- Added visual-contract and adapter parity regression coverage without expanding the building language.

## 0.9.1-rc.12

- Integrated the Sekai64 S1–S7 visual pipeline configuration through the optional renderer adapter.
- Forwarded independent roughness and metalness textures instead of only caching them.
- Added portable glass material controls: transmission, IOR, thickness, attenuation color, and attenuation distance.
- Window primitives now receive a lightweight transmission default when authors do not explicitly configure glass.
- Renderer capability reporting now advertises independent roughness, metalness, and packed metallic-roughness channels.
- Added opt-in shared beveled geometry for authored box entities while preserving exact building walls and slabs.

## 0.9.1-rc.11

- Added trusted Sekai64 native-node registration with stable Anyo primitive/entity picking identity.
- Optional renderer integrations can now expose native geometry to Editor selection without adding renderer-specific primitives to portable world JSON.
- External nodes remain owned and disposed by their optional package; registration is lifecycle-safe and additive to the concrete Sekai64 adapter only.

## 0.9.1-rc.10

- Added renderer-neutral `anyo.map` and `anyo.mapFeature` contracts for geographic world cells and editable map features.
- Added strict latitude, longitude, cell, footprint, layer, and height validation.
