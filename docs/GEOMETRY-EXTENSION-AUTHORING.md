# Geometry extension authoring

Anyo Core geometry is frozen at the rc.36 long-term contract. New domain-specific geometry algorithms should normally ship as trusted namespaced providers rather than new Core kinds.

## Provider contract

A provider is ordinary trusted host code. It owns one lowercase namespace, declares a provider version, and exposes one or more local kind compilers.

```js
export const provider = {
  namespace: 'acme.architecture',
  version: '1.0.0',
  kinds: [
    {
      name: 'spiral-stair',
      normalize(definition) {
        return definition
      },
      compile(definition, context) {
        return context.compileSource({
          kind: 'cylinder',
          radius: 1,
          height: 2,
          segments: 24,
          cap: true
        })
      }
    }
  ]
}
```

The authored kind is `acme.architecture:spiral-stair`.

## Trust boundary

World JSON never installs, imports, downloads, or evaluates provider code. The host application explicitly registers trusted providers before compiling/loading dependent worlds.

```js
import { createWorld, entitiesPlugin } from '@blcklab/anyo'
import provider from '@acme/anyo-architecture'

const world = createWorld({
  geometryExtensions: [provider],
  plugins: [entitiesPlugin()]
})
```

A world then references the registered kind through the code-free namespaced envelope:

```json
{
  "kind": "acme.architecture:spiral-stair",
  "params": {
    "radius": 2,
    "height": 4,
    "steps": 32
  }
}
```

Provider-specific authoring data belongs under `params`. The extension root remains limited to the namespaced `kind`, optional `params`, and Anyo's ordinary geometry surface policies.

## Compile through the generic language first

Providers should reuse the public generic geometry language whenever practical. `GeometryBuildContext` exposes `compileSource()`, operator helpers, curve/profile/field resolution, and finalization so an extension can lower to normal Anyo geometry instead of creating a renderer-specific path.

Recommended order inside a provider:

1. normalize provider parameters deterministically;
2. compose existing Anyo sources/operators when they express the algorithm cleanly;
3. use `kind: "mesh"` when the provider genuinely generates custom indexed topology;
4. return a renderer-neutral mesh draft/result;
5. bump the provider `version` whenever executable geometry semantics change.

ResourceGraph realization bakes extension-containing expressions to ordinary built-in `mesh` resources. Sekai64 and other renderer adapters do not load or dispatch provider packages.

## Identity and cacheability

The extension namespace, provider version, and referenced kind participate in Anyo's `g2` build identity. Two providers using the same authored JSON but different versions therefore do not share stale geometry-cache/resource identities.

Provider version is optional for backward compatibility, but reusable external packages should always supply one. An unversioned provider cannot give deterministic cross-release invalidation guarantees.

## Collision

Procedural collision uses the same registered geometry compiler. If an entity using extension geometry opts into collision, the provider must be available when the world is compiled; no separate provider-specific collision implementation is needed.

## Reference example

`examples/geometry-extension-provider/` is the post-freeze integration proof. It is intentionally a separate private package fixture and contains no Anyo-internal imports.

It demonstrates two patterns:

- `blcklab.reference:twisted-spire` composes built-in cylinder/taper/twist geometry through `compileSource()`.
- `blcklab.reference:stellated-prism` creates custom indexed topology and lowers it through the generic `mesh` escape hatch.

The normal release gate copies the example outside the repository and verifies it against the built public Anyo surfaces. This prevents the reference provider from accidentally depending on private source paths.

## When not to use an extension

Do not create a provider for a shape that is already easy to express as world composition. Prefer reusable curves/profiles/fields, sweep/loft/extrude, the operator stack, and arbitrary indexed mesh first. Extensions are for reusable algorithms with real domain value, not synonyms for ordinary authored objects.
