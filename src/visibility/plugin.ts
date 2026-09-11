import type { WorldPlugin } from '../core/types.js'
import { PortalVisibilitySystem, type PortalVisibilityOptions } from './PortalVisibilitySystem.js'

export function visibilityPlugin(options: PortalVisibilityOptions = {}): WorldPlugin {
  let system: PortalVisibilitySystem | null = null
  return {
    name: 'anyo:visibility',
    setup(context) {
      system = new PortalVisibilitySystem(context, options)
      system.update()
    },
    update() {
      system?.update()
    },
    applyChanges(changes, context) {
      if (changes.some((change) => change.type === 'portal-state')) system?.recalculate(context.world.getCurrentRoom())
    },
    dispose() {
      system = null
    },
  }
}
