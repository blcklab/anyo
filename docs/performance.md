# Performance

Anyo exposes renderer-neutral optimization metadata; Sekai64 decides how to realize it.

- `geometryKey`: reusable geometry identity
- `batchKey`: compatible grouping identity
- `static`: not expected to move independently
- `loading`: eager or lazy asset intent

The Sekai64 adapter uses shared unit geometry and instancing for compatible static box, plane, and cylinder primitives. Interactive instances retain individual IDs for picking.

Non-structural updates are sent incrementally. Structural changes safely rebuild the affected compiled world until finer room/floor invalidation is introduced.


## Runtime transform hot path

Animation and physics should write transient transforms instead of authoring JSON. Dirty entity transforms resolve once and are sent to renderers in one batch per frame through `applyRuntimeTransforms()` when available.

This path avoids document cloning, validation, history, normalization, and world recompilation. Legacy renderers retain the incremental primitive-update fallback, but high-frequency engines should target renderers with the synchronous runtime-transform capability.

Use fixed-step systems for deterministic simulation and normal update systems for animation/interpolation. See `runtime-systems.md` and the current benchmark report.
