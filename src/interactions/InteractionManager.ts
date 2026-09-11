import type { CompiledPrimitive, PluginRuntimeContext } from '../core/types.js'
import { vec3 } from '../math/vec3.js'

export interface InteractionOptions {
  defaultDistance?: number
  hover?: boolean
}

export class InteractionManager {
  private hovered: CompiledPrimitive | null = null
  private disposed = false

  constructor(
    private readonly context: PluginRuntimeContext,
    private readonly options: InteractionOptions = {},
  ) {
    this.context.renderer.canvas.addEventListener('click', this.onClick)
    if (options.hover ?? true) this.context.renderer.canvas.addEventListener('pointermove', this.onPointerMove)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.context.renderer.canvas.removeEventListener('click', this.onClick)
    this.context.renderer.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.context.renderer.canvas.style.cursor = ''
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.context.world.xr.state === 'active') return
    const result = this.pickResult(event)
    if (!result) return
    void this.context.world.selectPrimitive({ ...result, source: 'mouse' })
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.context.world.xr.state === 'active') return
    if (document.pointerLockElement === this.context.renderer.canvas) return
    const primitive = this.pick(event)
    if (primitive === this.hovered) return

    if (this.hovered) {
      this.context.world.emit('entity:hover-leave', { entityId: this.hovered.entityId })
    }
    this.hovered = primitive?.interaction ? primitive : null
    if (this.hovered) {
      this.context.world.emit('entity:hover', { entityId: this.hovered.entityId, data: this.hovered.data })
      this.context.renderer.canvas.style.cursor = this.hovered.interaction?.cursor ?? 'pointer'
    } else {
      this.context.renderer.canvas.style.cursor = ''
    }
  }

  private pick(event: MouseEvent | PointerEvent): CompiledPrimitive | null {
    const result = this.pickResult(event)
    return result ? this.context.compiled.primitiveById.get(result.primitiveId) ?? null : null
  }

  private pickResult(event: MouseEvent | PointerEvent): ReturnType<PluginRuntimeContext['renderer']['pick']> {
    const canvas = this.context.renderer.canvas
    const rect = canvas.getBoundingClientRect()
    const x = document.pointerLockElement === canvas ? rect.left + rect.width / 2 : event.clientX
    const y = document.pointerLockElement === canvas ? rect.top + rect.height / 2 : event.clientY
    const result = this.context.renderer.pick(x, y)
    if (!result) return null
    const primitive = this.context.compiled.primitiveById.get(result.primitiveId) ?? null
    if (!primitive?.interaction) return result

    const maxDistance = primitive.interaction.distance ?? this.options.defaultDistance ?? 5
    const distance = result.distance ?? vec3.distance(this.context.renderer.camera.getPosition(), primitive.transform.position)
    return distance <= maxDistance ? { ...result, distance } : null
  }
}
