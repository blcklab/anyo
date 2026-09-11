import type { XRFrameState, XRSessionManager } from '@blcklab/sekai64/xr'
import type { RendererFrameDriver } from '../core/types.js'

export class Sekai64FrameDriver implements RendererFrameDriver {
  private callback: ((time: number) => void) | null = null
  private running = false
  private windowHandle: number | null = null
  private manager: XRSessionManager | null = null
  private frameSink: ((state: XRFrameState | null) => void) | null = null

  get mode(): 'window' | 'xr' {
    return this.manager?.state === 'active' ? 'xr' : 'window'
  }

  start(callback: (time: number) => void): void {
    this.stop()
    this.callback = callback
    this.running = true
    if (this.manager?.state === 'active') this.startXRLoop()
    else this.startWindowLoop()
  }

  stop(): void {
    this.running = false
    this.stopWindowLoop()
    this.manager?.stop()
    this.callback = null
    this.frameSink?.(null)
  }

  activateXR(manager: XRSessionManager, frameSink: (state: XRFrameState | null) => void): void {
    this.manager?.stop()
    this.manager = manager
    this.frameSink = frameSink
    this.stopWindowLoop()
    if (this.running) this.startXRLoop()
  }

  deactivateXR(): void {
    this.manager?.stop()
    this.manager = null
    this.frameSink?.(null)
    if (this.running) this.startWindowLoop()
  }

  dispose(): void {
    this.stop()
    this.manager = null
    this.frameSink = null
  }

  private startXRLoop(): void {
    if (!this.manager || !this.callback) return
    this.manager.start(state => {
      this.frameSink?.(state)
      this.callback?.(state.time)
    })
  }

  private startWindowLoop(): void {
    if (!this.running || !this.callback || this.windowHandle !== null) return
    if (typeof requestAnimationFrame === 'undefined') {
      throw new Error('Sekai64 desktop rendering requires requestAnimationFrame support.')
    }
    const frame = (time: number): void => {
      if (!this.running || this.windowHandle === null || !this.callback) return
      try {
        this.frameSink?.(null)
        this.callback(time)
      } finally {
        if (this.running && this.manager?.state !== 'active') this.windowHandle = requestAnimationFrame(frame)
      }
    }
    this.windowHandle = requestAnimationFrame(frame)
  }

  private stopWindowLoop(): void {
    if (this.windowHandle !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.windowHandle)
    this.windowHandle = null
  }
}
