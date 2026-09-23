# Procedural geometry

Anyo procedural geometry is JSON-first, renderer-neutral construction math. It follows the same world-space contract as the rest of Anyo:

- right-handed coordinates;
- +Y is up;
- +X is east;
- north is -Z;
- one world unit is one meter;
- Euler rotations use radians;
- generated triangle fronts use counter-clockwise winding.

The public geometry API is available from `@blcklab/anyo/geometry` and is intentionally not re-exported from the root package barrel.

```ts
import {
  compileGeometry,
  createGeometryCompiler,
  GeometryCache,
  hashGeometryDefinition,
} from '@blcklab/anyo/geometry'
```

## S1 foundation

The S1 layer provides:

- renderer-neutral `GeometryDefinition` and `GeometryMesh` contracts;
- deterministic JSON normalization and hashing;
- bounded validation with structured diagnostics;
- deterministic AABB and bounding-sphere calculation;
- reusable geometry caching;
- a pluggable compiler registry for geometry kinds.

Geometry definitions contain geometry parameters only. Entity transforms and materials stay outside the definition, so changing entity position, rotation, scale, or material does not change a geometry cache key.

Geometry compilation is a change-time operation, not a frame-time operation. Generated meshes are immutable by contract once cached so many world entities can safely share the same resource.

## S2 precision primitives

S2 registers these built-in kinds:

```text
box
roundedBox
plane
sphere
cylinder
cone
capsule
disc
torus
polygon
```

`compileGeometry()` now works directly with those built-ins while still accepting extension kind compilers through `createGeometryCompiler({ kinds: [...] })`.

### Quality presets

Curved primitives accept `quality: "low" | "medium" | "high" | "ultra"`. A preset is resolved into explicit segment counts before hashing. Explicit segment values always win and the `quality` authoring hint is removed from the normalized cache definition.

That means equivalent definitions share one geometry resource:

```ts
const a = compileGeometry({ kind: 'sphere', quality: 'high', radius: 1 })
const b = compileGeometry({ kind: 'sphere', radius: 1, segments: 32, rings: 16 })
// a === b when compiled through the same GeometryCompiler/cache
```

### Box

```json
{ "kind": "box", "size": [4, 2, 1] }
```

Boxes are centered at the origin and use independent face vertices for predictable hard edges and UV islands.

### Rounded box

```json
{
  "kind": "roundedBox",
  "size": [4, 2, 1],
  "radius": 0.04,
  "segments": 4
}
```

The radius is deterministically clamped to half the smallest dimension. Rounded boxes preserve the authored outer dimensions and produce outward CCW topology with curved edge/corner normals.

### Plane, disc, polygon

These are planar XY surfaces facing +Z, matching the existing Anyo/Sekai plane convention.

```json
{ "kind": "plane", "size": [4, 2] }
```

```json
{ "kind": "disc", "radius": 1, "segments": 32 }
```

```json
{
  "kind": "polygon",
  "points": [[0, 0], [3, 0], [3, 2], [1.5, 1], [0, 2]]
}
```

S2 polygon supports simple convex or concave contours. It removes duplicate closure/consecutive points, canonicalizes winding, removes collinear points, rejects self-intersection, and triangulates deterministically. Polygon holes are intentionally deferred to S4 profiles/extrusion.

### Sphere

```json
{ "kind": "sphere", "radius": 0.5, "segments": 32, "rings": 16 }
```

Spheres are Y-up UV spheres with outward normals and a deterministic seam.

### Cylinder and cone

```json
{ "kind": "cylinder", "radius": 0.5, "height": 2, "segments": 32, "cap": true }
```

```json
{ "kind": "cone", "radius": 0.5, "height": 2, "segments": 32, "cap": true }
```

Both are Y-up and centered at the origin. `cap: false` leaves the ends open.

### Capsule

```json
{ "kind": "capsule", "radius": 0.5, "height": 2, "segments": 32, "rings": 8 }
```

`height` is the total capsule height including both hemispherical caps and must be at least `2 * radius`.

### Torus

```json
{ "kind": "torus", "radius": 0.75, "tubeRadius": 0.25, "segments": 32, "tubeSegments": 16 }
```

The torus is centered at the origin with its symmetry axis on +Y/-Y.

## Surface-quality boundary

S3 generalizes surface quality across all geometry kinds. A definition may request `normals`, `uv`, and `tangents`; those policies normalize before hashing and are applied after topology generation. `generated` UV mode preserves primitive-authored UVs, while planar/box/cylindrical/spherical modes can reproject any compatible mesh. `metersPerTile` expresses real-world texture density in Anyo meters. Tangents use xyzw layout with handedness in `w`.

Primitive geometry also exposes renderer-neutral semantic groups. Boxes/rounded boxes name faces; cylinder-like geometry names side/bottom/top regions; other S2 surfaces expose `surface`. These groups all default to material slot `0`: region names describe where future material assignment may apply, not a material dependency inside geometry.

