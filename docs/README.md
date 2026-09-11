# Anyo docs

Start with the [quick start](../README.md#quick-start-with-sekai64), then choose a guide for the part of your app you're building.

## Build a world

- [World schema](world-schema.md) — document versions, fields, and validation.
- [Buildings](buildings.md) — rooms, openings, floors, and stairs.
- [Entities](entities.md) — objects, text, models, groups, and triggers.
- [Components](components.md) — attach declarative behavior and register custom types.
- [Assets](assets.md) — declare resources, resolve URLs, and use material textures.
- [Visual settings](visual-contract.md) and [anime styling](anime-visual-style.md) — lighting, materials, and renderer capabilities.
- [Virtual stores](virtual-store.md) — connect products and inventory to the world.

## Run and edit it

- [Data and updates](data-and-updates.md) — bindings, entity updates, and document patches.
- [Plugins](plugins.md) — extend compilation and world lifecycle.
- [Runtime systems](runtime-systems.md) — schedule simulation and apply temporary transforms.
- [Exploration](exploration.md) — first-person movement and collision.
- [Player integration](player-foundation.md) — readiness, input, pause/resume, and shutdown.
- [Editor APIs](editor-contract.md) — selection, previews, clipboard, and history.
- [Web surfaces](web-surfaces.md) — registered web apps and snapshot fallbacks.

## Rendering and release checks

- [Sekai64](sekai64.md) — set up the renderer and load assets.
- [Renderer adapters](renderer-adapters.md) — implement another backend.
- [VR development](vr-development.md) and [XR adapter requirements](xr-renderer-contract.md).
- [VR release checklist](vr-production-checklist.md) — comfort, lifecycle, and device checks.
- [Production](production.md), [performance](performance.md), and [compatibility](quality/STABILITY.md).
- [Tests](../tests/README.md) and [contributing](../CONTRIBUTING.md).

## Migrations

Use the [world 0.7 migration guide](migrations/MIGRATION_WORLD_0.7.md) for the current schema. Earlier guides explain changes introduced in [0.3.1](migration-0.3.1.md), [0.4](migration-0.4.md), [0.5](migration-0.5.md), and [0.6](migration-0.6.md).

See the [changelog](../CHANGELOG.md) for package release history.
