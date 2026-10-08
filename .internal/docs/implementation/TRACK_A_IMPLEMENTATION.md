# Track A A1–A12 Implementation Handoff

## Summary

Track A hardens Anyo as a production-oriented JSON-first world architecture without turning it into a renderer, editor, workflow engine, physics package, or animation package. The document version is now `0.7`; package version `0.10.0-rc.1` is intentionally preserved pending downstream validation.

## A1 — Audit and architecture freeze

- Added `../architecture/TRACK_A_ARCHITECTURE_AUDIT.md`.
- Recorded the authoritative-document/runtime-projection boundary.
- Preserved zero runtime dependencies and renderer isolation.
- Added ADRs for document authority, host policy, and extension ownership.

## A2 — Production schema foundation

Added `schemas/world-0.7.schema.json`:

- JSON Schema draft 2020-12
- Stable schema ID
- Strict root fields
- Reusable definitions for cameras, channels, rendering intent, extensions, actions, assets, and prefabs
- Namespaced extension escape hatch
- Exported through `@blcklab/anyo/schema` and `@blcklab/anyo/schema/0.7`

Added `createWorldSchema()` for deterministic extension schema composition.

Compatibility note: legacy entity/material definitions remain intentionally permissive at some nested extension points. Semantic validation supplies the stronger runtime checks without breaking existing ecosystem component data.

## A3 — Declarative cameras and rendering intent

Added:

- Perspective and orthographic camera declarations
- Active-camera selection and priority fallback
- Transforms, FOV, clipping, orthographic size/bounds, metadata, parent/follow/look-at intent
- Camera transition intent
- Compiled camera records and maps
- Incremental camera update/remove/activate renderer changes
- `world.activateCamera()` and declarative `activateCamera`
- `resolveRenderingConfiguration(worldIntent, hostPolicy, runtimeCapabilities)`

The Sekai64 adapter creates and updates camera projections. Follow controllers and animated transitions remain registered runtime implementations; the adapter reports transition support honestly.

## A4 — Named channels

Added separate domains for:

- Render visibility
- Picking
- Editor organization

Names compile to efficient masks. Authored JSON preserves names and does not expose renderer-native masks. Physics collision groups remain owned by the physics extension.

## A5 — Safe events and actions

Added serializable commands:

- `invoke`
- `emit`
- `setVariable`
- `toggleVariable`
- `incrementVariable`
- `setVisibility`
- `setTransform`
- `activateCamera`
- `enableEntity`
- `disableEntity`
- `sequence`

Added `world.executeActions()` and `world.dispatchDocumentEvent()`.

No `eval`, `Function`, package execution, or JavaScript source strings are accepted. Custom behavior stays in code-side registered handlers.

## A6 — Extension manifests and capabilities

Added `ExtensionRegistry` with:

- Identifier and version registration
- Capability, component, entity, action, and asset ownership
- Namespace collision rejection
- Required/optional extension resolution
- Basic exact, caret, and tilde compatibility checks
- Supported schema-version checks
- Code-side validation and migration hooks
- Optional schema contributions
- Optional snapshot hooks

World JSON can declare requirements but cannot install or dynamically import packages.

## A7 — Stable-ID patches and revisions

Added revisioned atomic transactions targeting:

- Entity ID
- Authoring ID
- Component ID
- Material ID
- Asset ID
- Prefab ID
- Camera ID

Operations support add, replace, remove, move, and test. Existing JSON Pointer patches remain supported and normalize to the same low-level patch representation.

`world.applyTransaction()` returns structured diagnostics, affected resource IDs, renderer changes, and rebuild status. Stale revisions and failed tests reject the complete transaction without mutating the source document.

## A8 — Incremental compiler foundation

Added dependency maps for:

- Material consumers
- Asset consumers
- Prefab instances
- Camera dependents
- Variable bindings

Added compiler timing/hash reports and explicit rebuild reasons. Camera, channel, material, content, transform, visibility, room, portal, and collider changes are projected incrementally when compatible.

Current limitation: most document commits still use deterministic full normalization/compilation before the change classifier applies minimal renderer updates. This is the safe fallback architecture. A future persistent compiler cache can replace that internal stage without changing the document or adapter APIs.

## A9 — Prefab hardening

Added:

