# Track A Architecture Audit

## Scope

This audit covers `@blcklab/anyo` and its optional `renderer-sekai64` adapter. It deliberately does not move physics, animation, audio, avatar, VFX, hologram, platform, editor UI, GPU resource management, or browser device creation into Anyo core.

## Canonical ownership

```text
Versioned Anyo WorldDocument
  -> validation and migration
  -> deterministic normalization and compilation
  -> CompiledWorld
  -> optional renderer adapter
  -> disposable renderer projection
```

The authored `WorldDocument` is authoritative. `CompiledWorld` and renderer-native objects are derived and disposable.

## Baseline capability map

| Area | Baseline status | Track A decision |
|---|---|---|
| JSON world documents | Existing | Preserve and version as world document 0.7 |
| Schema validation | Existing but centered on 0.6 | Add a draft 2020-12 schema, composition utilities, and security limits |
| Migrations | Existing for legacy documents | Add deterministic 0.2–0.6 to 0.7 migration |
| Cameras | Primarily adapter/host configured | Add renderer-neutral named camera declarations and compiled records |
| Layers/masks | Renderer concepts existed | Add named render, picking, and editor channels; keep physics groups extension-owned |
| Actions | Registered action and interaction support existed | Add a small safe declarative command model; never execute source strings |
| Extensions | Components and registries existed independently | Add formal package/capability manifests and code-side hooks |
| Patching | JSON Pointer patches and history existed | Preserve them and add revisioned stable-ID transactions |
| Incremental updates | Primitive change classification existed | Add dependency graphs, camera/channel changes, diagnostics, and safe fallback |
| Prefabs | Expansion existed | Add inheritance, stable instance identity, overrides, versions, provenance, and cycle checks |
| Runtime state | Runtime data/transforms existed | Add explicit versioned snapshots separate from authored JSON |
| Assets | Asset registry and loading existed | Add manifests, integrity metadata, variants, dependency ordering, and package descriptors |
| Determinism | Stable serialization existed | Add canonical JSON, document hashing, deterministic generated authoring IDs, and snapshot serialization |
| Security | Safe paths existed | Add plain-object checks, resource limits, action/prefab bounds, and host URL policy hooks |

## Package ownership boundaries

| Concern | Owner |
|---|---|
| Authored world meaning, migration, validation, compilation, stable patches | `@blcklab/anyo` |
| GPU rendering and renderer-native resource lifetime | Sekai64 or another renderer |
| Anyo-to-Sekai64 projection | Optional `@blcklab/anyo/renderer-sekai64` adapter |
| Physics behavior and collision groups | `@blcklab/anyo-physics` |
| Animation runtime and state | `@blcklab/anyo-animation` |
| Avatar and VRM behavior | `@blcklab/anyo-avatar` |
| Audio runtime | `@blcklab/anyo-audio` |
| Particles and effects | `@blcklab/anyo-vfx` |
| Hologram behavior | `@blcklab/anyo-hologram` |
| Editor UI | `@blcklab/anyo-editor` |
| Publishing, discovery, marketplace, server policy | Anyo Platform packages |

## Code-only systems

The following remain imperative and host-controlled:

- WebGPU adapter/device and WebGL context creation
- Canvas ownership and browser capability checks
- GPU resources, shaders, render passes, and disposal
- Physics solvers and animation interpolation
- Asset decoders and compressed-texture transcoders
- Network transports, authentication, databases, and payments
- Browser permissions and XR session entry
- DOM mounting, editor panels, and debug overlays
- Application-specific registered action handlers

JSON may configure intent or reference stable identifiers, but it cannot contain their executable implementation.

## Public compatibility policy

- Existing 0.2–0.6 worlds migrate to 0.7.
- Existing JSON Pointer patch APIs remain supported.
- Existing entity, component, asset, Web Surface, XR, and renderer APIs remain exported.
- Anyo core keeps zero runtime dependencies.
- Anyo core does not import Sekai64, Three.js, DOM modules, or GPU APIs.
- New architecture APIs are additive; the package version remains unchanged until consumer/device validation is complete.
