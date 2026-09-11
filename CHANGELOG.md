# Unreleased — Track F production validation

## 0.10.0-rc.1

- Promoted the JSON-first world 0.7 architecture to a new immutable release identity for Atlas adoption.
- Added the narrow `@blcklab/anyo/validation` export for runtime validation without loading the root barrel.


- Added deterministic 10,000-entity production fixtures covering schema validation, normalization, dependency tracking, stable-ID transactions, assets, prefabs, cameras, channels, rendering intent, and security limits.
- Added Track F source, behavior, benchmark, and cross-platform CI gates.
- Added production-validation documentation and evidence boundaries separating CPU/document automation from browser, GPU, mobile, thermal, XR, and physical-device claims.

# Unreleased — Track A JSON-First Architecture

- Added Anyo world document `0.7` with draft 2020-12 schema exports and migrations from 0.2–0.6.
- Added declarative named cameras, active-camera selection, named render/picking/editor channels, and renderer-intent resolution.
- Added safe structured events/actions without executable JavaScript source.
- Added extension manifests, capability/version resolution, schema contributions, validation/migration hooks, and snapshot hooks.
- Added revisioned stable-ID patch transactions with atomic rollback and structured results.
- Hardened stable-ID add operations so new camera, asset, material, and prefab records can create their missing root collection atomically with correct inverse patches.
- Added compiler dependency graphs, incremental camera/channel/material projection, performance reports, and rebuild reasons.
- Hardened prefabs with inheritance, stable instance identity, overrides, provenance, versions, and cycle detection.
- Added explicit versioned runtime snapshots and extension-owned snapshot state.
- Added asset dependency manifests, integrity/variant metadata, and deterministic portable-package descriptors.
- Added canonical serialization, deterministic document hashes, plain-JSON enforcement, host URL policy hooks, and bounded validation limits.
- Preserved zero runtime dependencies and kept physics, animation, audio, avatar, VFX, hologram, DOM, GPU, and editor implementations outside Anyo core.

## 0.10.0-rc.1

- Added renderer-neutral camera projection control and true Sekai64 orthographic camera switching for inspection and map views.
- Preserved camera pose, resize behavior, projection-aware picking, and world-point projection across camera changes.

## 0.9.1-rc.16

- Added explicit reusable `teardown()` lifecycle hooks for world plugins and systems.
- Reserved `dispose()` for final World disposal while preserving legacy dispose-only plugins.
- Fixed failed world replacement rollback when a plugin permanently disposed itself during a rebuild.

# Changelog

## 0.9.1-rc.15

- Make `cloneWorldDocument()` resilient to framework reactive proxies by falling back to a plain JSON-contract clone when `structuredClone()` rejects a Proxy.
- Prevent portal entry and source-document capture failures when a `World` instance is observed through Vue or another reactive framework.
- Add a regression test covering browser-compatible Proxy clone behavior.

## 0.9.1-rc.14

- Fixed live DOM Web Surface ownership so the renderer snapshot/plane is hidden only while the live surface is visible, eliminating duplicate striped rendering and mirrored fallback text.
- Restores the renderer fallback automatically for XR, hidden/off-screen surfaces, failed presentation, disposal, and ordinary runtime handoff.
- Preserves optional presenter handoff through `shouldPresent` without forcing the fallback visible over a texture-backed owner.
- Normalized projected DOM orientation into a readable half-turn range so wall-mounted interfaces do not rotate text by 180 degrees when the projected basis reverses.
- Added regression coverage for fallback suppression, XR restoration, disposal restoration, and readable orientation.

## 0.9.1-rc.13

- Added a renderer-neutral visual contract with fixed sRGB and linear texture-channel semantics.
- Added normalized material defaults for PBR, emissive intensity, normal scale, occlusion strength, transparency, and shadow participation.
- Added normalized world environment controls for hemisphere lighting, color management, exposure, shadows, and image quality.
- Expanded portable point-light controls with range, decay, and shadow intent.
- Added diagnostics for destructive light values, transparent opaque-shadow requests, missing environment assets, and unsupported renderer features.
- Hardened the Sekai64 adapter so world visual settings and material channels reach both WebGL2 and WebGPU consistently while runtime overrides remain possible.
- Added visual-contract and adapter parity regression coverage without expanding the building language.

## 0.9.1-rc.12

- Integrated the Sekai64 S1–S7 visual pipeline configuration through the optional renderer adapter.
- Forwarded independent roughness and metalness textures instead of only caching them.
- Added portable glass material controls: transmission, IOR, thickness, attenuation color, and attenuation distance.
- Window primitives now receive a lightweight transmission default when authors do not explicitly configure glass.
- Renderer capability reporting now advertises independent roughness, metalness, and packed metallic-roughness channels.
- Added opt-in shared beveled geometry for authored box entities while preserving exact building walls and slabs.

## 0.9.1-rc.11

- Added trusted Sekai64 native-node registration with stable Anyo primitive/entity picking identity.
- Optional renderer integrations can now expose native geometry to Editor selection without adding renderer-specific primitives to portable world JSON.
- External nodes remain owned and disposed by their optional package; registration is lifecycle-safe and additive to the concrete Sekai64 adapter only.

## 0.9.1-rc.10

- Added renderer-neutral `anyo.map` and `anyo.mapFeature` contracts for geographic world cells and editable map features.
- Added strict latitude, longitude, cell, footprint, layer, and height validation.
