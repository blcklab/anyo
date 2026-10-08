# Track F production validation

Track F validates Anyo as the authoritative JSON world architecture under production-scale conditions. It adds no renderer, physics, animation, audio, avatar, VFX, networking, or editor ownership to Anyo core.

The gate covers:

- deterministic 10,000-entity fixtures
- validation, normalization, dependency graphs, canonical serialization, and hashing
- stable-ID transactions and inverse operations
- extension-data preservation
- security and resource-limit enforcement
- package, exports, side-effect, and renderer-boundary checks
- coordinated browser, renderer, Player, Editor, and physical-device evidence through the ecosystem Track F harness

Run:

```bash
npm run test:track-f
npm run benchmark:track-f
```

Node benchmarks measure document and compiler architecture only. They are not browser FPS or GPU claims.