- Stable `instanceId`
- Deterministic generated authoring IDs
- JSON-Pointer override maps
- Nested references and inheritance
- Circular-reference and maximum-depth detection
- Prefab versions and provenance
- Dependency tracking
- Source serialization that preserves `use`, `instanceId`, and overrides

Prefabs are expanded only in normalized/compiled projections. Authored JSON is not flattened unless a future explicit bake tool performs that operation.

## A10 — Runtime snapshots

Added versioned snapshots and APIs:

```ts
world.serializeDocument()
world.createSnapshot()
await world.restoreSnapshot(snapshot)
await world.commitSnapshot(snapshot)
world.registerSnapshotExtension(hook)
```

Snapshots can contain variables, runtime transforms, visibility, active camera, rooms, portals, player location, and extension-owned JSON-safe state. They never overwrite authored JSON implicitly.

## A11 — Asset manifests and portable package descriptors

Assets can declare:

- Stable IDs
- Type and format
- Source
- Integrity
- Declared byte size and MIME type
- License and attribution
- Variants
- Dependencies
- Loading/preload intent

Added dependency validation/order, total declared bytes, canonical package manifests, variant resolution, and `createPortableWorldPackageDescriptor()`.

The descriptor emits deterministic `world.anyo.json` and `manifest.json` text plus the required binary-file plan. Fetching binaries, writing files, and ZIP creation remain host-controlled to keep Anyo core universal and side-effect free.

## A12 — Determinism and security

Added:

- Canonical key ordering
- Finite-number normalization and `-0` normalization
- Deterministic world strings
- Browser-safe FNV-1a 64-bit cache/revision hashes
- Deterministic snapshot serialization
- Plain JSON object enforcement
- Prototype-pollution path rejection
- Entity, hierarchy, prefab, action, asset, metadata, extension, snapshot, and diagnostic limits
- Host-provided asset URL policy
- Deterministic generated authoring identities

The document hash is intentionally not a cryptographic integrity primitive. Asset integrity uses SRI-style SHA metadata.

## Added public APIs

- `compileWorldChannels`
- `resolveChannelMask`
- `compileCameras`
- `resolveRenderingConfiguration`
- `ExtensionRegistry`
- `buildCompilerDependencyGraph`
- `applyStableTransaction`
- `applyJsonPatchValue`
- `canonicalizeJson`
- `canonicalizeWorldDocument`
- `canonicalWorldString`
- `hashWorldDocument`
- `createWorldSchema`
- `inspectArchitectureDocument`
- `inspectAssetManifest`
- `createPortableWorldPackageManifest`
- `createPortableWorldPackageDescriptor`
- `resolveAssetVariant`
- `inspectWorldRuntimeSnapshot`
- `validateWorldRuntimeSnapshot`
- `canonicalSnapshotString`

## Added World APIs

- `executeActions()`
- `dispatchDocumentEvent()`
- `activateCamera()`
- `applyTransaction()`
- `createSnapshot()`
- `restoreSnapshot()`
- `commitSnapshot()`
- `registerSnapshotExtension()`
- `serializeDocument()`
- `getDependencyGraph()`
- `getCompilerPerformanceReport()`

## Incremental versus rebuild behavior

Incremental renderer projection:

- Camera create/update/remove/activate
- Channel changes
- Rendering intent changes when adapter-supported
- Primitive transforms, visibility, material, and content
- Compatible primitive replacement/removal
- Room visibility, portal state, and collider enabled state

Full rebuild fallback:

- Environment topology/configuration changes not supported incrementally
- Collider, trigger, room, or portal topology changes
- Renderer adapters without the requested incremental method
- Unknown or unsafe dependency impact

## Known limitations

- Camera follow/look-at controllers and animated transition curves remain host/runtime implementations.
- Semver matching intentionally supports the common exact/caret/tilde subset, not the entire npm range grammar.
- Stable transactions clone the JSON document for atomic safety; very large collaborative worlds may later use persistent data structures.
- Compiler dependency graphs currently optimize impact classification and renderer projection; source normalization is still full for most commits.
- Portable package descriptors do not fetch assets or create ZIP files.
- The schema keeps controlled permissiveness for existing extension-shaped entity/material data.
- Canonical document hashes are cache identities, not signatures.

## Recommended package version

After consumer, editor, Player, and device validation: `@blcklab/anyo@0.10.0-rc.1`.
