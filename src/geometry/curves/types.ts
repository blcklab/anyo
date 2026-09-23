import type { CurveDefinition } from '../types/index.js'

export type CurvePoint3 = readonly [number, number, number]

export interface NormalizedCurveDefinition extends CurveDefinition {
  kind: CurveDefinition['kind']
  points: [number, number, number][]
  segments: number
  closed?: boolean
  tension?: number
}

export interface SampledCurve {
  readonly definition: NormalizedCurveDefinition
  readonly points: readonly CurvePoint3[]
  readonly tangents: readonly CurvePoint3[]
  readonly distances: readonly number[]
  readonly totalLength: number
  readonly closed: boolean
}

export interface CurveFrame {
  readonly position: CurvePoint3
  readonly tangent: CurvePoint3
  readonly normal: CurvePoint3
  readonly binormal: CurvePoint3
  readonly distance: number
}
