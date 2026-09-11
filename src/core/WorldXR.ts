import type {
  NormalizedWorldDocument,
  RendererAdapter,
  RendererXRBridge,
  RendererXREnterOptions,
  RendererXRCapabilities,
  XRInputSnapshot,
  XRPlayerRigTransform,
  XRSessionMode,
  XRSessionState,
  XRViewerPoseSnapshot,
  WorldXRControllerLike,
  WorldXRSupport,
} from './types.js'

interface WorldXRHost {
  readonly renderer: RendererAdapter
  readonly document: NormalizedWorldDocument | null
  emit<T = unknown>(event: string, payload: T): void
}

export class WorldXRController implements WorldXRControllerLike {
  private bridge: RendererXRBridge | null = null
  private cleanups: Array<() => void> = []
  private disposed = false

  constructor(private readonly world: WorldXRHost) {}

  get state(): XRSessionState {
    return this.getBridge()?.state ?? 'idle'
  }

  get inputs(): readonly XRInputSnapshot[] {
    return this.getBridge()?.getInputSources() ?? []
  }

  get viewer(): XRViewerPoseSnapshot | null {
    return this.getBridge()?.getViewerPose() ?? null
  }

  get capabilities(): RendererXRCapabilities | null {
    return this.getBridge()?.capabilities ?? null
  }

  async getSupport(): Promise<WorldXRSupport> {
    const bridge = this.requireBridge()
    const [inline, immersiveVR, immersiveAR] = await Promise.all([
      bridge.isSessionSupported('inline'),
      bridge.isSessionSupported('immersive-vr'),
      bridge.isSessionSupported('immersive-ar'),
    ])
    return { inline, immersiveVR, immersiveAR }
  }

  async isSupported(mode: XRSessionMode): Promise<boolean> {
    return this.requireBridge().isSessionSupported(mode)
  }

  async enter(options: Partial<RendererXREnterOptions> = {}): Promise<void> {
    const bridge = this.requireBridge()
    const documentOptions = this.world.document?.exploration?.xr
    const mode = options.mode ?? documentOptions?.mode ?? 'immersive-vr'
    const referenceSpace = options.referenceSpace ?? documentOptions?.referenceSpace ?? (mode === 'immersive-vr' ? 'local-floor' : 'local')
    await bridge.enter({
      mode,
      referenceSpace,
      requiredFeatures: options.requiredFeatures,
      optionalFeatures: options.optionalFeatures,
      domOverlayRoot: options.domOverlayRoot,
    })
  }

  async exit(): Promise<void> {
    const bridge = this.getBridge()
    if (bridge) await bridge.exit()
  }

  getPlayerRigTransform(): XRPlayerRigTransform {
    return this.requireBridge().getPlayerRigTransform()
  }

  setPlayerRigTransform(transform: XRPlayerRigTransform): void {
    this.requireBridge().setPlayerRigTransform(transform)
  }

  refresh(): void {
    this.bind(this.world.renderer.xr ?? null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.bind(null)
  }

  private getBridge(): RendererXRBridge | null {
    if (this.disposed) return null
    const next = this.world.renderer.xr ?? null
    if (next !== this.bridge) this.bind(next)
    return this.bridge
  }

  private requireBridge(): RendererXRBridge {
    const bridge = this.getBridge()
    if (!bridge) throw new Error('The active Anyo renderer does not provide an XR bridge.')
    return bridge
  }

  private bind(bridge: RendererXRBridge | null): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.bridge = bridge
    if (!bridge) return
    this.cleanups.push(
      bridge.on('state-change', payload => this.world.emit('xr:state-change', payload)),
      bridge.on('session-start', payload => this.world.emit('xr:session-start', payload)),
      bridge.on('session-end', payload => this.world.emit('xr:session-end', payload)),
      bridge.on('input-sources-change', payload => this.world.emit('xr:input-sources-change', payload)),
      bridge.on('tracking-lost', payload => this.world.emit('xr:tracking-lost', payload)),
      bridge.on('tracking-restored', payload => this.world.emit('xr:tracking-restored', payload)),
      bridge.on('reference-space-reset', payload => this.world.emit('xr:reference-space-reset', payload)),
      bridge.on('error', payload => this.world.emit('xr:error', payload)),
    )
  }
}
