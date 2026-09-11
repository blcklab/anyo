import type { CompiledPrimitive, PluginRuntimeContext } from '../core/types.js'
import { vec3 } from '../math/vec3.js'

interface AudioState {
  element: HTMLAudioElement | null
  active: boolean
}

export class AudioZoneSystem {
  private readonly states = new Map<string, AudioState>()

  constructor(private readonly context: PluginRuntimeContext) {
    for (const primitive of context.compiled.primitives) {
      if (primitive.kind === 'audio' && primitive.audio) {
        this.states.set(primitive.id, { element: this.createAudio(primitive), active: false })
      }
    }
  }

  update(): void {
    const camera = this.context.renderer.camera.getPosition()
    for (const primitive of this.context.compiled.primitives) {
      if (primitive.kind !== 'audio' || !primitive.audio) continue
      const state = this.states.get(primitive.id)
      if (!state) continue
      const radius = primitive.audio.radius ?? 8
      const distance = vec3.distance(camera, primitive.transform.position)
      const inside = distance <= radius
      const attenuation = Math.max(0, 1 - distance / radius)

      if (state.element) state.element.volume = Math.min(1, Math.max(0, (primitive.audio.volume ?? 1) * attenuation))
      if (inside && !state.active) {
        state.active = true
        this.context.world.emit('audio:enter', { entityId: primitive.entityId, src: primitive.audio.src })
        if (primitive.audio.autoplay && state.element) {
          void state.element.play().catch(() => {
            this.context.world.emit('audio:blocked', { entityId: primitive.entityId })
          })
        }
      } else if (!inside && state.active) {
        state.active = false
        this.context.world.emit('audio:leave', { entityId: primitive.entityId, src: primitive.audio.src })
        if (state.element && !primitive.audio.loop) state.element.pause()
      }
    }
  }

  dispose(): void {
    for (const state of this.states.values()) {
      state.element?.pause()
      if (state.element) state.element.src = ''
    }
    this.states.clear()
  }

  private createAudio(primitive: CompiledPrimitive): HTMLAudioElement | null {
    if (typeof Audio === 'undefined' || !primitive.audio) return null
    const element = new Audio(primitive.audio.src)
    element.loop = primitive.audio.loop ?? false
    element.preload = 'metadata'
    return element
  }
}
