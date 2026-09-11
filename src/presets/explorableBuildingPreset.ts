import { assetsPlugin, type AssetsPluginOptions } from '../assets/index.js'
import { buildingPlugin } from '../building/plugin.js'
import type { WorldPlugin } from '../core/types.js'
import { entitiesPlugin } from '../entities/plugin.js'
import { explorePlugin, type FirstPersonControllerOptions } from '../explore/index.js'
import { interactionsPlugin, type InteractionOptions } from '../interactions/index.js'
import { visibilityPlugin, type PortalVisibilityOptions } from '../visibility/index.js'
import { zonesPlugin, type ZonesPluginOptions } from '../zones/index.js'

export interface ExplorableBuildingPresetOptions {
  assets?: AssetsPluginOptions | false
  exploration?: FirstPersonControllerOptions | false
  interactions?: InteractionOptions | false
  visibility?: PortalVisibilityOptions | false
  zones?: ZonesPluginOptions | false
}

export function explorableBuildingPreset(options: ExplorableBuildingPresetOptions = {}): WorldPlugin[] {
  const plugins: WorldPlugin[] = []
  if (options.assets !== false) plugins.push(assetsPlugin(options.assets))
  plugins.push(buildingPlugin(), entitiesPlugin())
  if (options.visibility !== false) plugins.push(visibilityPlugin(options.visibility))
  if (options.zones !== false) plugins.push(zonesPlugin(options.zones))
  if (options.exploration !== false) plugins.push(explorePlugin(options.exploration))
  if (options.interactions !== false) plugins.push(interactionsPlugin(options.interactions))
  return plugins
}
