# Anyo 0.9.0-rc.3 Validation

## Automated validation completed

```txt
Strict TypeScript                         passed
Node test suite: 124 tests                passed
Package exports: 68 files                 passed
Renderer-boundary verification            passed
Forbidden eval/new Function scan           passed
Packed-package content verification        passed
Exact Sekai64 0.7.0-rc.4 consumer          passed
ESM size report                            passed
Benchmark suite                            completed
```

## Package measurements

```txt
Packed package      302,267 bytes
Unpacked package  2,279,501 bytes
ESM JavaScript       432.6 kB raw
ESM JavaScript       107.8 kB gzip
ESM modules               92
```

## Manual deployment gates

- Pointer lock and focus behavior in Chrome, Firefox, and Safari
- Touch controls on Android and iOS
- Real asset-progress behavior with remote GLB and texture assets
- Repeated world load, pause, renderer replacement, XR enter/exit, and async disposal
- Physical WebXR headset validation
- Long-running browser memory and GPU-resource profiling

Do not promote the release candidate to stable based only on deterministic Node tests and renderer-contract mocks.
