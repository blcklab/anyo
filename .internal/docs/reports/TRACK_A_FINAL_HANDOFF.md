# Track A A1–A12 Final Handoff

## Outcome

Track A is implemented as an additive hardening of Anyo's JSON-first architecture. Versioned Anyo JSON remains authoritative; compiled worlds and renderer-native objects remain disposable projections.

The implementation does not move physics, animation, audio, avatar, VFX, hologram, networking, editor UI, browser device creation, or GPU resource management into Anyo core.

## Delivered milestones

1. **A1 Audit and architecture freeze** — capability map, ownership boundaries, ADRs, compatibility policy.
2. **A2 Schema foundation** — world schema `0.7`, JSON Schema draft 2020-12, strict root, extension composition, exported historical schemas.
3. **A3 Cameras and rendering intent** — named cameras, active selection, compiled records, incremental camera changes, deterministic host-policy resolver.
4. **A4 Named channels** — separate render, picking, and editor namespaces compiled to masks; physics layers remain extension-owned.
5. **A5 Safe actions and events** — small serializable command set, registered custom handlers, sequences, reference validation, no executable source strings.
6. **A6 Extensions and capabilities** — formal manifests, common semver compatibility, capability checks, schema/validation/migration/snapshot hooks, collision prevention.
7. **A7 Stable patches** — atomic revisioned transactions with stable targets, stale-patch rejection, structured impact/results, JSON Pointer compatibility.
8. **A8 Incremental compiler foundation** — dependency maps, compiler timings, hashes, rebuild reasons, minimal compatible renderer changes.
9. **A9 Prefab hardening** — stable instance and child identity, inheritance, nested references, override maps, provenance, versions, cycle/depth checks, unflattened source serialization.
10. **A10 Runtime snapshots** — separate versioned runtime state, partial restore, explicit commit, deterministic extension-owned snapshot data.
11. **A11 Asset manifests and packages** — dependencies, variants, integrity/size/MIME/provenance metadata, deterministic package manifests and required-file descriptors.
12. **A12 Determinism and security** — canonical serialization/hash, finite-number normalization, plain-JSON enforcement, unsafe-path rejection, host URL policies, bounded resources, deterministic migrations.

## Architectural guarantees

- Anyo can validate, migrate, normalize, compile, patch, serialize, snapshot, and package worlds without Sekai64.
- Sekai64 remains independently usable and is referenced only by the optional adapter subpath.
- The Editor remains optional.
- World JSON cannot dynamically install/import packages or evaluate executable JavaScript strings.
- Host policy always has final control over backend, canvas, device limits, pixel ratio, memory, accessibility, and fallback decisions.

## Incremental behavior

Compatible updates can project incrementally for cameras, active camera, channels, rendering intent, primitive transforms, visibility, material/content, room visibility, portal state, and collider enabled state.

A safe full compile/rebuild fallback remains for topology changes, unknown impact, unsupported adapter capabilities, or extension-owned data without dependency information.

## Honest current limitation

The compiler dependency graph currently provides selective impact classification and minimal renderer projection, but most authored-document commits still perform full deterministic normalization/compilation before diffing. A future persistent compiler cache can optimize that internal stage without changing the public document, patch, snapshot, or adapter contracts.

## JSON-first reassessment

Evidence-based architecture score after Track A: **9.1/10**.

Strengths:

- Complete authoritative document/runtime projection boundary
- Versioned schema and deterministic migration
- Renderer-independent cameras, channels, rendering intent, actions, extensions, patches, prefabs, snapshots, and assets
- Stable identity and safe synchronization foundation
- No editor or renderer requirement
- Strong package/security boundaries

Remaining work toward 10/10:

- Persistent selective source compilation rather than full normalization for most edits
- More strictly discriminated nested core entity/material schema without breaking extension compatibility
- Full npm semver range grammar if ecosystem requirements justify it
- Optional collaborative merge/conflict strategy beyond revision rejection and metadata
- Host-side ZIP/folder materialization and cryptographic document signing

## Validation

- `npm run check`: passed
- Tests: 184/184 passed
- Export files: 72 verified
- Package boundary, stability, package-content, and size checks: passed
- 10,000-entity architecture benchmark: completed with zero validation diagnostics

See:

- `../implementation/TRACK_A_IMPLEMENTATION.md`
- `../architecture/TRACK_A_ARCHITECTURE_AUDIT.md`
- `TRACK_A_API_COMPATIBILITY_REPORT.md`
- `TRACK_A_VALIDATION_REPORT.md`
- `TRACK_A_BENCHMARK_REPORT.md`
- `../migrations/MIGRATION_WORLD_0.7.md`
- `docs/json-first-architecture.md`
- `docs/adr/`

## Recommended next version

Keep the current package version while downstream testing is performed. After Player, Editor, ecosystem-package, and consumer validation, release:

```text
@blcklab/anyo@0.10.0-rc.1
```
