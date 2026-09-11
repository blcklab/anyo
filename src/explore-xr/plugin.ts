import type { WorldPlugin } from '../core/types.js'
import { XRExplorationController } from './XRExplorationController.js'
import type { XRExplorationPluginOptions } from './types.js'

export function xrExplorationPlugin(options: XRExplorationPluginOptions = {}): WorldPlugin {
  let controller: XRExplorationController | null = null
  return {
    name: 'anyo:explore-xr',
    setup(context) {
      controller = new XRExplorationController(context, options)
    },
    update(deltaSeconds) {
      controller?.update(deltaSeconds)
    },
    applyChanges(changes, context) {
      if (changes.some(change => change.type === 'collider-state' || change.type === 'world-rebuild')) {
        controller?.setColliders(context.compiled.colliders)
      }
    },
    dispose() {
      controller?.dispose()
      controller = null
    },
  }
}
