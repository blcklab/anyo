# Anyo world 0.8 — procedural authoring

World schema 0.8 is an additive authoring surface for the procedural geometry/resource systems introduced in S1–S13. Existing 0.7 documents remain supported and do not need to migrate unless they want JSON-native procedural geometry.

The package default `@blcklab/anyo/schema` intentionally remains 0.7. Opt into 0.8 explicitly:

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.8.schema.json",
  "version": "0.8"
}
```

## Reusable geometry

Define geometry once at world scope and reference it from stable entities:

```json
{
  "version": "0.8",
  "geometries": {
    "reception-desk": {
      "kind": "roundedBox",
      "size": [5.4, 1.05, 1.1],
      "radius": 0.08,
      "segments": 4,
      "uv": { "mode": "box", "metersPerTile": 1 },
      "tangents": true
    }
  },
  "entities": [
    {
      "id": "reception",
      "type": "geometry",
      "geometry": "reception-desk",
      "position": [0, 0.54, 4.7],
      "material": "graphite"
    }
  ]
}
```

`geometry` can also contain an inline GeometryDefinition. JSON describes construction intent; raw vertex/index dumps are not part of this authoring contract.

## Semantic material regions

`materialBindings` maps existing S3/S4/S8/S13 semantic geometry-group names to ordinary Anyo material ids:

```json
{
  "id": "feature",
  "type": "geometry",
  "geometry": { "kind": "box", "size": [3, 4, 0.2] },
  "material": "graphite",
  "materialBindings": {
    "front": "cyan"
  }
}
```

The compiler lowers this directly to S13 `InstanceResource.materialBindings`; there is no second material-region implementation.

## Semantic construction

A `construction` entity accepts the existing S7 ArchitectureDefinition. S7 remains authoritative and lowers walls, floors, stairs, railings, columns, roofs, panels and related semantic assemblies into generic geometry/resources.

```json
{
  "id": "south-wall",
  "type": "construction",
  "material": "graphite",
  "construction": {
    "type": "wall",
    "from": [-5, 0, 0],
    "to": [5, 0, 0],
    "height": 3.5,
    "thickness": 0.2,
    "openings": [
      { "kind": "door", "id": "entry", "offset": 4, "width": 2, "height": 2.6 }
    ]
  }
}
```

For construction entities, `materialBindings` may map S7 architecture roles to material ids; `material` remains the fallback.

## Procedural collision

S15 connects schema-0.8 procedural entities to the existing Anyo `CompiledCollider` domain. Collision remains opt-in and renderer-neutral.

```json
{
  "id": "south-wall",
  "type": "construction",
  "collisionPolicy": "semantic",
  "construction": {
    "type": "wall",
    "from": [-5, 0, 0],
    "to": [5, 0, 0],
    "height": 3.5,
    "thickness": 0.2,
    "openings": [
      { "kind": "door", "id": "entry", "offset": 4, "width": 2, "height": 2.6 }
    ]
  }
}
```

Supported policies:

- `none`: no procedural collider.
- `bounds`: one coarse collider from transformed geometry/construction bounds.
- `semantic` / `parts`: for S7 construction, lower the existing semantic solid parts into normal Anyo colliders. Door/window openings therefore remain voids instead of being filled by a whole-wall AABB.

`collision: true` remains supported. For procedural entities it defaults to `bounds` for `geometry` and semantic part lowering for `construction`. An explicit `collisionPolicy` can opt a procedural entity into collision without adding the legacy boolean.

Generic geometry currently supports `bounds` only. `semantic`/`parts` fail explicitly rather than silently inventing inaccurate collision. Floors lower as `floor` colliders and stairs as `stair` colliders so existing exploration/XR support and stepping logic is reused.

## Organic geometry with `noise`

S16 adds a generic deterministic deformation expression. It is ordinary geometry and therefore works anywhere a schema-0.8 `GeometryDefinition` is accepted:

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

`noise` is not a cloud, rock, terrain, or renderer object. It deforms its source deterministically and participates in normal geometry hashing, caching, ResourceGraph dependencies, material regions, runtime instances, and S15 bounds collision. The same definition and seed produce the same mesh. Changing the seed or offset produces a different content-addressed geometry resource.

`offset` is a sampling-space value applied as `localPosition * frequency + offset`. Moving an entity still uses the runtime transform path and does not rebuild geometry. S16 does **not** regenerate geometry every frame to animate `offset`; that remains a later bounded feature.

## Runtime behavior

A 0.8 document is validated and normalized normally. Procedural declarations are then compiled into the existing content-addressed `ResourceGraph` and realized by the renderer adapter. Geometry/material identity remains shared; semantic instance ids remain stable.

Runtime entity transforms update realized ResourceGraph instances in place. They do not rebuild geometry. Multi-part constructions retain each part's authored local offset while the owning entity moves.

## Compatibility boundary

- 0.7 worlds keep their existing primitive/building path.
- `geometries`, `type: "geometry"`, and `type: "construction"` require 0.8.
- Existing 0.2–0.6 migrations still target 0.7.
- 0.8 documents are pass-through normalized rather than down-migrated to 0.7.
- Procedural collision is available in S15 through the existing `CompiledCollider` domain; no renderer-specific or triangle-mesh physics path is introduced.
## S17 lathe and deformation geometry

World 0.8 can also author `lathe`, `bend`, `twist`, and `taper` directly inside named or inline procedural geometry definitions. No schema-version change is required because 0.8 geometry definitions intentionally use the generic `kind` vocabulary and Anyo performs kind-specific validation during geometry compilation.

```json
{
  "geometries": {
    "sculpted-column": {
      "kind": "twist",
      "source": {
        "kind": "lathe",
        "profile": [[0.3, 0], [0.55, 0.35], [0.45, 2.2], [0.25, 2.6]],
        "segments": 32
      },
      "axis": "y",
      "angle": 0.35
    }
  }
}
```

These operations compile through the same S14 ResourceGraph, S15 collision, and runtime-instance paths. Changing the authored shape parameters changes geometry identity; changing the entity transform does not.

