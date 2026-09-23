import type { GeometryKindCompiler } from '../core/GeometryCompiler.js'
import { boxGeometryKind } from './box.js'
import { roundedBoxGeometryKind } from './roundedBox.js'
import { planeGeometryKind } from './plane.js'
import { sphereGeometryKind } from './sphere.js'
import { cylinderGeometryKind } from './cylinder.js'
import { coneGeometryKind } from './cone.js'
import { capsuleGeometryKind } from './capsule.js'
import { discGeometryKind } from './disc.js'
import { torusGeometryKind } from './torus.js'
import { polygonGeometryKind } from './polygon.js'
import { latheGeometryKind } from './lathe.js'
import { extrudeGeometryKind } from '../extrusion/extrude.js'
import { sweepGeometryKind } from '../sweep/sweep.js'
import { bendGeometryKind, mirrorGeometryKind, noiseGeometryKind, taperGeometryKind, transformGeometryKind, twistGeometryKind } from '../modifiers/index.js'
import { intersectGeometryKind, subtractGeometryKind, unionGeometryKind } from '../csg/index.js'

export { GEOMETRY_QUALITY_DEFAULTS } from './quality.js'
export { boxGeometryKind, roundedBoxGeometryKind, planeGeometryKind, sphereGeometryKind, cylinderGeometryKind, coneGeometryKind, capsuleGeometryKind, discGeometryKind, torusGeometryKind, polygonGeometryKind, latheGeometryKind, extrudeGeometryKind, sweepGeometryKind, transformGeometryKind, mirrorGeometryKind, noiseGeometryKind, bendGeometryKind, twistGeometryKind, taperGeometryKind, unionGeometryKind, subtractGeometryKind, intersectGeometryKind }

export const BUILTIN_GEOMETRY_KINDS: readonly GeometryKindCompiler[] = Object.freeze([
  boxGeometryKind, roundedBoxGeometryKind, planeGeometryKind, sphereGeometryKind, cylinderGeometryKind,
  coneGeometryKind, capsuleGeometryKind, discGeometryKind, torusGeometryKind, polygonGeometryKind, latheGeometryKind, extrudeGeometryKind, sweepGeometryKind,
  transformGeometryKind, mirrorGeometryKind, noiseGeometryKind, bendGeometryKind, twistGeometryKind, taperGeometryKind, unionGeometryKind, subtractGeometryKind, intersectGeometryKind,
])

export const BUILTIN_GEOMETRY_KIND_NAMES: readonly string[] = Object.freeze(BUILTIN_GEOMETRY_KINDS.map(kind => kind.kind))
