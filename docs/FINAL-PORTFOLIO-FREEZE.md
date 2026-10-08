# Anyo Final Portfolio Freeze


> **Superseded geometry policy:** rc.24 was the portfolio modeling freeze candidate. The authoritative long-term geometry freeze after the universal-geometry series is rc.36; see [`GEOMETRY-LONG-TERM-FREEZE.md`](GEOMETRY-LONG-TERM-FREEZE.md).

`@blcklab/anyo@0.11.0-rc.24` is the final modeling-completeness candidate before the project moves to a world-first freeze.

## Purpose

The freeze target is not to make Anyo a replacement for Blender or to add a semantic system for every object. The target is to make the existing JSON authoring model expressive enough to build a beautiful portfolio world from generic, composable primitives while keeping imported GLB/VRM assets available for artist-heavy content.

## Final generic modeling additions

### Loft

`loft` skins compatible 2D profiles through ordered local-Z sections. Each section may change profile shape, positive XY scale, rotation, and XY offset. Caps, holes, generated UVs, surface normals/tangents, semantic regions, and existing geometry safety limits use the normal Anyo geometry pipeline.

### Variable-profile sweep

`sweep.profileStations` extends the existing curve sweep without creating a second path system. Stations at normalized path distance can morph compatible profile points and vary scale, rotation, and offset. Existing sweeps without stations keep the original fixed-profile path.

These capabilities are intentionally generic. Trees, roots, vines, furniture, railings, organic architecture, props, and similar objects remain compositions built from ordinary geometry rather than new object-specific engine systems.

## Portfolio acceptance proof

The acceptance benchmark is **BLCKLAB Celestial Grand Garden 0.1.2**:

- hero trunks use generic `loft`;
- branches and exposed roots use generic variable-profile `sweep`;
- foliage continues to use existing geometry/material/composition vocabulary;
- distant vegetation stays on cheaper repeated compositions;
- the world retains the dev.110 live Sun, Moon, stars, date/time preview, and dynamic clouds;
- the resolved World 0.9 document loads through the normal `createWorld()` resource graph with no special tree runtime.

The benchmark is proof of expressive capability, not a requirement that every world use procedural geometry for every asset.

## Freeze boundary

After this candidate is accepted, the default policy is **no new Anyo feature work for object-specific authoring needs**.

When a world needs a new object, solve it in this order:

1. existing geometry and composition;
2. existing materials, textures, runtime state, and deterministic variation;
3. imported GLB/VRM or other supported assets where artist-authored geometry is the better tool;
4. world/application design.

Reopen Anyo only if a missing capability is demonstrably generic, blocks an entire class of forms, cannot be represented cleanly through the existing vocabulary, and is worth the long-term schema/runtime maintenance cost.

## Renderer boundary

Anyo continues to describe and compile renderer-neutral geometry. Sekai64 owns realization quality on the GPU. `loft` and variable-profile sweep compile to the existing `GeometryMesh` contract and require no Sekai64 source change.

## Acceptance gates

The freeze candidate must keep all of the following green:

- complete Anyo typecheck/build/test corpus;
- package exports and stability contract;
- renderer boundary checks;
- npm package verification and size gate;
- Track F production validation;
- World 0.8 compatibility;
- World 0.9 schema/normalization/resource graph;
- Grand Garden portfolio proof through the actual runtime load path;
- WebGPU/WebGL2 visual acceptance on real hardware.

Once the final real-machine visual gate is accepted, development focus moves from engine expansion to **building worlds in JSON**.
