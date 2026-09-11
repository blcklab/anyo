# @blcklab/anyo

Anyo runs interactive 3D worlds from JSON. It handles world data, validation, buildings, entities, updates, and runtime behavior. Renderer adapters draw the result, so the same world can run with Sekai64, Three.js, or a headless backend.

> `0.10.0-rc.1` is a release candidate. Install it explicitly or through the `next` npm dist-tag.

## Installation

```bash
npm install @blcklab/anyo@next
```

For rendering with Sekai64, install the version tested by this checkout:

```bash
npm install @blcklab/sekai64@0.8.0-rc.33
```

## Quick start with Sekai64

```html
<canvas id="world"></canvas>
```

```ts
import { createWorld, explorableBuildingPreset } from '@blcklab/anyo'
import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'

const canvas = document.querySelector<HTMLCanvasElement>('#world')!

const renderer = new Sekai64Renderer({
  canvas,
  backend: 'auto',
  antialias: true,
  pixelRatio: Math.min(devicePixelRatio, 2),
})

const world = createWorld({
  renderer,
  plugins: explorableBuildingPreset(),
})

await world.load('/world.json')
await world.whenReady()
world.start()

// Later, when leaving the page or replacing the player:
// await world.disposeAsync()
```

## What you can build with it

- Define rooms, stairs, objects, prefabs, materials, and interactions in JSON.
- Update content through bindings, patches, transactions, and undo/redo.
- Walk through a world with collision and optional WebXR controls.
- Run animation or simulation through systems and temporary transform layers.
- Build editors and web panels with optional editor and web-surface APIs.
- Track loading, pause and resume a player, and await cleanup when replacing it.

## Package entry points

Common subpaths include:

```text
@blcklab/anyo
@blcklab/anyo/core
@blcklab/anyo/document
@blcklab/anyo/entities
@blcklab/anyo/components
@blcklab/anyo/assets
@blcklab/anyo/systems
@blcklab/anyo/explore
@blcklab/anyo/explore-xr
@blcklab/anyo/editor
@blcklab/anyo/renderer-sekai64
@blcklab/anyo/web-surface
```

Only import the capabilities your application uses.

## World documents

The current world-document version is `0.7`, separate from the npm package version. Earlier supported documents migrate through the public migration APIs. See [World schema](docs/world-schema.md) and the [migration guides](docs/README.md#migrations).

## Renderer ownership

Anyo manages world state and behavior. The renderer manages visual resources, drawing, cameras, lights, and picking. Keep viewer UI and application-specific workflows in the app that uses Anyo.

## Documentation

See the [documentation index](docs/README.md) for user guides, renderer integration, production guidance, performance, migrations, and the world schema.

## Development

Run `npm ci`, then `npm run check` before pushing or publishing. Use `npm test` for the build and test suite. See [contributing](CONTRIBUTING.md) and [test commands](tests/README.md).

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and security guidance.

## License

MIT
