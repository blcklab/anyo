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