Likewise, `circle`/`ring` aliases from the wider long-term primitive vocabulary are not added in S2 because the approved S2 sequence is intentionally limited to the ten kinds above.


## S4 profiles, holes, triangulation, and extrusion

S4 adds renderer-neutral 2D construction profiles as reusable math. `normalizeProfile()` cleans duplicate closure/consecutive points and safe collinear points, canonicalizes outer winding to CCW and holes to CW, sorts holes deterministically, and rejects self-intersections, holes outside the outer contour, touching boundaries, and overlapping/nested holes with structured error codes.

`triangulateProfile()` bridges valid holes deterministically and returns CCW +Z-facing cap triangles. The built-in `extrude` kind uses that topology for caps, creates outer/hole side walls along local Z, and emits semantic regions: `front`, `back`, `outerSide`, `holeSide:N`, plus `frontBevel` / `backBevel` when beveling is enabled. All groups default to material slot 0.

```json
{
  "kind": "extrude",
  "profile": {
    "points": [[0,0],[6,0],[6,3],[0,3]],
    "holes": [[[1,0.8],[1,2.2],[2.5,2.2],[2.5,0.8]]]
  },
  "depth": 0.2,
  "bevel": { "size": 0.025, "segments": 3 },
  "uv": { "mode": "generated", "metersPerTile": 1 },
  "tangents": true
}
```

Bevel offsets are validated at every ring. If an inset collapses, self-intersects, lets a hole escape, or makes holes overlap, compilation fails closed with `EXTRUSION_BEVEL_COLLAPSE` and a repair suggestion. General Boolean/CSG geometry remains a later milestone; ordinary architectural openings should prefer profile holes.


## S5 curves, sweep, and path arrays

S5 adds deterministic renderer-neutral 3D curves and a sweep compiler. Curves remain pure construction data and can be sampled independently from mesh generation.

Supported curve kinds:

```text
line
polyline
quadraticBezier
cubicBezier
catmullRom
```

Example curve sampling:

```ts
const curve = sampleCurve({
  kind: 'cubicBezier',
  points: [
    [0, 0, 0],
    [3, 0, 2],
    [6, 1, 5],
    [10, 0, 8],
  ],
  segments: 48,
})
```

Sampling is deterministic and bounded by `maxCurveSegments`. `polyline` sampling preserves every authored corner. Catmull-Rom supports open or closed paths and an optional `tension` value. Quality presets are resolved into explicit segment counts before a nested curve participates in sweep geometry hashing.

### Stable transported frames

`computeCurveFrames()` transports the profile basis along the sampled path rather than recomputing an arbitrary world-up frame at every point. The implementation reprojects and parallel-transports the previous basis, uses a deterministic fallback when an authored up direction is parallel to the tangent, and distributes seam correction around closed paths. This avoids random sweep twisting on vertical, nearly-collinear, and looping paths.

The optional `up` vector is the preferred initial profile +Y axis. The profile +X axis is derived so `cross(profileX, profileY)` follows the path tangent.

### Sweep geometry

```ts
const mesh = compileGeometry({
  kind: 'sweep',
  profile: {
    points: [[-0.06, -0.06], [0.06, -0.06], [0.06, 0.06], [-0.06, 0.06]],
  },
  path: {
    kind: 'catmullRom',
    points: [[0, 0, 0], [2, 1, 3], [5, 2, 5], [8, 0, 8]],
    segments: 64,
  },
  cap: true,
  uv: { mode: 'generated', metersPerTile: 1 },
  tangents: true,
})
```

Open sweeps can emit `startCap`, `endCap`, `outerSide`, and `holeSide:N` semantic regions. Closed sweeps are never capped. Generated UVs use profile perimeter distance for U and sampled path distance for V, so `metersPerTile` remains meaningful for pipes, rails, trims, and similar construction. S3 can still replace normals/UV projection and generate tangents after sweep topology is built.

### Path arrays

`layoutPathArray()` returns renderer-neutral placements rather than merging repeated source meshes:

```ts
const layout = layoutPathArray({
  path: {
    kind: 'polyline',
    points: [[0, 0, 0], [4, 0, 0], [8, 0, 3]],
  },
  spacing: 0.5,
  alignToPath: true,
})
```

Each placement includes a position and, when requested, tangent/profile-X/profile-Y frame vectors. This is intentionally a placement resource rather than a `GeometryMesh` kind: the future instance/resource model can render one shared geometry at many placements without baking thousands of mesh copies. `maxGeneratedInstances` protects AI-authored worlds from unreasonable placement counts.

S5 does not add general modifiers, architecture semantics, CSG, or renderer integration.


## S6 stable modifiers

