# XR renderer contract

Anyo core never imports WebXR or Sekai64 types. Renderers opt into XR through `RendererXRBridge` and may opt into frame ownership through `RendererFrameDriver`.

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

```ts
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

Only serializable renderer-neutral snapshots cross the boundary. Native `XRSession`, `XRFrame`, `XRInputSource`, GPU handles, and Sekai64 nodes remain private to the adapter.

## Required lifecycle behavior

- Session entry is atomic.
- Failed reference-space or layer initialization rolls back the partial session.
- Duplicate session and frame-loop entry is rejected or made idempotent.
- Browser-initiated session end restores desktop rendering.
- Tracking loss does not destroy the world.
- Repeated enter/exit cycles do not remount the compiled world.
- Renderer disposal releases the XR layer, frame driver, listeners, and session resources.

## Ray picking

VR controllers call the optional renderer method:

```ts
pickRay(origin, direction, {
  near: 0.02,
  far: 10,
  precision: 'triangles',
})
```

The result may include `primitiveId`, `entityId`, `instanceId`, hit `point`, hit `normal`, and `distance`. Instanced renderers must preserve the compiler identity of the selected instance.

## Capability reporting

XR capability booleans must come from the actual browser, backend, session, reference space, and connected input sources. Renderers must not hardcode support for bounded floors, controllers, hands, or haptics.
