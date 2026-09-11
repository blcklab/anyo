# Renderer adapters

Implement `RendererAdapter` from `@blcklab/anyo/renderer` to connect another rendering engine. Anyo supplies the compiled world and manages documents, collision, portals, bindings, history, and runtime state. The adapter creates and updates visual resources.

## Lifecycle at a glance

This is a summary; import `RendererAdapter` for the full TypeScript interface, including optional runtime-transform, camera, channel, asset, and XR APIs.

```text
interface RendererAdapter {
  readonly canvas: HTMLCanvasElement
  readonly camera: CameraAdapter
  readonly info?: RendererInfo

  initialize?(): void | Promise<void>
  mount(compiled, document): void | Promise<void>
  applyChanges?(changes, compiled, document): void | Promise<void>
  updatePrimitive?(primitive): void | Promise<void>
  removePrimitive?(primitiveId): void | Promise<void>
  setPrimitiveVisibility?(primitiveId, visible): void
  setRoomVisibility(roomId, visible): void
  setPortalState?(portalId, open): void
  render(deltaSeconds): void
  resize(width, height, pixelRatio?): void
  pick(clientX, clientY): PickResult | null
  getDiagnostics?(): readonly RendererDiagnostic[]
  dispose(): void
}
```

Without incremental methods, Anyo remounts when an update requires it. Add those methods when preserving resources across small changes matters.

## Capabilities

Report features supported by the active backend. Anyo checks required text, image, model, light, and picking features before mounting and points diagnostics back to the source.

## World changes

Incremental updates describe transforms, visibility, materials, content, replacement, removal, room visibility, portal state, and collider state. Changes that need a rebuild use `world-rebuild`.

## Resource ownership

Track ownership of shared geometry and materials so removing one object does not break another. On disposal, cancel pending loads and release each owned resource once. See [Sekai64 integration](sekai64.md) for a working adapter.
