import type { WorldPlugin } from '../core/types.js'
import { compileBuilding } from './compileBuilding.js'

export function buildingPlugin(): WorldPlugin {
  return {
    name: 'anyo:building',
    compile({ document, output }) {
      compileBuilding(document, output)
    },
  }
}
