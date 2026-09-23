import type { CurveDefinition, GeometryDefinition, ProfileDefinition } from '../types/index.js'

export type ArchitectureVec2 = [number, number]
export type ArchitectureVec3 = [number, number, number]

export interface ArchitectureTransform {
  position: ArchitectureVec3
  rotation: ArchitectureVec3
  scale: ArchitectureVec3
}

export interface ArchitectureAnchor {
  name: string
  position: readonly [number, number, number]
  rotation?: readonly [number, number, number]
}

export interface ArchitecturePart {
  id: string
  role: string
  geometry: GeometryDefinition
  transform: ArchitectureTransform
}

export interface ArchitectureInstancePlacement {
  index: number
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  scale: readonly [number, number, number]
}

export interface ArchitectureInstanceGroup {
  id: string
  role: string
  geometry: GeometryDefinition
  placements: readonly ArchitectureInstancePlacement[]
}

export interface ArchitectureAssembly {
  type: ArchitectureDefinition['type']
  id?: string
  parts: readonly ArchitecturePart[]
  instanceGroups: readonly ArchitectureInstanceGroup[]
  anchors: readonly ArchitectureAnchor[]
}

export interface ArchitectureBaseDefinition {
  id?: string
}

export interface WallDoorOpeningDefinition {
  kind: 'door'
  id?: string
  /** Distance from the wall start to the opening's left edge, in meters. */
  offset: number
  width: number
  height: number
}

export interface WallWindowOpeningDefinition {
  kind: 'window'
  id?: string
  /** Distance from the wall start to the opening's left edge, in meters. */
  offset: number
  width: number
  height: number
  sillHeight: number
}

export type WallOpeningDefinition = WallDoorOpeningDefinition | WallWindowOpeningDefinition

export interface WallArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'wall'
  from: ArchitectureVec3
  to: ArchitectureVec3
  height: number
  thickness: number
  bevel?: number
  bevelSegments?: number
  openings?: WallOpeningDefinition[]
}

export interface SlabArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'floor' | 'ceiling'
  size: ArchitectureVec2
  thickness: number
  position?: ArchitectureVec3
  rotation?: ArchitectureVec3
  bevel?: number
  bevelSegments?: number
}

export interface PanelArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'panel'
  size: [number, number]
  thickness: number
  position?: ArchitectureVec3
  rotation?: ArchitectureVec3
  bevel?: number
  bevelSegments?: number
}

export interface ColumnArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'column'
  position?: ArchitectureVec3
  height: number
  shape?: 'rect' | 'round'
  size?: ArchitectureVec2
  radius?: number
  bevel?: number
  bevelSegments?: number
  segments?: number
}

export interface BeamArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'beam'
  from: ArchitectureVec3
  to: ArchitectureVec3
  height: number
  depth: number
  bevel?: number
  bevelSegments?: number
}

export interface StairArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'stairs'
  width: number
  height: number
  steps: number
  depth: number
  position?: ArchitectureVec3
  rotationY?: number
  treadThickness?: number
  riserThickness?: number
  closedRisers?: boolean
  landingDepth?: number
  bevel?: number
  bevelSegments?: number
}

export interface RailingArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'railing'
  path: CurveDefinition
  height: number
  postSpacing?: number
  postWidth?: number
  railRadius?: number
  railSegments?: number
  includePosts?: boolean
  midRailHeight?: number
}

export interface TrimArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'trim'
  path: CurveDefinition
  profile?: ProfileDefinition
  width?: number
  depth?: number
  up?: ArchitectureVec3
}

export interface RoofArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'roof'
  kind?: 'gable' | 'shed'
  size: ArchitectureVec2
  thickness: number
  pitch: number
  position?: ArchitectureVec3
  rotationY?: number
  bevel?: number
  bevelSegments?: number
}

export interface DoorOpeningArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'doorOpening'
  width: number
  height: number
}

export interface WindowOpeningArchitectureDefinition extends ArchitectureBaseDefinition {
  type: 'windowOpening'
  width: number
  height: number
  sillHeight?: number
}

export type ArchitectureDefinition =
  | WallArchitectureDefinition
  | SlabArchitectureDefinition
  | PanelArchitectureDefinition
  | ColumnArchitectureDefinition
  | BeamArchitectureDefinition
  | StairArchitectureDefinition
  | RailingArchitectureDefinition
  | TrimArchitectureDefinition
  | RoofArchitectureDefinition
  | DoorOpeningArchitectureDefinition
  | WindowOpeningArchitectureDefinition
