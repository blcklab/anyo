import type { Engine, Scene } from '@blcklab/sekai64'
import {
  XRSessionManager,
  XRWebGLLayerBridge,
  type XRFrameState,
  type XRInputSnapshot as SekaiXRInputSnapshot,
  type XRMode,
} from '@blcklab/sekai64/xr'
import type {
  RendererXRBridge,
  RendererXRCapabilities,
  RendererXREnterOptions,
  RendererXREventMap,
  XRInputSnapshot,
  XRPlayerRigTransform,
  XRSessionMode,
  XRSessionState,
  XRViewerPoseSnapshot,
} from '../core/types.js'
import { Sekai64FrameDriver } from './Sekai64FrameDriver.js'

interface WebGL2XRRenderer {
  getContext(): WebGL2RenderingContext
  makeXRCompatible?(): Promise<void>
  renderViewport: XRWebGLLayerBridge['renderer']['renderViewport']
}

interface Sekai64XRBridgeOptions {
  ensureEngine(): Promise<Engine>
  getScene(): Scene | null
  setFrameState(state: XRFrameState | null): void
  frameDriver: Sekai64FrameDriver
}

function cloneTransform(value: SekaiXRInputSnapshot['targetRay']): XRInputSnapshot['targetRay'] {
  if (!value) return null
  return {
    matrix: Array.from(value.matrix),
    position: [...value.position] as [number, number, number],
    direction: [...value.direction] as [number, number, number],
  }
}

function cloneInput(value: SekaiXRInputSnapshot): XRInputSnapshot {
  return {
    id: value.id,
    handedness: value.handedness,
    targetRayMode: value.targetRayMode,
    profiles: [...value.profiles],
    targetRay: cloneTransform(value.targetRay),
    grip: cloneTransform(value.grip),
    buttons: value.buttons.map(button => ({ ...button })),
    axes: [...value.axes],
    supportsHaptics: value.supportsHaptics,
  }
}

export class Sekai64XRBridge implements RendererXRBridge {
  private manager: XRSessionManager | null = null
  private layerBridge: XRWebGLLayerBridge | null = null
  private readonly listeners = new Map<keyof RendererXREventMap, Set<(payload: never) => void>>()
  private readonly support = { inline: false, immersiveVR: false, immersiveAR: false }
  private readonly referenceSpaces = new Set<string>()
  private cleanups: Array<() => void> = []
  private disposed = false
  private backend: string | undefined

  constructor(private readonly options: Sekai64XRBridgeOptions) {}

  get state(): XRSessionState {
    return this.manager?.state ?? (this.disposed ? 'disposed' : 'idle')
  }

  get capabilities(): RendererXRCapabilities {
    const inputs = this.manager?.inputSnapshots ?? []
    return {
      supported: this.backend === 'webgl2' && Boolean(XRSessionManager.system),
      inline: this.support.inline,
      immersiveVR: this.support.immersiveVR,
      immersiveAR: this.support.immersiveAR,
      localFloor: this.referenceSpaces.has('local-floor'),
      boundedFloor: this.referenceSpaces.has('bounded-floor'),
      controllers: inputs.some(input => input.targetRayMode === 'tracked-pointer'),
      gamepads: inputs.some(input => input.buttons.length > 0 || input.axes.length > 0),
      handTracking: inputs.some(input => input.hand !== undefined),
      haptics: inputs.some(input => input.supportsHaptics),
      backend: this.backend,
      sessionMode: this.manager?.mode,
      referenceSpace: this.manager?.referenceSpaceType,
    }
  }

  async isSessionSupported(mode: XRSessionMode): Promise<boolean> {
    this.assertAlive()
    const engine = await this.options.ensureEngine()
    this.backend = engine.capabilities.backend
    if (this.backend !== 'webgl2') return false
    const supported = await XRSessionManager.isSupported(mode as XRMode)
    if (mode === 'inline') this.support.inline = supported
    else if (mode === 'immersive-vr') this.support.immersiveVR = supported
    else this.support.immersiveAR = supported
    return supported
  }

