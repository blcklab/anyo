import type { XRLocomotionMode, XRTurningMode } from '../core/types.js'

export interface XRExplorationPluginOptions {
  locomotion?: XRLocomotionMode
  turning?: XRTurningMode
  snapAngle?: number
  movementSpeed?: number
  turnSpeed?: number
  interactionDistance?: number
  dominantHand?: 'left' | 'right' | 'auto'
  collision?: boolean
  gazeDwellMs?: number
  teleportButton?: 'squeeze' | 'select'
}
