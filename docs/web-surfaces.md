# Web surfaces

Web surfaces place trusted web applications or safe snapshots on ordinary Anyo entities. The document remains JSON data; executable code is registered by the host application.

```text
Anyo JSON
  → renderer-independent web-surface definition
  → optional @blcklab/anyo/web-surface runtime
  → live DOM app on desktop
  → native snapshot primitive when DOM is unavailable or XR is active
```

## Browser-native overlay presentation

Use `presentation.type: "overlay"` for the most browser-native Web Surface path. The host mounts ordinary DOM (commonly a sandboxed iframe) in a layer above the WebGL/WebGPU canvas, while Anyo projects the authored plane into screen space. The page keeps native browser layout, fonts, forms, scrolling, accessibility, links, and focus behavior.

```json
{
  "type": "web-surface",
  "size": [2.56, 1.44],
  "webSurface": {
    "source": { "type": "app", "app": "dashboard" },
    "presentation": {
      "type": "overlay",
      "resolution": [1280, 720]
    },
    "interaction": { "pointer": true, "keyboard": true, "scroll": true }
  }
}
```

When `renderMode` is omitted, `presentation.type: "overlay"` compiles to the existing `dom-overlay` runtime mode. `renderMode: "dom-overlay"` remains supported for backward compatibility. The optional `resolution` is the stable logical CSS viewport; camera distance changes only the projected transform, not responsive page layout.

Overlay presentation is intentionally **not depth-tested** against renderer geometry or VRM characters because the browser DOM layer sits above the GPU canvas. Use `presentation.type: "texture"` when the surface must behave as physical scene geometry with true occlusion. Arbitrary public sites may also reject iframe embedding through CSP or `X-Frame-Options`; the host-supplied native/remote browser-provider texture path remains the solution for those physical external-site surfaces.


## Install and import

Web surfaces ship as a tree-shakable subpath of the main package:

```ts
import { webSurfacePlugin } from '@blcklab/anyo/web-surface'
```

Normal Anyo applications do not import DOM, iframe, or registered-app runtime code.

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

## Renderer-neutral targets

`target` is optional. Existing worlds continue to use their entity transform and `size` as the ordinary plane target.

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

Supported target intent in RC.5:

```ts
type WebSurfaceTarget =
  | { type: 'plane'; size?: readonly [number, number] }
  | { type: 'wall'; room: string; wall: string; offset?: readonly [number, number] }
  | { type: 'entity-slot'; entity: string; slot: string }
  | { type: 'mesh'; entity: string; mesh?: string; materialSlot?: number; uvSet?: number }
```

A cardinal wall target (`north`, `south`, `east`, or `west`) reuses the current wall attachment math, so the existing DOM overlay and snapshot fallback already appear at that wall location. Named renderer-specific walls remain semantic intent until a renderer integration resolves them.

## Named model screen slots

A model can declare renderer-neutral screen slots with the built-in `anyo.surface-host` component:

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

During compilation these aliases become concrete entity IDs such as `store-monitor-2/body`, so duplicated prefabs remain isolated.

## Target resolution and fallback

The `@blcklab/anyo/web-surface` subpath exports:

```ts
import {
  getWebSurfaceHostSlot,
  resolveWebSurfaceTarget,
} from '@blcklab/anyo/web-surface'
```

These helpers resolve only world meaning. They do not allocate textures, inspect GPU objects, mutate materials, or depend on Sekai64.

RC.5 intentionally keeps the existing fallback path:

```text
plane target
  → current overlay or snapshot plane

wall/entity-slot/mesh target without a native presenter
  → current plane overlay when available
  → otherwise snapshot fallback
  → recoverable diagnostic
```

GPU texture upload, material-slot replacement, mesh discovery, UV hits, and XR-native live presentation belong to WS3 and the optional texture package—not Anyo core.

## Register trusted application code

```ts
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

The same registry can mount plain DOM, Vue, React, Svelte, a canvas application, or another host-controlled frontend. Anyo has no framework dependency.

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

There are two animation layers:

1. The trusted registered app uses CSS, the Web Animations API, SVG, canvas, Vue transitions, or its own animation library.
2. The optional surface runtime provides lightweight presentation presets for mount, visibility, focus, blur, and selection.

Supported presentation presets in this release candidate:

```text
fade
fade-slide-up
scale-in
pulse
```

Animations respect `prefers-reduced-motion`.

True renderer-driven 3D transform animation of the physical fallback plane is not part of this release candidate. It should use Anyo's general renderer-neutral animation system rather than a web-surface-only duplicate.

## Snapshot and XR behavior

Current behavior:

```text
Desktop/mobile browser with DOM
  → registered app or allowlisted iframe overlay

Immersive XR
  → live DOM overlay pauses and hides
  → snapshot fallback remains visible as a native Sekai64 image plane
```

Live HTML-to-texture rendering and interactive webpages inside XR are intentionally deferred. They require dirty texture updates, controller-to-page coordinate mapping, text input, focus, and stricter isolation.

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

Do not store JavaScript source in world JSON. This is intentionally unsupported:

```json
{
  "javascript": "runArbitraryCode()"
}
```

JSON may reference only a host-registered app id and JSON-safe props. The host decides which code is trusted and registered.

Recommended host controls:

- Validate user-generated worlds.
- Register only trusted applications.
- Apply a strict Content Security Policy.
- Allowlist external origins.
- Avoid secrets in app props or public JSON.
- Treat URL iframe permissions as explicit opt-ins.

## Current rendering limitations

The desktop DOM projection follows the surface center, projected width, projected height, and screen rotation. It does not yet provide perfect projective corner warping or depth occlusion behind arbitrary 3D geometry.

Use web surfaces primarily for wall-mounted panels facing the viewer. Snapshot fallbacks remain fully depth-tested because they are ordinary renderer primitives.
