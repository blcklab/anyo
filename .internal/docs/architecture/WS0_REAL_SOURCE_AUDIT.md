# WS0 — Real Source Audit

Date: 2026-07-27

Audited baselines:

```txt
@blcklab/anyo@0.9.0-rc.3
@blcklab/sekai64@0.7.0-rc.5
```

## Scope and result

The complete attached Anyo and Sekai64 source trees were inspected before the WS1 implementation. The hidden-room DOM-surface defect was reproduced from the runtime flow and confirmed to be an Anyo Web Surface overlay defect, not a Sekai64 room-visibility defect.

Sekai64 requires no source modification for WS1.

## Exact Anyo files involved

### Public contract and registration

- `src/core/types.ts`
  - document and compiled Web Surface definitions
  - renderer-neutral primitive, room, camera, plugin, and XR contracts
- `src/web-surface/index.ts`
  - public exports for plugin, registry, runtime, projection, options, diagnostics, and app lifecycle types
- `src/web-surface/registry.ts`
  - trusted host registration
  - `mount(container, props, context)`
  - optional `update`, `setActive`, `pause`, and `resume`
  - required `dispose`
- `src/web-surface/plugin.ts`
  - one world-plugin runtime
  - setup/sync, per-world update, incremental applyChanges, and disposal

### Validation and compilation

- `src/schema/validate.ts`
  - Web Surface document validation
- `src/schema/semantic.ts`
  - registered-app semantic validation
- `src/entities/compileEntities.ts`
  - compiles `web-surface` entities into renderer-neutral plane/image primitives and Web Surface metadata
- `src/core/compile.ts`
  - builds `compiled.roomById`, which is the authoritative room visibility lookup used by WS1

### Runtime, visibility, and projection

- `src/web-surface/WebSurfaceRuntime.ts`
  - DOM root ownership
  - app/iframe/external-link mounting
  - props updates and remounts
  - active/pause/resume/dispose lifecycle
  - XR overlay hiding
  - camera projection and layout application
- `src/web-surface/projection.ts`
  - projects center, horizontal, and vertical points into a screen rectangle
- `src/visibility/PortalVisibilitySystem.ts`
  - computes reachable rooms and calls `world.setRoomVisibility`
- `src/core/World.ts`
  - mutates `CompiledRoomChunk.visible`
  - forwards room visibility to the renderer
- `src/renderer-three/ThreeRenderer.ts`
  - hides the matching renderer room group
- `src/renderer-sekai64/Sekai64Renderer.ts`
  - hides the matching Sekai64 room group
- `src/core/WorldXR.ts`
  - owns immersive XR state used by Web Surface overlay suppression

### Tests

- `tests/web-surface.test.mjs`
- `tests/verified-bugs.test.mjs`
- existing world, visibility, renderer, XR, lifecycle, security, and incremental suites

## Current public API map

```ts
webSurfacePlugin(options?)
createWebSurfaceAppRegistry()
new WebSurfaceAppRegistry()
new WebSurfaceRuntime(options)
projectWebSurface(camera, primitive, minimumPixels?)
```

Registered application contract:

```ts
interface RegisteredWebSurfaceApp {
  mount(
    container: HTMLElement,
    props: Readonly<Record<string, unknown>>,
    context: WebSurfaceAppContext,
  ): WebSurfaceAppInstance | (() => void) | void | Promise<...>
}

interface WebSurfaceAppInstance {
  update?(props): void | Promise<void>
  setActive?(active: boolean): void
  pause?(): void
  resume?(): void
  dispose(): void
}
```

The contract is already additive-friendly and did not need a breaking change.

## Current visibility flow before WS1

```txt
PortalVisibilitySystem.update()
→ calculate reachable rooms
→ world.setRoomVisibility(roomId, visible)
→ compiled.roomById[roomId].visible = visible
→ renderer.setRoomVisibility(roomId, visible)
→ Three/Sekai64 renderer room group is hidden
```

The independent DOM-overlay flow was:

```txt
WebSurfaceRuntime.update()
→ project every mounted surface
→ visible = !xrActive && primitive.visible && projection.visible
→ show/hide DOM element
```

The DOM path did not read `primitive.roomId` or `compiled.roomById.get(roomId).visible`.

## Confirmed root cause

Renderer room groups correctly respected room/portal visibility, but `WebSurfaceRuntime.update()` evaluated only:

```txt
immersive XR state
+ primitive.visible
+ projection.visible
```

Because a DOM overlay is outside the renderer scene graph, hiding the renderer room group could not hide its corresponding DOM node. The live app therefore remained visible and interactive even while its room was unreachable.

## Additional confirmed hardening gaps

- Projection was performed for every mounted surface even when its room was hidden.
- Non-finite projections and camera projection exceptions did not fail closed.
- Projection visibility omitted the top and bottom sample visibility flags.
- Snapshot-only, denied URL, unregistered app, or failed content paths could retain a mounted overlay with pointer behavior despite having no live presentation.
- Content remount replaced the abort controller without reinstalling animation listeners.
- Active disposal did not explicitly deactivate before disposal.
- Repeated layout values were written every update.

## Lifecycle flow before WS1

```txt
sync new primitive
→ create DOM wrapper
→ mount trusted app / iframe / link
→ plugin update projects and toggles active state
→ source change remounts content
→ primitive removal aborts and disposes
→ plugin disposal removes all surfaces and owned root
```

There was already one plugin scheduler driven by the world update. No per-surface `requestAnimationFrame` loop existed, so WS1 preserves this architecture.

## Projection flow before WS1

```txt
primitive local center/left/right/top/bottom
→ optional world matrix transform
→ camera.projectWorldPoint for each point
→ width/height/angle/depth
→ center + left + right visibility and minimum size
→ DOM transform
```

## Sekai64 audit result

The attached RC.5 source already provides the behavior WS1 needs:

- Anyo adapter room groups are hidden through `Node.setVisible`.
- WebGL2 and WebGPU renderers consume scene-node visibility.
- camera projection is exposed through the Anyo adapter.
- texture, UV, material, picking, XR, and explicit disposal primitives exist for later roadmap proofs.

Those later primitives are not used or expanded in WS1. No Sekai64 file was changed.

## Compatibility risks identified

- Calling lifecycle hooks more than once during one visibility transition.
- Accidentally activating a source that has only a snapshot fallback.
- Breaking custom roots or SSR imports through unconditional DOM access.
- Changing current registered-app or renderer interfaces.
- Capturing blocked/cross-origin iframe content or weakening sandbox security.
- Making room lookup failure throw during a frame.
- Excessive layout churn when projected dimensions fluctuate by fractions of a pixel.

## Focused WS1 plan executed

1. Calculate effective visibility before projection.
2. Read room visibility from the compiled room map; preserve roomless behavior.
3. Fail closed on unresolved rooms, invalid projection, missing live content, and immersive XR.
4. Centralize idempotent activation, input state, focus release, pause/resume, and disposal.
5. Harden iframe fallback and listener cleanup without bypassing browser security.
6. Deduplicate rounded layout writes and use a size-container content wrapper.
7. Add focused tests and run the entire existing suite.
