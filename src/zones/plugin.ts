import type { WorldPlugin } from '../core/types.js'
import { AudioZoneSystem } from './AudioZoneSystem.js'
import { LodSystem } from './LodSystem.js'
import { TriggerSystem } from './TriggerSystem.js'

export interface ZonesPluginOptions {
  triggers?: boolean
  /** @deprecated Legacy HTMLAudioElement playback. Install @blcklab/anyo-audio for production audio. */
  audio?: boolean
  lod?: boolean
}

export function zonesPlugin(options: ZonesPluginOptions = {}): WorldPlugin {
  let triggers: TriggerSystem | null = null
  let audio: AudioZoneSystem | null = null
  let lod: LodSystem | null = null

  return {
    name: 'anyo:zones',
    setup(context) {
      if (options.triggers ?? true) triggers = new TriggerSystem(context)
      if (options.audio === true) audio = new AudioZoneSystem(context)
      if (options.lod ?? true) lod = new LodSystem(context)
    },
    update() {
      triggers?.update()
      audio?.update()
      lod?.update()
    },
    dispose() {
      audio?.dispose()
      triggers = null
      audio = null
      lod = null
    },
  }
}
