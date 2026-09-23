export type ProfilePoint = readonly [number, number]

export interface ProfileDefinition {
  points: readonly ProfilePoint[]
  holes?: readonly (readonly ProfilePoint[])[]
}

export interface NormalizedProfile {
  /** Canonical counter-clockwise outer contour. */
  outer: readonly ProfilePoint[]
  /** Canonical clockwise hole contours. */
  holes: readonly (readonly ProfilePoint[])[]
}
