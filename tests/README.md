# Tests

From the project root:

```bash
npm ci
npm test
```

`npm test` builds the package, then runs every `tests/*.test.mjs` file with Node's test runner. Each file runs in a separate process. Failed assertions, import errors, and timeouts fail the command.

After building, use `npm run test:run` to rerun the suite, or run one file:

```bash
node --test tests/xr.test.mjs
```

Tests import the built ESM package from `dist/esm`. Add new tests as `.test.mjs` files; the runner rejects unsupported test extensions so they cannot be silently left out.

Before pushing or publishing, run `npm run check`. It adds type checking, export and compatibility checks, dependency-boundary checks, npm package verification, a size report, and the production test structure check. GitHub runs it on Node 20, 22, and 24; version-tag publishing and local `npm publish` also require it to pass.

The suite covers world documents, validation, geometry, updates, lifecycle, editor operations, runtime systems, web surfaces, and XR contracts. Browser and XR tests use mocks. Test the actual viewer in supported browsers and headsets as well.

For performance measurements, see [the performance guide](../docs/performance.md).