  async enter(options: RendererXREnterOptions): Promise<void> {
    this.assertAlive()
    const engine = await this.options.ensureEngine()
    this.backend = engine.capabilities.backend
    if (engine.capabilities.backend !== 'webgl2') {
      const error = new Error('Sekai64 WebXR currently requires the WebGL2 backend. Create the renderer with backend: "webgl2".')
      this.emit('error', { error })
      throw error
    }
    if (!this.options.getScene()) throw new Error('Load an Anyo world before entering XR.')
    const manager = this.ensureManager()
    const session = await manager.requestSession(options.mode as XRMode, {
      referenceSpace: options.referenceSpace,
      requiredFeatures: options.requiredFeatures,
      optionalFeatures: options.optionalFeatures,
      domOverlayRoot: options.domOverlayRoot,
    })
    if (options.mode === 'inline') this.support.inline = true
    else if (options.mode === 'immersive-vr') this.support.immersiveVR = true
    else this.support.immersiveAR = true
    if (manager.referenceSpaceType) this.referenceSpaces.add(manager.referenceSpaceType)
    const nativeRenderer = engine.renderer as unknown as WebGL2XRRenderer
    const layer = new XRWebGLLayerBridge(nativeRenderer)
    try {
      await layer.initialize(session, { antialias: true, depth: true })
      this.layerBridge?.dispose()
      this.layerBridge = layer
      this.options.frameDriver.activateXR(manager, this.options.setFrameState)
      this.emit('session-start', { mode: options.mode })
    } catch (error) {
      layer.dispose()
      await manager.end().catch(() => undefined)
      this.emit('error', { error })
      throw error
    }
  }

  async exit(): Promise<void> {
    if (!this.manager) return
    await this.manager.end()
  }

  getViewerPose(): XRViewerPoseSnapshot | null {
    const viewer = this.manager?.viewerPose
    return viewer ? {
      matrix: Array.from(viewer.matrix),
      position: [...viewer.position] as [number, number, number],
      direction: [...viewer.direction] as [number, number, number],
      timestamp: viewer.timestamp,
    } : null
  }

  getInputSources(): readonly XRInputSnapshot[] {
    return (this.manager?.inputSnapshots ?? []).map(cloneInput)
  }

  getPlayerRigTransform(): XRPlayerRigTransform {
    const value = this.manager?.playerRigTransform ?? { position: [0, 0, 0] as const, yaw: 0 }
    return { position: [...value.position] as [number, number, number], yaw: value.yaw }
  }

  setPlayerRigTransform(transform: XRPlayerRigTransform): void {
    this.ensureManager().setPlayerRigTransform(transform)
  }

  render(scene: Scene, state: XRFrameState): void {
    if (!this.layerBridge) throw new Error('The Sekai64 XR WebGL layer is not initialized.')
    this.layerBridge.render(scene, state)
  }

  on<TKey extends keyof RendererXREventMap>(event: TKey, listener: (payload: RendererXREventMap[TKey]) => void): () => void {
    let group = this.listeners.get(event)
    if (!group) {
      group = new Set()
      this.listeners.set(event, group)
    }
    group.add(listener as (payload: never) => void)
    return () => {
      group?.delete(listener as (payload: never) => void)
      if (group?.size === 0) this.listeners.delete(event)
    }
  }

  dispose(): void { void this.disposeAsync() }

  async disposeAsync(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.options.frameDriver.deactivateXR()
    this.layerBridge?.dispose()
    this.layerBridge = null
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    const manager = this.manager
    this.manager = null
    if (manager) await manager.disposeAsync()
    this.listeners.clear()
  }

  private ensureManager(): XRSessionManager {
    if (this.manager) return this.manager
    const manager = new XRSessionManager()
    this.manager = manager
    this.cleanups.push(
      manager.on('statechange', payload => this.emit('state-change', payload)),
      manager.on('inputsourceschange', payload => this.emit('input-sources-change', { inputs: payload.inputs.map(cloneInput) })),
      manager.on('trackinglost', () => this.emit('tracking-lost', undefined)),
      manager.on('trackingrestored', () => this.emit('tracking-restored', undefined)),
      manager.on('referencespacereset', () => this.emit('reference-space-reset', undefined)),
      manager.on('error', payload => this.emit('error', payload)),
      manager.on('sessionend', payload => {
        this.options.frameDriver.deactivateXR()
        this.layerBridge?.dispose()
        this.layerBridge = null
        this.options.setFrameState(null)
        this.emit('session-end', { mode: payload.mode })
      }),
    )
    return manager
  }

  private emit<TKey extends keyof RendererXREventMap>(event: TKey, payload: RendererXREventMap[TKey]): void {
    const group = this.listeners.get(event)
    if (!group) return
    for (const listener of [...group]) listener(payload as never)
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('The Sekai64 XR bridge has been disposed.')
  }
}
