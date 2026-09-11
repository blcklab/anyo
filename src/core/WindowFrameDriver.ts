import type { RendererFrameDriver } from './types.js'

export class WindowFrameDriver implements RendererFrameDriver {
  readonly mode = 'window' as const
  private handle: number | null = null
  private callback: ((time: number) => void) | null = null

  start(callback: (time: number) => void): void {
    if (typeof requestAnimationFrame === 'undefined') {
      throw new Error('Starting an Anyo render loop requires requestAnimationFrame support.')
    }
    this.stop()
    this.callback = callback
    const frame = (time: number): void => {
      if (this.handle === null || !this.callback) return
      try {
        this.callback(time)
      } finally {
        if (this.handle !== null) this.handle = requestAnimationFrame(frame)
      }
    }
    this.handle = requestAnimationFrame(frame)
  }

  stop(): void {
    if (this.handle !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.handle)
    this.handle = null
    this.callback = null
  }
}
