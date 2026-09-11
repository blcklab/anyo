import type { CompiledPrimitive, PluginRuntimeContext } from '../core/types.js'
import { vec3 } from '../math/vec3.js'

interface PrimitiveSnapshot {
  kind: CompiledPrimitive['kind']
  src?: string
  visible: boolean
}

export class LodSystem {
  private readonly snapshots = new Map<string, PrimitiveSnapshot>()
  private readonly selectedLevels = new Map<string, number>()

  constructor(private readonly context: PluginRuntimeContext) {
    for (const primitive of context.compiled.primitives) {
      if (!primitive.lod?.length) continue
      this.snapshots.set(primitive.id, {
        kind: primitive.kind,
        src: primitive.src,
        visible: primitive.visible,
      })
    }
  }

  update(): void {
    const camera = this.context.renderer.camera.getPosition()
    for (const primitive of this.context.compiled.primitives) {
      if (!primitive.lod?.length) continue
      const distance = vec3.distance(camera, primitive.transform.position)
      const levels = [...primitive.lod].sort((a, b) => a.distance - b.distance)
      let selected = -1
      for (let index = 0; index < levels.length; index += 1) {
        const level = levels[index]
        if (level && distance >= level.distance) selected = index
      }
      if (this.selectedLevels.get(primitive.id) === selected) continue
      this.selectedLevels.set(primitive.id, selected)

      const snapshot = this.snapshots.get(primitive.id)
      const level = selected >= 0 ? levels[selected] : undefined
      if (!snapshot) continue
      primitive.kind = level?.type === 'box' ? 'box' : level?.type === 'hidden' ? snapshot.kind : snapshot.kind
      primitive.src = level?.src ?? snapshot.src
      primitive.visible = level?.type === 'hidden' ? false : (level?.visible ?? snapshot.visible)
      if (this.context.renderer.updatePrimitive) void this.context.renderer.updatePrimitive(primitive)
    }
  }
}
