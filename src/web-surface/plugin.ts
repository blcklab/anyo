import type { WorldPlugin } from '../core/types.js'
import { WebSurfaceAppRegistry, createWebSurfaceAppRegistry } from './registry.js'
import { WebSurfaceRuntime, type WebSurfaceRuntimeOptions } from './WebSurfaceRuntime.js'

export interface WebSurfacePluginOptions extends Omit<WebSurfaceRuntimeOptions, 'registry'> {
  registry?: WebSurfaceAppRegistry
}

export interface WebSurfacePlugin extends WorldPlugin {
  readonly registry: WebSurfaceAppRegistry
  readonly capabilities: {
    readonly registeredApps: true
    readonly snapshots: true
    readonly domOverlay: boolean
    readonly externalUrls: boolean
    readonly liveXRPresentation: false
  }
}

export function webSurfacePlugin(options: WebSurfacePluginOptions = {}): WebSurfacePlugin {
  const registry = options.registry ?? createWebSurfaceAppRegistry()
  let runtime: WebSurfaceRuntime | null = null
  const capabilities = Object.freeze({
    registeredApps: true as const,
    snapshots: true as const,
    domOverlay: typeof document !== 'undefined',
    externalUrls: Boolean(options.externalUrls),
    liveXRPresentation: false as const,
  })
  return {
    name: 'anyo:web-surface',
    registry,
    capabilities,
    async setup(context) {
      runtime = new WebSurfaceRuntime({ ...options, registry })
      await runtime.sync(context)
    },
    update(_deltaSeconds, context) {
      runtime?.update(context)
    },
    async applyChanges(_changes, context) {
      await runtime?.sync(context)
    },
    dispose() {
      runtime?.dispose()
      runtime = null
    },
  }
}
