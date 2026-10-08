# Architecture

> Anyo defines, validates, compiles, and manages virtual worlds. Renderer adapters convert Anyo’s renderer-independent compiled output into visual output. Anyo does not depend on a specific graphics engine.

```text
World JSON
  → safe validation and normalization
  → data-binding resolution
  → prefab and repeat expansion
  → room constraints and attachment intervals
  → building and entity compilation
  → CompiledWorld
  → RendererAdapter
  → Sekai64 WebGPU/WebGL2 visual output
```

## Ownership boundary

Anyo owns documents, geometry intent, architectural constraints, colliders, portals, history, runtime data, exploration, actions, and lifecycle.

Sekai64 owns GPU resources, nodes, geometry, materials, textures, models, lights, cameras, picking, instancing, rendering, and disposal.

No Sekai64 node is authoritative world state. A renderer can be replaced without changing JSON.

## CompiledWorld

`CompiledWorld.version` is versioned independently from the authoring-document version. It exposes primitives, materials, colliders, portals, room chunks, triggers, lookup maps, units, and optional metadata.

Compiled primitive IDs are stable and deterministic. A primitive may include:

- `sourcePath` for diagnostics
- `geometryKey` for reusable geometry
- `batchKey` for compatible grouping
- `static` for renderer optimization
- `loading` for media/model policy

## Coordinates

- Right-handed coordinates
- X: west/east, east positive
- Y: vertical, up positive
- Z: north/south, south positive
- North: negative Z
- Units: meters
- Room positions: `[x, z]`
- Entity positions: `[x, y, z]`
- Entity rotations: Euler radians

## Runtime state boundary

Anyo separates persistent authoring state, transient simulation state, and final renderer state:

```text
World JSON and history
        ↓
Compiled authored world
        +
Runtime systems and transient transform layers
        ↓
Batched renderer state
```

Animation and physics engines should use `WorldSystem` and `RuntimeTransformStore` rather than mutating the document every frame. The systems foundation remains renderer-neutral and contains no animation mixer or physics solver.
