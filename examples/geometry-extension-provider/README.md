# Geometry extension provider reference

This example is intentionally outside Anyo Core. It demonstrates the post-freeze extension path using only the public trusted-provider contract.

The provider owns the `blcklab.reference` namespace and exposes two example kinds:

- `blcklab.reference:twisted-spire` — lowers to ordinary built-in cylinder/taper/twist geometry through `GeometryBuildContext.compileSource()`.
- `blcklab.reference:stellated-prism` — generates custom indexed geometry and lowers it through the built-in `mesh` escape hatch.

The accompanying `world.anyo.json` proves that namespaced extension geometry can be used directly and inside a normal operator pipeline. Both entities opt into procedural collision. At runtime the host must register `referenceGeometryProvider`; the JSON document never imports or executes provider code.

The package is `private` because it is a reference fixture, not a separately published product. Copy it outside this repository and it still works: `provider.mjs` has no Anyo-internal imports and depends only on the public structural provider contract supplied by the host.
