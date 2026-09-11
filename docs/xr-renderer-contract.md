# XR adapter requirements

Implement `RendererXRBridge` to add XR to an adapter, and `RendererFrameDriver` to manage its frame loop. Native WebXR and rendering-engine types stay inside the adapter.

## Frame driver

```ts
interface RendererFrameDriver {
  readonly mode: 'window' | 'xr'
  start(callback: (time: number) => void): void
  stop(): void
}
```

`World.start()` selects `renderer.frameDriver` when provided and otherwise uses Anyo's window frame driver. A renderer that enters XR must transfer its existing callback to the XR session frame loop and restore desktop RAF after the session ends.

## XR bridge

The following summary omits detailed event types; use the exported interface when implementing an adapter.

```text
interface RendererXRBridge {
  readonly state: XRSessionState
  readonly capabilities: RendererXRCapabilities

  isSessionSupported(mode: XRSessionMode): Promise<boolean>
  enter(options: RendererXREnterOptions): Promise<void>
  exit(): Promise<void>

  getViewerPose(): XRViewerPoseSnapshot | null
  getInputSources(): readonly XRInputSnapshot[]

  getPlayerRigTransform(): XRPlayerRigTransform
  setPlayerRigTransform(transform: XRPlayerRigTransform): void

  on(event, listener): () => void
}
```

Return snapshots Anyo can read without knowing your rendering engine. Keep native `XRSession`, `XRFrame`, `XRInputSource`, GPU handles, and renderer nodes private.

## Session lifecycle

- Session entry is atomic.
- Failed reference-space or layer initialization rolls back the partial session.
- Duplicate session and frame-loop entry is rejected or made idempotent.
- Browser-initiated session end restores desktop rendering.
- Tracking loss does not destroy the world.
- Repeated enter/exit cycles do not remount the compiled world.
- Renderer disposal releases the XR layer, frame driver, listeners, and session resources.

## Ray picking

Implement the optional `pickRay()` method for controller rays. For example:

```ts
renderer.pickRay?.(origin, direction, {
  near: 0.02,
  far: 10,
  precision: 'triangles',
})
```

The result may include `primitiveId`, `entityId`, `instanceId`, hit `point`, hit `normal`, and `distance`. Instanced renderers must preserve the compiler identity of the selected instance.

## Capability reporting

Derive capabilities from the browser, backend, active session, reference space, and connected inputs. Report bounded floors, controllers, hands, or haptics only when available.
