# Track A Validation Report

Validation date: 2026-08-04

## Complete package check

Command:

```bash
npm run check
```

Result: **passed**

The check included:

- Strict TypeScript type checking
- ESM, CommonJS, and declaration builds
- Complete Node test suite
- Export-file verification
- Stability-contract verification
- Package-boundary verification
- npm package-content verification
- Bundle-size reporting

## Results

- Tests: **184 passed, 0 failed**
- Package export files: **72 verified**
- Runtime dependencies: **0**
- Forbidden Anyo-core imports of Sekai64 or Three.js: **none**
- `eval` / `new Function` usage: **none**
- Packed package size: **470,449 bytes compressed**
- ESM JavaScript: **635.3 kB raw / 153.6 kB gzip across 104 modules**

## Track A coverage

Focused tests cover:

- Draft 2020-12 schema and deterministic schema composition
- Cameras, active-camera selection, channels, and masks
- Rendering intent versus host/device policy
- Extension versions, capabilities, collisions, migrations, validation, schema, and snapshot hooks
- Safe declarative actions and concrete target validation
- Atomic stable-ID transactions, revision checks, rollback, and room-component targets
- Dependency graph and incremental material/camera projection
- Prefab inheritance, overrides, stable instance identity, serialization, and cycle rejection
- Partial runtime snapshots, compatibility validation, explicit commit, and extension state
- Asset dependencies, manifests, integrity metadata, variants, and package descriptors
- Canonical serialization, canonical hashes, security limits, URL policy, migration idempotence, and future-version rejection

## 10,000-entity benchmark

Machine-dependent Node.js measurements are recorded in `TRACK_A_BENCHMARK_REPORT.md` and `track-a-benchmark-results.json`.

Latest medians:

| Scenario | Median |
|---|---:|
| Validate 10,000-entity document | 18.823 ms |
| Normalize and expand | 90.959 ms |
| Build dependency graph | 7.835 ms |
| Canonical serialization | 57.388 ms |
| Canonical document hash | 65.793 ms |
| Single atomic stable-ID transform transaction | 23.647 ms |
| Portable package descriptor | 173.039 ms |

The benchmark document completed validation with **zero diagnostics**.

## Boundary statement

These measurements cover Anyo document architecture only. They do not measure browser rendering, WebGL2, WebGPU, Sekai64 GPU frame time, mobile thermals, or network/package-download performance.

## Remaining downstream validation

Before publishing the recommended release candidate, run:

- Anyo Player consumer suite
- Anyo Editor preview/edit/history suite
- Physics, animation, audio, avatar, VFX, hologram, platform, and world-map compatibility suites
- Vue, React, CDN/no-build, and server-side-import consumers
- Real browser/device validation for the optional Sekai64 adapter
