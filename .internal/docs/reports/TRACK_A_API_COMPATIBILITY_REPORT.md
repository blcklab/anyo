# Track A API Compatibility Report

## Baseline

- Package: `@blcklab/anyo@0.10.0-rc.1`
- World document baseline: `0.6`
- Track A world document: `0.7`
- Runtime dependencies: unchanged at zero
- Optional peers: Three.js and Sekai64 remain optional

## Compatibility result

Track A is additive at the package API level. No existing root export or published subpath was removed. Existing JSON Pointer patching, editor operations, plugins, components, Web Surface, XR, Three.js adapter, and Sekai64 adapter remain published and covered by the complete test suite.

The default `@blcklab/anyo/schema` export now resolves to world schema `0.7`. Historical schema subpaths remain available, including `./schema/0.2` through `./schema/0.6`.

## New public package subpaths

- `@blcklab/anyo/schema/0.7`
- `@blcklab/anyo/snapshots`

## New root APIs

- `ExtensionRegistry`
- `applyJsonPatchValue`
- `applyStableTransaction`
- `buildCompilerDependencyGraph`
- `canonicalSnapshotString`
- `canonicalWorldString`
- `canonicalizeJson`
- `canonicalizeWorldDocument`
- `compileCameras`
- `compileWorldChannels`
- `createPortableWorldPackageDescriptor`
- `createPortableWorldPackageManifest`
- `createWorldSchema`
- `hashWorldDocument`
- `inspectArchitectureDocument`
- `inspectAssetManifest`
- `inspectWorldRuntimeSnapshot`
- `resolveAssetVariant`
- `resolveChannelMask`
- `resolveRenderingConfiguration`
- `validateWorldRuntimeSnapshot`

## New `World` APIs

- `activateCamera()`
- `applyTransaction()`
- `commitSnapshot()`
- `createSnapshot()`
- `dispatchDocumentEvent()`
- `executeActions()`
- `getCompilerPerformanceReport()`
- `getDependencyGraph()`
- `registerSnapshotExtension()`
- `restoreSnapshot()`
- `serializeDocument()`

## Migration behavior

Documents from `0.2` through `0.6` migrate deterministically to `0.7`. Migration:

- Preserves IDs, authoring IDs, prefabs, assets, metadata, variables, components, and extension namespaces.
- Initializes `revision` to `0` when absent.
- Preserves unknown legacy root fields under `extensions["anyo.legacyRoot"]` rather than discarding them.
- Is idempotent when run on an already migrated `0.7` document.
- Rejects unsupported future document versions rather than silently downgrading them.

## Intentional validation tightening

The following invalid documents may now fail earlier:

- Unknown concrete camera IDs in `activateCamera` actions.
- Unknown concrete entity or authoring IDs in built-in entity-target actions.
- Invalid named channel references.
- Duplicate prefab `instanceId` values.
- Circular prefab inheritance or nesting.
- Stale or non-monotonic transaction revisions.
- Unsafe URL schemes when the host supplies an asset URL policy.
- Documents exceeding configured entity, hierarchy, action, asset, metadata, extension, or snapshot limits.

Symbolic action targets such as `$self` remain valid for extension/runtime resolution.

## Renderer compatibility

The renderer contract gained optional camera, channel, rendering-intent, and capability methods. Existing renderer adapters remain valid because the new methods are optional. Unsupported requested features produce structured diagnostics and safe rebuild/remount fallback where necessary.

## Deprecations and removals

- No public API was removed.
- No existing public API was newly deprecated.
- Existing JSON Pointer patch APIs remain the compatibility layer beneath stable-ID transactions.

## Recommended release version

After consumer, Editor, Player, and downstream extension validation, publish as:

```text
@blcklab/anyo@0.10.0-rc.1
```

The document version remains independent at `0.7`.
