import type { WorldPlugin } from '../core/types.js'
import { createAssetTypeRegistry, validateAssetEcosystem, type AssetTypeRegistry, type UnknownAssetPolicy } from './registry.js'

export interface AssetsPluginOptions {
  registry?: AssetTypeRegistry
  unknownAssets?: UnknownAssetPolicy
}

export function assetsPlugin(options: AssetsPluginOptions = {}): WorldPlugin {
  const registry = options.registry ?? createAssetTypeRegistry()
  return {
    name: 'anyo:assets',
    compile({ document, warn }) {
      validateAssetEcosystem(document, { registry, unknown: options.unknownAssets, warn })
    },
  }
}
