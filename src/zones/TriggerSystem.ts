import type { ActionDefinition, CompiledTrigger, PluginRuntimeContext } from '../core/types.js'
import { containsPoint } from '../math/aabb.js'

async function runActions(
  actions: readonly ActionDefinition[],
  trigger: CompiledTrigger,
  context: PluginRuntimeContext,
): Promise<void> {
  for (const definition of actions) {
    if (definition.action) {
      await context.world.runAction(definition.action, definition.params ?? {}, trigger.entityId)
    }
    if (definition.event) {
      context.world.emit(definition.event, {
        source: trigger.entityId,
        target: definition.target,
        params: definition.params ?? {},
      })
    }
  }
}

export class TriggerSystem {
  private readonly active = new Set<string>()
  private readonly completed = new Set<string>()

  constructor(private readonly context: PluginRuntimeContext) {}

  update(): void {
    const position = this.context.renderer.camera.getPosition()
    for (const trigger of this.context.compiled.triggers) {
      if (trigger.once && this.completed.has(trigger.id)) continue
      const inside = containsPoint(trigger.bounds, position)
      const wasInside = this.active.has(trigger.id)

      if (inside && !wasInside) {
        this.active.add(trigger.id)
        void runActions(trigger.onEnter, trigger, this.context)
        this.context.world.emit('trigger:enter', { triggerId: trigger.entityId })
        if (trigger.once) this.completed.add(trigger.id)
      } else if (!inside && wasInside) {
        this.active.delete(trigger.id)
        void runActions(trigger.onLeave, trigger, this.context)
        this.context.world.emit('trigger:leave', { triggerId: trigger.entityId })
      }
    }
  }
}
