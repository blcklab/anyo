# Semantic architecture (S7)

`@blcklab/anyo/geometry` exposes S7 architectural lowering through `lowerArchitecture()`. Architecture remains renderer-neutral and lowers semantic authoring into existing procedural geometry expressions and instance placements.

## Responsibility boundary

```text
semantic architecture
  -> ArchitectureAssembly
       -> geometry definitions + transforms
       -> shared instance groups
       -> anchors
  -> future resource/runtime integration
```

Architecture code does not generate GPU buffers, import Sekai64, assign concrete materials, mutate world entities, or update Player/camera systems.

## Wall openings

S7 intentionally avoids CSG for ordinary rectangular openings. Wall spans are split at opening boundaries and only solid regions are emitted. This supports floor-touching doors without weakening S4's strict profile-hole validation. S8 adds CSG as a separate lower-level geometry tool; S7 architecture does not become dependent on it.

`offset` is measured from the authored wall `from` endpoint to the opening's left edge along the wall span. Door openings start at wall base. Window openings add `sillHeight`. Overlapping openings are rejected.

## Instance-oriented semantics

Stairs emit shared tread/riser geometry plus placement groups. Railings emit sweep rails plus a shared post source and path-derived placements. This preserves geometry identity and prepares the future renderer/resource model for instancing rather than baking repeated geometry.

## Anchors

Assemblies expose deterministic named anchors such as wall `left`, `right`, `center`, `top`, `bottom`, opening centers, stair `bottom`/`top`, and railing endpoints. S7 does not yet implement a general constraint solver; anchors are the stable semantic data that a future attach/snap/fit layer can consume.

## Current limitations

S7 walls and beams require horizontal from/to endpoints. Sloped arbitrary-axis structural semantics, constraint solving, material assignment, world-schema integration, runtime resource graphs, and renderer instancing remain deferred. General CSG exists separately in S8 and is not part of S7 semantic lowering.
