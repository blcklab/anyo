import type { WorldPlugin } from '../core/types.js'
import { InteractionManager, type InteractionOptions } from './InteractionManager.js'

export function interactionsPlugin(options: InteractionOptions = {}): WorldPlugin {
  let manager: InteractionManager | null = null
  return {
    name: 'anyo:interactions',
    setup(context) {
      manager = new InteractionManager(context, options)
    },
    dispose() {
      manager?.dispose()
      manager = null
    },
  }
}
