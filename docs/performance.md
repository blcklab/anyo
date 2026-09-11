# Performance

Measure the application with representative worlds. Anyo compiles and updates world state; the renderer handles draw calls and GPU resources, so profile both sides.

## Reuse geometry and send small updates

Compiled primitives carry `geometryKey` for reusable geometry, `batchKey` for compatible groups, `static` for objects that do not move independently, and `loading` for eager or lazy asset loading.

The Sekai64 adapter can share unit geometry and instance compatible static boxes, planes, and cylinders while preserving IDs for picking. Non-structural changes use incremental updates. Changes that require rebuilding go through the compiler and remount path.

## Keep simulation out of document edits

Animation and physics should use transient transforms. Anyo resolves dirty entity transforms and sends one renderer batch per frame through `applyRuntimeTransforms()` when supported. Older adapters fall back to incremental primitive updates.

This avoids cloning, validating, adding history, and recompiling the document every frame. Use fixed-step systems for simulation and `update()` for animation or interpolation. See [runtime systems](runtime-systems.md).

## Run benchmarks

```bash
npm run benchmark
npm run benchmark:track-a
npm run benchmark:track-f
```

The first two commands write reports under `docs/reports/`; the production benchmark reports timing and memory in the terminal. Record the package version, machine, Node or browser version, renderer backend, scene size, and quality settings when comparing results.

`tests/track-f-production.test.mjs` exercises 10,000-entity documents, transactions, hashing, and compiler dependencies as part of `npm test`. Passing it confirms behavior, not a frame-rate target or real GPU performance.
