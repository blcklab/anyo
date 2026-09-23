import type { GeometryDefinition } from '../types/index.js'
import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { meshFromArrays, size2, withoutQuality } from './common.js'

export const planeGeometryKind: GeometryKindCompiler = {
  kind: 'plane',
  normalize(definition) {
    return { ...withoutQuality(definition), kind: 'plane', size: [...size2(definition)] } as GeometryDefinition
  },
  compile(definition) {
    const [width, height] = size2(definition)
    const x = width / 2, y = height / 2
    return meshFromArrays(
      [-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0],
      [0, 1, 2, 0, 2, 3],
      [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [{ start: 0, count: 6, materialIndex: 0, name: 'surface' }],
    )
  },
}
