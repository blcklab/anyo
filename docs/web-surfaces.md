# Web surfaces

Place a registered web app on an Anyo entity, with an image fallback for renderers or modes that cannot display live DOM. Your app registers the executable code; the world stores its ID and JSON props.

## Install and import

Import the optional runtime from the main package:

```ts
import { webSurfacePlugin } from '@blcklab/anyo/web-surface'
```

Applications that do not use this subpath do not need the DOM or iframe runtime.

## Define a surface

```json
{
  "id": "product-dashboard",
  "type": "web-surface",
  "size": [4.8, 2.8],
  "surface": {
    "room": "showroom",
    "wall": "east",
    "offset": [0, 0.7]
  },
  "webSurface": {
    "title": "Product dashboard",
    "source": {
      "type": "app",
      "app": "product-dashboard",
      "props": {
        "sku": "ANYO-001",
        "inventory": { "$bind": "store.inventory" }
      }
    },
    "fallback": {
      "type": "snapshot",
      "image": "/products/anyo-001.webp",
      "alt": "Product dashboard fallback"
    },
    "animations": [
      {
        "trigger": "mount",
        "preset": "fade-slide-up",
        "duration": 420
      }
    ]
  }
}
```

The fallback is compiled as a normal image primitive, so renderers and immersive XR do not require DOM support.

## Choose a target

Without `target`, the surface uses its entity transform and size as a plane.

```json
{
  "id": "dashboard",
  "type": "web-surface",
  "size": [4, 2],
  "webSurface": {
    "source": { "type": "app", "app": "dashboard" },
    "target": { "type": "plane", "size": [4, 2] }
  }
}
```

The target types are:

```ts
type WebSurfaceTarget =
  | { type: 'plane'; size?: readonly [number, number] }
  | { type: 'wall'; room: string; wall: string; offset?: readonly [number, number] }
  | { type: 'entity-slot'; entity: string; slot: string }
  | { type: 'mesh'; entity: string; mesh?: string; materialSlot?: number; uvSet?: number }
```

Cardinal walls (`north`, `south`, `east`, `west`) use Anyo's wall attachment placement. Custom wall names need an integration that can resolve them.

## Named model screen slots

Give a model named screen slots with `anyo.surface-host`:

```json
{
  "id": "monitor-body",
  "type": "model",
  "asset": "monitor",
  "components": [
    {
      "type": "anyo.surface-host",
      "slots": {
        "screen": {
          "mesh": "DisplayPanel",
          "materialSlot": 1,
          "uvSet": 0
        }
      }
    }
  ]
}
```

A Web Surface can then reference the slot:

```json
{
  "id": "monitor-screen",
  "type": "web-surface",
  "webSurface": {
    "source": { "type": "app", "app": "inventory" },
    "target": {
      "type": "entity-slot",
      "entity": "monitor-body",
      "slot": "screen"
    },
    "fallback": { "type": "snapshot", "image": "/inventory.webp" }
  }
}
```

For reusable prefabs, local references avoid hard-coded global IDs:

```text
$self          current Web Surface entity
$parent        direct parent entity
$self/child    child under the current entity
$parent/body   sibling/descendant under the parent prefab instance
```

Compilation replaces these aliases with IDs such as `store-monitor-2/body`, keeping references inside the correct prefab instance.

## Target resolution and fallback

The `@blcklab/anyo/web-surface` subpath exports:

```ts
import {
  getWebSurfaceHostSlot,
  resolveWebSurfaceTarget,
} from '@blcklab/anyo/web-surface'
```

These helpers resolve entity and slot references. A renderer integration handles textures, mesh lookup, and material changes.

When no native presenter is available, the runtime uses this fallback path:

```text
plane target
  → current overlay or snapshot plane

wall/entity-slot/mesh target without a native presenter
  → current plane overlay when available
  → otherwise snapshot fallback
  → recoverable diagnostic
```

Texture upload, material-slot replacement, UV picking, and live XR presentation require an optional presenter integration.

## Register trusted application code

```ts
import { createWorld, explorableBuildingPreset } from '@blcklab/anyo'
import { webSurfacePlugin } from '@blcklab/anyo/web-surface'

const webSurfaces = webSurfacePlugin()

webSurfaces.registry.register('product-dashboard', {
  mount(container, props, context) {
    const button = document.createElement('button')
    button.textContent = `Open ${props.sku}`

    button.addEventListener('click', () => {
      void context.runAction('open-product', {
        sku: props.sku,
      })
    })

    container.append(button)

    return {
      update(nextProps) {
        button.textContent = `Open ${nextProps.sku}`
      },
      pause() {},
      resume() {},
      dispose() {
        button.remove()
      },
    }
  },
})

const world = createWorld({
  renderer,
  plugins: [
    ...explorableBuildingPreset(),
    webSurfaces,
  ],
})
```

The registry works with plain DOM, Vue, React, Svelte, or a canvas app. Use your framework's mount and cleanup methods inside the registered lifecycle.

## Lifecycle

A registered app may implement:

```ts
interface WebSurfaceAppInstance {
  update?(props: Readonly<Record<string, unknown>>): void | Promise<void>
  setActive?(active: boolean): void
  pause?(): void
  resume?(): void
  dispose(): void
}
```

Anyo resolves `$bind` values inside app props. A data change calls `update()` incrementally without remounting the world.

Apps pause when their surface is hidden, behind the camera, too small to display, or when an immersive XR session becomes active. They resume when the live DOM presentation becomes visible again.

## Animation

Animate the app's contents with its own CSS, canvas, framework, or animation library. The surface runtime also provides presets for mount, visibility, focus, blur, and selection:

```text
fade
fade-slide-up
scale-in
pulse
```

Animations respect `prefers-reduced-motion`.

To move the physical surface through the 3D world, use [runtime transform layers](runtime-systems.md). Presentation presets animate the overlay.

## Snapshot and XR behavior

Current behavior:

```text
Desktop/mobile browser with DOM
  → registered app or allowlisted iframe overlay

Immersive XR
  → live DOM overlay pauses and hides
  → snapshot fallback remains visible as a native Sekai64 image plane
```

The built-in DOM runtime does not provide interactive webpages in XR. A live texture integration must also handle page coordinates, focus, text input, and isolation.

## External URLs

External iframes are disabled by default. Enable them only with an exact origin allowlist:

```ts
webSurfacePlugin({
  externalUrls: {
    allowedOrigins: ['https://docs.example.com'],
    sandbox: ['allow-scripts', 'allow-forms'],
    referrerPolicy: 'no-referrer',
  },
})
```

The runtime rejects a sandbox that combines `allow-scripts` and `allow-same-origin`.

Remote sites may still refuse embedding through CSP `frame-ancestors` or `X-Frame-Options`. Always provide a snapshot or ordinary action fallback.

## Security

Register trusted app code in the host and pass only JSON-safe props. Validate user-generated worlds, set a Content Security Policy and allowed origins, and keep secrets out of props or public JSON. See [security](../SECURITY.md).

## Current rendering limitations

Desktop overlays track the surface center, projected size, and screen rotation. They do not fully warp all four corners or become occluded behind arbitrary 3D geometry.

Panels facing the viewer work best. Snapshot fallbacks use normal renderer depth testing.
