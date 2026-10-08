# Anyo Universal Geometry

This document tracks the final pre-freeze geometry architecture series that follows the rc.24 portfolio modeling candidate.

## Goal

Anyo should rarely require a core change merely because a world needs a new shape. Geometry should be expressible through generic sources, ordered operators, reusable resources, arbitrary meshes, and later trusted extension providers, all lowering to the same renderer-neutral `GeometryMesh` contract.

```text
GeometrySource
    -> normalize / deterministic identity
    -> GeometryOperator[]
    -> GeometryMesh
    -> Sekai64 or another renderer adapter
```

Object semantics such as trees, roads, buildings, furniture, clouds, or bridges stay outside the renderer and should normally remain compositions rather than dedicated geometry kinds.

## Step 1 — canonical build result

rc.25 formalized the existing compiler path as `GeometryCompiler.build()` / `buildGeometry()` returning `{ source, key, mesh }`. Existing `compileGeometry()` remains the mesh-only compatibility view of the same build path.

## Step 2 — ordered operator pipeline

rc.26 adds the first generic operator execution layer.

### Authoring contract

```json
{
  "kind": "pipeline",
  "source": { "kind": "roundedBox", "size": [1, 3, 1], "radius": 0.08 },
  "modifiers": [
    { "kind": "taper", "axis": "y", "startScale": 1, "endScale": 0.6 },
    { "kind": "twist", "axis": "y", "angle": 0.5 },
    { "kind": "transform", "position": [1, 0, 0] }
  ]
}
```

`modifiers` are source-free. Their array order is execution order and participates in the deterministic geometry key.

### Built-in Step 2 operators

- `transform`
- `taper`
- `twist`

These are not new deformation algorithms. The legacy nested geometry kinds and the operator descriptors call the same shared normalization and mesh functions, so existing worlds remain compatible and there is only one implementation of each operation.

### Public extension boundary

`GeometryOperatorCompiler` can be explicitly registered on a `GeometryCompiler`. This is an application-controlled registration mechanism, not yet the final namespaced extension/provider contract planned for a later milestone.

### Safety and caching

- operator stacks obey `maxModifierDepth`;
- every operator output is finalized/validated before it becomes the next operator input;
- the full normalized pipeline, including modifier order and defaults, is hashed as one geometry identity;
- ResourceGraph records the pipeline source as a geometry dependency while operators remain descriptors rather than resources.

### Renderer boundary

No Sekai64 change is required. The renderer still receives only finalized mesh resources.

## Compatibility

- Existing primitive, sweep, loft, CSG, legacy modifier, and architecture authoring remains supported.
- World 0.9 adds a strict `pipeline` schema and strict Step 2 operator schemas.
- World 0.8 keeps its existing schema unchanged and can use the pipeline through its extensible geometry-definition boundary.
- Existing `transform`, `taper`, and `twist` nested JSON is not deprecated in this milestone.

## Deferred to Step 3

The operator registry deliberately contains only the minimal proof set in rc.26. Bend, mirror, noise/displace, array/repetition, weld, and the rest of the universal modifier vocabulary belong to Step 3 so each addition stays reviewable and patch-isolated.

## Step 3 — universal modifier vocabulary

rc.27 expands the generic operator pipeline without adding semantic object kinds. The built-in operator vocabulary is now:

```text
transform
taper
twist
bend
mirror
noise
array
weld
```

`bend`, `mirror`, and `noise` are promotions of mature legacy geometry operations. Their nested legacy forms and source-free pipeline forms share the same normalization and mesh code.

### Baked array versus scene instances

The `array` operator is deliberately different from `layoutGeometryArray()` / `ResourceGraphBuilder.addGeometryArray()`. The established resource API creates reusable instance placements and remains the preferred path for large repeated scenes. The pipeline operator bakes copies into a single mesh so later operators can act on the combined topology:

```json
{
  "kind": "pipeline",
  "source": { "kind": "box", "size": [0.2, 1, 0.2] },
  "modifiers": [
    { "kind": "array", "count": 8, "offset": [0.3, 0, 0] },
    { "kind": "bend", "axis": "x", "direction": "y", "angle": 0.8 }
  ]
}
```

Baked arrays obey `maxGeneratedInstances`, `maxGeometryVertices`, and `maxGeometryIndices`. Use resource instances when copies do not need to become one deformable mesh.

### Deterministic noise displacement

The `noise` operator reuses Anyo's existing deterministic fBm displacement. Seed, frequency, strength, octave parameters, and offset normalize before hashing, so identical normalized definitions reproduce identical geometry.

### Conservative weld

`weld` removes safe duplicate vertices within a positional tolerance. Two vertices are eligible only when all present vertex attributes match exactly. This intentionally avoids crossing UV seams, hard-normal boundaries, tangent-handedness splits, or color boundaries. Material groups and triangle order stay unchanged.

```json
{ "kind": "weld", "tolerance": 0.000001 }
```

### Freeze boundary

Step 3 does not add tree, road, building, stair, cloud, or other semantic geometry. It also does not add arbitrary mesh authoring yet. Step 4 owns the indexed-mesh escape hatch.


## Step 4 — arbitrary indexed mesh escape hatch

rc.28 adds a single universal `mesh` source so geometry that does not fit a built-in procedural generator can still enter Anyo without changing Anyo Core or Sekai64.

```json
{
  "kind": "mesh",
  "positions": [0, 0, 0, 1, 0, 0, 0, 1, 0],
  "indices": [0, 1, 2],
  "attributes": {
    "normals": [0, 0, 1, 0, 0, 1, 0, 0, 1],
    "uvs": [0, 0, 1, 0, 0, 1]
  },
  "groups": [
    { "start": 0, "count": 3, "materialIndex": 0, "name": "surface" }
  ]
}
```

Raw vertex channels are nested under `attributes`. This is deliberate: top-level `normals` is already the stable renderer-neutral normal-generation policy used by every geometry kind. A mesh can therefore omit raw normals/UVs/tangents and explicitly request the existing surface policies instead.

The source is normalized and hashed like every other geometry definition, checked against the existing geometry limits before typed-array allocation, converted to Float32 vertex channels plus Uint16/Uint32 indices, finalized as an ordinary `GeometryMesh`, and can then flow through `pipeline.modifiers`. No renderer branch exists for authored meshes.

The escape hatch is still triangle-list geometry, not an embedded scripting or shader system. SDFs, voxels, remeshing, sculpting, GPU procedural meshing, and object-specific primitives remain outside this step.


## Step 5 — reusable curve resources

rc.29 makes curves reusable authoring resources without turning them into runtime renderer resources. World 0.9 may define a top-level `curves` map and reference an entry anywhere Step 5 explicitly accepts a `CurveInput`, including `sweep.path` and path-array layout. Inline curve definitions remain supported.

```json
{
  "curves": {
    "main-spine": {
      "kind": "helix",
      "radius": 1.2,
      "height": 6,
      "turns": 2.25,
      "segments": 72
    }
  },
  "geometries": {
    "cable": {
      "kind": "sweep",
      "profile": { "points": [[-0.04,-0.04],[0.04,-0.04],[0.04,0.04],[-0.04,0.04]] },
      "path": "main-spine"
    }
  }
}
```

### Curve vocabulary

The reusable authoring vocabulary includes the established `line`, `polyline`, `quadraticBezier`, `cubicBezier`, and `catmullRom` kinds plus analytic `arc`, `circle`, and `helix`. The analytic forms deterministically lower to the existing normalized polyline evaluator and frame system; there is no parallel curve engine.

### Identity and runtime boundary

Curve references are resolved and normalized before dependent geometry is hashed. Therefore two names with identical normalized curve content can produce the same dependent geometry key, while changing the curve content changes that key. Curves themselves are not ResourceGraph nodes. ResourceGraph and Sekai64 still see only the ordinary geometry resources produced from them.