S6 adds composition without changing world/entity transform semantics. `transform` and `mirror` are built-in geometry expressions, so their effects are part of geometry identity and are compiled deterministically through the same S1 cache/compiler pipeline. Entity transforms remain outside `GeometryDefinition` and must not rebuild cached geometry resources.

### Geometry-local transform

```json
{
  "kind": "transform",
  "position": [1, 2, 3],
  "rotation": [0, 1.57079632679, 0],
  "scale": [2, 1, 1],
  "source": { "kind": "roundedBox", "size": [1, 2, 0.2], "radius": 0.03 }
}
```

Transforms use Anyo's existing XYZ Euler/radian convention. Non-uniform scale applies inverse-transpose normal handling. Negative scale reverses triangle winding and tangent-space handedness so CCW/outward front-face behavior remains valid. Nested modifiers are bounded by `maxModifierDepth`.

### Mirror

```json
{
  "kind": "mirror",
  "axis": "x",
  "offset": 2,
  "includeOriginal": true,
  "source": { "kind": "extrude", "profile": { "points": [[0,0],[1,0],[1,2],[0,2]] }, "depth": 0.2 }
}
```

`mirror` supports x/y/z planes and finite offsets in meters. `includeOriginal` defaults to `true` for symmetry; set it to `false` to return only the reflected geometry. Semantic groups and vertex attributes remain renderer-neutral and survive the operation.

### Linear arrays as placement resources

`layoutGeometryArray()` deliberately does not return a merged `GeometryMesh`. It returns one normalized source definition plus deterministic per-instance position/rotation/scale placements:

```ts
const layout = layoutGeometryArray({
  source: { kind: 'box', size: [0.08, 1, 0.08] },
  count: 20,
  offset: [0.5, 0, 0],
  rotationOffset: [0, 0.05, 0],
})
```

This keeps repetition compatible with the planned GeometryResource/InstanceResource model. Placement changes do not alter the source geometry identity. `maxGeneratedInstances` protects against unreasonable array counts. Bend, twist, and taper remain later modifier work.


## S7 semantic architecture and scoped construction IR

S7 adds `geometry/architecture/` without adding new geometry mesh kinds. `lowerArchitecture()` converts semantic definitions into a renderer-neutral `ArchitectureAssembly` containing:

- `parts`: reusable lower-level `GeometryDefinition` values plus explicit transforms;
- `instanceGroups`: one shared geometry definition plus deterministic placements;
- `anchors`: named spatial attachment points for future constraints/editor tooling.

This is deliberately a scoped construction IR rather than a world-schema rewrite. Existing Anyo world/entity JSON remains compatible. Sekai64, Player, VRM, animation, cameras, and materials are not imported by architecture code.

Supported S7 semantics:

```text
wall
floor
ceiling
doorOpening
windowOpening
stairs
railing
column
beam
roof
panel
trim
```

Example wall:

```ts
const wall = lowerArchitecture({
  type: 'wall',
  from: [0, 0, 0],
  to: [8, 0, 0],
  height: 3.2,
  thickness: 0.15,
  bevel: 0.01,
  openings: [
    { kind: 'door', offset: 1, width: 1, height: 2.2 },
    { kind: 'window', offset: 4, width: 1.8, height: 1.4, sillHeight: 0.9 },
  ],
})
```

Door and window voids are decomposed into solid lower-level wall regions, so architectural openings do not force general CSG. Overlapping/out-of-bounds openings fail with structured architecture errors. The `opening:<id>:center` anchor is emitted when an opening has an id.

Stairs use shared tread/riser geometry with placement groups instead of baking every step into one mesh. Railings use S5 sweep for rails and `layoutPathArray()` for repeated posts. Trim is represented as a sweep. Gable/shed roofs lower to transformed lower-level panel geometry. Standalone `doorOpening` / `windowOpening` values normalize negative-space semantics and intentionally emit no fake mesh without a host.

S7 anchors are metadata only. General attach/snap/fit/parallel/perpendicular constraint solving, world-level Construction DAG resources, renderer instancing integration, and CSG remain later work.

## S8 — Safe Boolean CSG

S8 adds renderer-neutral `union`, `subtract`, and `intersect` geometry expressions. They compose any existing child definitions that compile to volumetric closed solids.

```ts
const cut = compileGeometry({
  kind: 'subtract',
  left: { kind: 'roundedBox', size: [4, 3, 0.3], radius: 0.03 },
  right: {
    kind: 'transform',
    source: { kind: 'box', size: [1.2, 2.2, 0.8] },
    position: [0, -0.4, 0],
  },
  normals: { mode: 'flat' },
  uv: { mode: 'box', metersPerTile: 1 },
  tangents: true,
})
```

CSG is intentionally not the default architecture-opening mechanism. S7 walls continue to lower door/window openings through deterministic solid-region decomposition, and S4 profile holes remain preferable when a valid 2D profile expresses the opening directly.

