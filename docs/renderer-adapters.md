# Renderer adapters

A renderer implements the contract from `@blcklab/anyo/renderer`. It receives `CompiledWorld` and must not own document, architectural, collision, portal, binding, history, or runtime state.

## Required lifecycle

```ts
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

Adapters without incremental methods remain compatible: Anyo safely falls back to remounting when needed.

## Capabilities

Capabilities must represent actual backend support. Anyo checks required text, image, model, light, and picking features before mounting and reports unsupported primitives with source diagnostics.

## World changes

Non-structural changes are classified into primitive transform, visibility, material, content, replacement, removal, room visibility, portal state, and collider state. Structural changes use `world-rebuild`.

## Resource ownership

Adapters must explicitly define ownership when geometry or materials are shared. Removing one node must not dispose a resource used by other nodes. A complete adapter disposal must cancel pending assets and release all owned resources exactly once.