Native Object 0.1 imports namespace reusable curves and rewrite local sweep references during instantiation so imported objects do not collide with world-local curve IDs. World 0.8 remains unchanged. Reusable profiles are deferred to Step 6.


## Step 6 — reusable profile resources

rc.30 makes the existing canonical 2D profile language reusable without creating another topology subsystem. World 0.9 gains a top-level `profiles` map. Generic extrusion, sweep, variable-profile sweep stations, and loft sections may reference those resources by ID or continue authoring profiles inline.

```json
{
  "profiles": {
    "section": { "points": [[-0.5,-0.25],[0.5,-0.25],[0.5,0.25],[-0.5,0.25]] }
  },
  "geometries": {
    "column": { "kind": "extrude", "profile": "section", "depth": 3 },
    "rail": {
      "kind": "sweep",
      "profile": "section",
      "path": { "kind": "line", "points": [[0,0,0],[0,0,5]] }
    }
  }
}
```

### Identity and runtime boundary

Profile references resolve to normalized contour content before geometry hashing. Resource IDs therefore remain authoring conveniences rather than identity inputs. Two profile IDs with equivalent normalized points/holes can deduplicate dependent geometry; changing resource content changes dependent geometry identity.

Profiles themselves are not ResourceGraph or renderer resources. Sekai64 continues to receive only finalized `GeometryMesh` data. Native Object 0.1 imports namespace profiles and rewrite every Step 6 profile-reference site. World 0.8 remains unchanged.

Construction trim remains inline-profile-only in Step 6 because the architecture lowering boundary does not carry reusable-profile context. Step 7 owns generic scalar fields; it must build on the rc.30 canonical geometry/resource contracts rather than expanding Step 6 into field/displacement semantics.
## Step 7 — generic scalar fields

rc.31 adds a small renderer-neutral scalar-field language. A field answers only one question: given a local 3D position, what scalar value does this definition produce? This keeps procedural variation independent from domain concepts such as terrain, rocks, trees, water, or clouds.

```json
{
  "fields": {
    "shape": {
      "kind": "multiply",
      "fields": [
        { "kind": "noise", "seed": 42, "frequency": 1.5, "octaves": 3 },
        { "kind": "radial", "center": [0, 0, 0], "radius": 4 }
      ]
    }
  },
  "geometries": {
    "organic-form": {
      "kind": "pipeline",
      "source": { "kind": "sphere", "radius": 1 },
      "modifiers": [
        { "kind": "displace", "field": "shape", "strength": 0.25, "direction": "normal" }
      ]
    }
  }
}
```

### Field vocabulary

The built-in vocabulary is intentionally compact: `constant`, `gradient`, `distance`, `radial`, deterministic `noise`, the binary/n-ary composition operators `add`, `multiply`, `min`, and `max`, plus unary `invert` and `clamp`. Noise reuses Anyo's established deterministic 3D fBm sampler rather than introducing another procedural-noise implementation.

### Displacement integration

`displace` is a normal source-free geometry operator. It evaluates a normalized field at each source vertex and applies the result times `strength` along the vertex normal or the local X/Y/Z axis. Normal-directed displacement generates source normals when needed, and changed geometry regenerates normals/tangents through the existing mesh policies. The result remains a normal finalized `GeometryMesh`.

### Identity and runtime boundary

Named and nested field references resolve to canonical field content before dependent geometry is hashed. Equivalent inline and named fields can therefore produce the same geometry identity; changing field content changes that identity. Cycles and excessive definition depth/node counts fail before mesh execution.

Fields themselves are authoring resources, not ResourceGraph nodes. Sekai64 has no field concept. Native Object 0.1 imports namespace field IDs and rewrite both nested field references and `displace.field` use-sites. World 0.8 remains unchanged.

Step 8 owns namespaced geometry-extension/provider contracts. It must consume the canonical geometry/field contracts rather than making arbitrary world JSON execute code.