### Solid contract

Each Boolean operand must be a closed, outward-wound 2-manifold triangle solid with positive enclosed volume. Open planes/discs/open sweeps, zero-area triangles, boundary edges, non-manifold edges, and inward winding fail before BSP clipping. Empty Boolean results fail with `CSG_EMPTY_RESULT` because the current `GeometryMesh` contract is non-empty.

S8 uses deterministic BSP clipping with conservative numerical tolerance derived from operand bounds. Split vertices linearly interpolate available normals, UVs, tangents, and colors. Polygon inversion flips normals and tangent handedness for subtraction cavity surfaces.

Classic BSP output can contain T-junctions where one polygon edge spans multiple shorter neighboring edges. S8 therefore performs a deterministic collinear edge-conformance pass before triangulation, keeps the inserted boundary vertices, chooses a non-degenerate convex fan root, and validates the final triangle result as a closed 2-manifold solid.

### Safety

`maxBooleanDepth` is enforced independently of `maxModifierDepth`. S8 also derives conservative input triangle, BSP work, BSP tree-depth, and edge-conformance budgets from the existing geometry limits. Pathological complexity fails with `CSG_COMPLEXITY_LIMIT`; unstable near-coincident intersections fail with `CSG_NUMERICAL_FAILURE` instead of returning partial geometry.

### Semantic groups and materials

CSG output groups are geometry-region metadata only. Result polygons inherited from the left/right operands are named `left:<region>` and `right:<region>`. In subtraction, cutter-derived cavity surfaces use `cut:<region>`. All remain material slot `0` by default; concrete material resources remain a separate compilation/runtime domain.


## S16 generic organic noise modifier

S16 adds `noise` as a composable geometry expression. It intentionally does not add cloud, rock, mountain, terrain, or other object-specific geometry kinds.

```json
{
  "kind": "noise",
  "source": { "kind": "sphere", "radius": 4, "segments": 48, "rings": 24 },
  "seed": 9182,
  "frequency": 0.45,
  "strength": 0.65,
  "octaves": 4,
  "lacunarity": 2,
  "persistence": 0.5,
  "offset": [0, 0, 0]
}
```

The implementation uses deterministic 3D value noise combined as normalized fBm. Vertices move along stable source normals. After deformation Anyo recomputes bounds and normals, regenerates tangents when the source had tangent-space data, and preserves UVs, colors, indices, and semantic groups. `octaves` is bounded to 1..16 and nested noise/transform/mirror expressions continue to use `maxModifierDepth`.

All resolved parameters participate in geometry identity. The same normalized definition and seed reproduce the same mesh; changing seed/offset changes the cache/resource key. In the S9 ResourceGraph, the wrapped source geometry is an explicit dependency of the noise resource.

Noise remains change-time CPU geometry. Entity movement is still a runtime transform and must not regenerate the geometry every frame.
## S17 lathe/revolve and generic deformation

S17 completes the focused generic construction vocabulary with `lathe`, `bend`, `twist`, and `taper`. These operations remain renderer-neutral geometry math. They do not introduce object-specific concepts such as vases, lamps, columns, rocks, or clouds.

A lathe revolves an ordered `[radius, height]` profile around local Y:

```json
{
  "kind": "lathe",
  "profile": [[0.2, 0], [0.6, 0.5], [0.5, 1.5], [0.15, 2]],
  "segments": 48,
  "cap": true
}
```

Profile heights must be strictly increasing and radii are non-negative. Radial tessellation is deterministic, quality presets resolve before hashing, and non-zero end radii can be capped. The generated regions are `surface`, `startCap`, and `endCap`, so existing S13 `materialBindings` can style them without duplicating geometry.

The deformation modifiers wrap any source geometry:

```json
{
  "kind": "bend",
  "source": {
    "kind": "twist",
    "source": {
      "kind": "taper",
      "source": { "kind": "box", "size": [1, 4, 1] },
      "axis": "y",
      "startScale": 1,
      "endScale": 0.6
    },
    "axis": "y",
    "angle": 0.5
  },
  "axis": "y",
  "direction": "x",
  "angle": 0.35
}
```

`twist.angle` and `bend.angle` are total radians across the selected source-bounds axis. `taper` linearly interpolates perpendicular scale between the minimum and maximum source bounds. Deformation preserves UVs, colors, indices, and semantic groups, then repairs normals/bounds and regenerates tangents when needed. Wrapped sources remain explicit ResourceGraph dependencies and nested deformation consumes the normal `maxModifierDepth` budget.

Like S16 noise, these are authored geometry changes: changing a bend/twist/taper parameter creates a new content-addressed geometry resource. Moving the resulting entity remains a runtime transform and does not rebuild geometry.

