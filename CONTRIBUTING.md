# Contributing

## Setup

```bash
npm install
npm run check
```

## Design rules

- Keep the architectural compiler renderer-independent.
- Do not add mandatory runtime dependencies to core modules.
- Add new behavior through focused plugins or adapters.
- Preserve declarative JSON and avoid executable code in documents.
- Include tests for geometry, normalization, collision, and runtime changes.
- Keep public APIs typed and SSR-safe where practical.

## Pull requests

A pull request should include:

- a clear problem statement
- tests for behavior changes
- documentation for public API changes
- no generated `dist` files unless the repository policy changes
