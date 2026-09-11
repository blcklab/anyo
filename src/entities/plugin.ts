import type { WorldPlugin } from '../core/types.js'
import { createComponentTypeRegistry, type ComponentTypeRegistry, type UnknownComponentPolicy } from '../components/index.js'
import { compileEntities } from './compileEntities.js'
import { createEntityTypeRegistry, type EntityTypeRegistry } from './registry.js'

export interface EntitiesPluginOptions {
  registry?: EntityTypeRegistry
  componentRegistry?: ComponentTypeRegistry
  unknownComponents?: UnknownComponentPolicy
}

export function entitiesPlugin(options: EntitiesPluginOptions = {}): WorldPlugin {
  const registry = options.registry ?? createEntityTypeRegistry()
  const componentRegistry = options.componentRegistry ?? createComponentTypeRegistry()
  return {
    name: 'anyo:entities',
    compile({ document, output, warn }) {
      compileEntities(document, output, {
        registry,
        componentRegistry,
        unknownComponents: options.unknownComponents,
        warn,
      })
    },
  }
}
