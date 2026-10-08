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
