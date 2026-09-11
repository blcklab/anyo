import type { WorldPlugin } from '../core/types.js'
import { FirstPersonController, type FirstPersonControllerOptions } from './FirstPersonController.js'

export function explorePlugin(options: FirstPersonControllerOptions = {}): WorldPlugin {
  let controller: FirstPersonController | null = null
  let unbind: (() => void) | null = null

  return {
    name: 'anyo:explore',
    setup(context) {
      controller = new FirstPersonController(context, options)
      unbind = context.world.exploration.bind(controller)
    },
    update(deltaSeconds) {
      controller?.update(deltaSeconds)
    },
    applyChanges(changes, context) {
      if (changes.some((change) => change.type === 'collider-state')) controller?.setColliders(context.compiled.colliders)
    },
    dispose() {
      unbind?.()
      unbind = null
      controller?.dispose()
      controller = null
    },
  }
}
