# Anyo Universal Geometry — Long-Term Freeze Contract

`@blcklab/anyo@0.11.0-rc.36` is the long-term geometry freeze candidate produced after the rc.25–rc.35 universal-geometry series. This document is the authoritative human contract; [`geometry-freeze-contract.json`](geometry-freeze-contract.json) is the machine-readable CI snapshot.

## Freeze intent

The geometry layer is considered complete enough for long-lived world authoring. The default policy after rc.36 is **build worlds, tooling, and optional extensions — not new Anyo Core geometry features**. A new visual object is not evidence that Core needs a new kind.

The stable renderer boundary remains:

```text
World/Object JSON
  -> reusable Curve / Profile / Field resources
  -> GeometrySource
  -> ordered GeometryOperator stack
  -> canonical GeometryBuildIdentity (anyo.geometry/1)
  -> validated GeometryMesh
  -> ResourceGraph
  -> renderer adapter (Sekai64 today)
```

Renderers do not learn semantic object types, scalar-field semantics, extension namespaces, or authoring-resource identities.

## Frozen decision order

When a world needs a form that does not already have an obvious recipe, use this order:

1. **Compose existing geometry.** Prefer primitives, CSG, extrude, sweep, loft, reusable curves/profiles/fields, transforms, and world/entity composition.
2. **Use the operator stack.** Prefer transform, taper, twist, bend, mirror, noise, array, weld, and field-driven displacement before inventing a new source kind.
3. **Use arbitrary indexed mesh.** If an algorithm or external tool can produce triangles, feed positions/indices/attributes/groups through `kind: "mesh"`.
4. **Use a trusted namespaced extension.** If a reusable algorithm deserves a package, register it from trusted host code and lower it to `GeometryMesh`; JSON never installs or executes code.
5. **Reopen Core only for a fundamental missing capability.** A Core addition requires evidence that an entire class of forms is blocked and that the capability cannot reasonably, safely, or efficiently be expressed by steps 1–4.

Object-specific requests such as tree, road, roof style, bridge, stair style, rock, cloud, planet, furniture, or pavilion are normally compositions or extension-package concerns, not new Core geometry kinds.

## Frozen vocabulary

The machine-readable snapshot freezes the current built-in geometry-kind and operator lists. The important authoring families are:

- source/solid construction: `mesh`, primitives, `extrude`, `sweep`, `loft`, CSG, and `pipeline`;
- reusable resources: curves, profiles, and scalar fields;
- operator composition: transform/taper/twist/bend/mirror/noise/array/weld/displace;
- arbitrary triangle escape hatch: `mesh`;
- trusted algorithm escape hatch: namespaced geometry extensions;
- deterministic compiler/resource identity: `anyo.geometry/1` + normalized source + extension provenance;
- validation: bounded structural errors plus configurable non-fatal diagnostics.

Legacy nested transform/mirror/noise/bend/twist/taper geometry kinds remain compatibility forms. New work should prefer `pipeline` when composing ordered mesh operations.

## What remains deliberately outside the frozen Core

The following are deferred rather than half-implemented:

- SDF / implicit modeling;
- marching cubes;
- surface nets;
- voxel geometry;
- advanced remeshing;
- sculpting;
- GPU procedural meshing;
- CAD-level modeling.

These are new subsystems with their own topology, resolution, memory, LOD, determinism, and tooling requirements. If one becomes necessary later, it should be proposed as an explicit post-freeze architecture milestone rather than smuggled into an unrelated world feature.

## Reopening rules

A proposal to change the frozen Core should include all of the following:

- the blocked **class of forms**, not one desired object;
- why composition, operators, arbitrary mesh, and a trusted extension are insufficient;
- the renderer-neutral contract and deterministic normalization strategy;
- safety/complexity limits and malformed-input behavior;
- identity/cache implications;
- backward-compatibility impact for World 0.8/0.9 and Object 0.1;
- torture/showcase coverage proving the capability generically;
- a new patch milestone with source reconstruction and package validation.

If unchanged canonical source is intentionally allowed to produce different mesh semantics, bump `GEOMETRY_BUILD_ABI` from `anyo.geometry/1`. Extension providers must bump their own provider `version` when their executable geometry semantics change.

## CI enforcement

`npm run verify:geometry-freeze` compares the built package with `geometry-freeze-contract.json`. It verifies the geometry ABI, built-in kinds/operators, curve/field vocabularies, World 0.8/0.9 schema checkpoints, and the Step 11 showcase checkpoint. `npm run check` includes this gate.

Changing a frozen item is still possible, but it must be deliberate: update the authoritative contract and its snapshot in the same reviewed milestone. Silent vocabulary drift is treated as a release failure.

## Acceptance basis

The freeze is based on the Step 11 universal showcase/torture proof. Eight substantially different forms compile from the generic language with zero geometry diagnostics and without adding semantic primitives or renderer-specific code. rc.36 therefore closes the universal-geometry feature series.
