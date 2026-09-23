export type GeometryQualityPreset = 'low' | 'medium' | 'high' | 'ultra'

export type GeometryJsonScalar = string | number | boolean | null
export type GeometryJsonValue = GeometryJsonScalar | GeometryJsonValue[] | { [key: string]: GeometryJsonValue | undefined }

/**
 * Renderer-neutral procedural geometry input. Kind-specific fields stay JSON-first
 * and are normalized before hashing or compilation.
 */
export type GeometryNormalMode = 'flat' | 'smooth'
export type GeometryUvMode = 'generated' | 'planar' | 'box' | 'cylindrical' | 'spherical'
export type GeometryUvAxis = 'xy' | 'xz' | 'yz' | 'auto'

export interface GeometryNormalPolicy {
  mode: GeometryNormalMode
  /** Radians. Smooth faces whose normal angle exceeds this threshold stay split. */
  creaseAngle?: number
}

export interface GeometryUvPolicy {
  mode: GeometryUvMode
  /** Planar projection axis. `auto` selects the two axes with the largest bounds extent. */
  axis?: GeometryUvAxis
  scale?: [number, number]
  rotation?: number
  offset?: [number, number]
  /** Real-world texture density. One UV tile covers this many meters. */
  metersPerTile?: number
}

export interface GeometryDefinition {
  kind: string
  quality?: GeometryQualityPreset
  normals?: GeometryNormalPolicy
  uv?: GeometryUvPolicy
  /** Generate renderer-neutral xyzw tangent attributes after normals and UVs are resolved. */
  tangents?: boolean
  [key: string]: GeometryJsonValue | GeometryNormalPolicy | GeometryUvPolicy | GeometryDefinition | undefined
}

export interface BoxGeometryDefinition extends GeometryDefinition {
  kind: 'box'
  size?: [number, number, number]
}

export interface RoundedBoxGeometryDefinition extends GeometryDefinition {
  kind: 'roundedBox'
  size?: [number, number, number]
  radius?: number
  segments?: number
}

export interface PlaneGeometryDefinition extends GeometryDefinition {
  kind: 'plane'
  size?: [number, number]
}

export interface SphereGeometryDefinition extends GeometryDefinition {
  kind: 'sphere'
  radius?: number
  segments?: number
  rings?: number
}

export interface CylinderGeometryDefinition extends GeometryDefinition {
  kind: 'cylinder'
  radius?: number
  height?: number
  segments?: number
  cap?: boolean
}

export interface ConeGeometryDefinition extends GeometryDefinition {
  kind: 'cone'
  radius?: number
  height?: number
  segments?: number
  cap?: boolean
}

export interface CapsuleGeometryDefinition extends GeometryDefinition {
  kind: 'capsule'
  radius?: number
  /** Total capsule height including hemispherical caps. Must be >= 2 * radius. */
  height?: number
  segments?: number
  /** Segment count per hemisphere. */
  rings?: number
}

export interface DiscGeometryDefinition extends GeometryDefinition {
  /** Filled planar disc in the XY plane facing +Z. */
  kind: 'disc'
  radius?: number
  segments?: number
}

export interface TorusGeometryDefinition extends GeometryDefinition {
  /** Major radius from origin to tube centerline. */
  kind: 'torus'
  radius?: number
  tubeRadius?: number
  segments?: number
  tubeSegments?: number
}

export interface PolygonGeometryDefinition extends GeometryDefinition {
  /** Simple filled XY polygon facing +Z. */
  kind: 'polygon'
  points: [number, number][]
}

export interface ProfileDefinition {
  [key: string]: GeometryJsonValue | undefined
  points: [number, number][]
  holes?: [number, number][][]
}

export interface ExtrudeBevelDefinition {
  [key: string]: GeometryJsonValue | undefined
  size: number
  segments?: number
}


export type CurveKind = 'line' | 'polyline' | 'quadraticBezier' | 'cubicBezier' | 'catmullRom'

export interface CurveDefinition {
  [key: string]: GeometryJsonValue | undefined
  kind: CurveKind
  points: [number, number, number][]
  /** Deterministic sampled segment count. Explicit values override quality defaults. */
  segments?: number
  /** Supported by polyline and catmullRom. Closed samples include a seam duplicate internally. */
  closed?: boolean
  /** Cardinal tangent scale for catmullRom. Defaults to 0.5. */
  tension?: number
  quality?: GeometryQualityPreset
}



export type GeometryAxis = 'x' | 'y' | 'z'

export interface LatheGeometryDefinition extends GeometryDefinition {
  /** Revolves an ordered [radius, height] profile around local +Y. */
  kind: 'lathe'
  profile: [number, number][]
  segments?: number
  /** Cap non-zero-radius profile ends. Defaults to true. */
  cap?: boolean
}

export interface BendGeometryDefinition extends GeometryDefinition {
  kind: 'bend'
  source: GeometryDefinition
  /** Longitudinal source axis. Defaults to y. */
  axis?: GeometryAxis
  /** Perpendicular direction the centerline bends toward. */
  direction?: GeometryAxis
  /** Total bend angle across source bounds, in radians. */
  angle?: number
}

export interface TwistGeometryDefinition extends GeometryDefinition {
  kind: 'twist'
  source: GeometryDefinition
  /** Longitudinal source axis. Defaults to y. */
  axis?: GeometryAxis
  /** Total twist angle across source bounds, in radians. */
  angle?: number
}

export interface TaperGeometryDefinition extends GeometryDefinition {
  kind: 'taper'
  source: GeometryDefinition
  /** Longitudinal source axis. Defaults to y. */
  axis?: GeometryAxis
  /** Perpendicular scale at the minimum source bound. Defaults to 1. */
  startScale?: number
  /** Perpendicular scale at the maximum source bound. Defaults to 1. */
  endScale?: number
}

export interface TransformGeometryDefinition extends GeometryDefinition {
  kind: 'transform'
  source: GeometryDefinition
  /** Geometry-local translation in meters. */
  position?: [number, number, number]
  /** Geometry-local XYZ Euler rotation in radians. */
  rotation?: [number, number, number]
  /** Geometry-local non-zero scale. Negative components mirror handedness and winding. */
  scale?: [number, number, number]
}

export type GeometryMirrorAxis = 'x' | 'y' | 'z'

export interface NoiseGeometryDefinition extends GeometryDefinition {
  kind: 'noise'
  source: GeometryDefinition
  /** Deterministic signed 32-bit seed. */
  seed?: number
  /** Base spatial sampling frequency in inverse local meters. */
  frequency?: number
  /** Maximum signed displacement distance in local meters. */
  strength?: number
  /** Number of fBm layers. Bounded to 1..16. */
  octaves?: number
  /** Frequency multiplier per octave. */
  lacunarity?: number
  /** Amplitude multiplier per octave, from 0..1. */
  persistence?: number
  /** Local sampling-space offset. */
  offset?: [number, number, number]
}

export interface MirrorGeometryDefinition extends GeometryDefinition {
  kind: 'mirror'
  source: GeometryDefinition
  axis?: GeometryMirrorAxis
  /** Mirror plane offset along the selected axis, in meters. Defaults to 0. */
  offset?: number
  /** Keep the source alongside its mirrored copy. Defaults to true for symmetry. */
  includeOriginal?: boolean
}

export interface UnionGeometryDefinition extends GeometryDefinition {
  kind: 'union'
  left: GeometryDefinition
  right: GeometryDefinition
}

export interface SubtractGeometryDefinition extends GeometryDefinition {
  kind: 'subtract'
  left: GeometryDefinition
  right: GeometryDefinition
}

export interface IntersectGeometryDefinition extends GeometryDefinition {
  kind: 'intersect'
  left: GeometryDefinition
  right: GeometryDefinition
}

export interface GeometryArrayDefinition {
  source: GeometryDefinition
  count: number
  /** Per-instance translation step in meters. */
  offset: [number, number, number]
  position?: [number, number, number]
  rotation?: [number, number, number]
  rotationOffset?: [number, number, number]
  scale?: [number, number, number]
}

export interface GeometryArrayPlacement {
  index: number
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  scale: readonly [number, number, number]
}

export interface GeometryArrayLayout {
  source: GeometryDefinition
  placements: readonly GeometryArrayPlacement[]
}

export interface SweepGeometryDefinition extends GeometryDefinition {
  kind: 'sweep'
  profile: ProfileDefinition
  path: CurveDefinition
  /** Cap open path ends. Closed paths are never capped. */
  cap?: boolean
  /** Preferred initial profile-up direction. Parallel inputs use a stable fallback axis. */
  up?: [number, number, number]
}

export interface PathArrayDefinition {
  path: CurveDefinition
  spacing: number
  /** Distance from the beginning of an open path. */
  offset?: number
  /** Append the open-path endpoint when it does not land exactly on spacing. */
  includeEnd?: boolean
  /** Include transported curve frames for orientation. Defaults to true. */
  alignToPath?: boolean
  up?: [number, number, number]
}

export interface PathArrayPlacement {
  distance: number
  position: readonly [number, number, number]
  tangent?: readonly [number, number, number]
  normal?: readonly [number, number, number]
  binormal?: readonly [number, number, number]
}

export interface PathArrayLayout {
  totalLength: number
  closed: boolean
  placements: readonly PathArrayPlacement[]
}

export interface ExtrudeGeometryDefinition extends GeometryDefinition {
  kind: 'extrude'
  profile: ProfileDefinition
  /** Extrusion depth along local +Z/-Z, in meters. */
  depth: number
  cap?: boolean
  bevel?: false | ExtrudeBevelDefinition
}

export type BuiltinGeometryDefinition =
  | BoxGeometryDefinition
  | RoundedBoxGeometryDefinition
  | PlaneGeometryDefinition
  | SphereGeometryDefinition
  | CylinderGeometryDefinition
  | ConeGeometryDefinition
  | CapsuleGeometryDefinition
  | DiscGeometryDefinition
  | TorusGeometryDefinition
  | PolygonGeometryDefinition
  | LatheGeometryDefinition
  | ExtrudeGeometryDefinition
  | SweepGeometryDefinition
  | TransformGeometryDefinition
  | MirrorGeometryDefinition
  | NoiseGeometryDefinition
  | BendGeometryDefinition
  | TwistGeometryDefinition
  | TaperGeometryDefinition
  | UnionGeometryDefinition
  | SubtractGeometryDefinition
  | IntersectGeometryDefinition

export interface GeometryGroup {
  /** First index in the triangle index buffer. Must be triangle-aligned. */
  start: number
  /** Number of indices in this group. Must be triangle-aligned. */
  count: number
  /** Renderer-neutral material slot selected by the authored entity/material layer. */
  materialIndex: number
  /** Optional semantic region name such as `front`, `side`, or `trim`. */
  name?: string
}

export interface GeometryBounds {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
  sphere: {
    center: readonly [number, number, number]
    radius: number
  }
}

/** Triangle-list mesh data. The object and its typed arrays are immutable by contract once cached. */
export interface GeometryMesh {
  positions: Float32Array
  indices: Uint16Array | Uint32Array
  normals?: Float32Array
  uvs?: Float32Array
  /** Tangent layout is xyzw; w stores tangent-space handedness. */
  tangents?: Float32Array
  /** Vertex colors use RGBA layout. */
  colors?: Float32Array
  groups?: readonly GeometryGroup[]
  bounds: GeometryBounds
}

export type GeometryMeshDraft = Omit<GeometryMesh, 'bounds'> & { bounds?: GeometryBounds }

export interface GeometrySafetyLimits {
  maxGeometryVertices: number
  maxGeometryIndices: number
  maxCurveSegments: number
  maxProfilePoints: number
  maxModifierDepth: number
  maxBooleanDepth: number
  maxGeneratedInstances: number
  maxDefinitionDepth: number
  maxDefinitionNodes: number
}

export type GeometryIssueCode =
  | 'GEOMETRY_DEFINITION_INVALID'
  | 'GEOMETRY_KIND_INVALID'
  | 'GEOMETRY_KIND_UNSUPPORTED'
  | 'GEOMETRY_NON_FINITE_NUMBER'
  | 'GEOMETRY_DEFINITION_LIMIT'
  | 'GEOMETRY_PARAMETER_INVALID'
  | 'GEOMETRY_MESH_INVALID'
  | 'GEOMETRY_MESH_LIMIT'
  | 'GEOMETRY_INDEX_OUT_OF_RANGE'
  | 'GEOMETRY_ATTRIBUTE_LENGTH_INVALID'
  | 'GEOMETRY_GROUP_INVALID'
  | 'PROFILE_INVALID'
  | 'PROFILE_SELF_INTERSECTION'
  | 'PROFILE_HOLE_OUTSIDE'
  | 'PROFILE_HOLE_OVERLAP'
  | 'PROFILE_TRIANGULATION_FAILED'
  | 'EXTRUSION_BEVEL_COLLAPSE'
  | 'CURVE_INVALID'
  | 'CURVE_DEGENERATE'
  | 'SWEEP_FRAME_INVALID'
  | 'PATH_ARRAY_LIMIT'
  | 'GEOMETRY_MODIFIER_LIMIT'
  | 'GEOMETRY_INSTANCE_LIMIT'
  | 'ARCHITECTURE_INVALID'
  | 'ARCHITECTURE_OPENING_OVERLAP'
  | 'ARCHITECTURE_LIMIT'
  | 'CSG_SOLID_INVALID'
  | 'CSG_EMPTY_RESULT'
  | 'CSG_COMPLEXITY_LIMIT'
  | 'CSG_NUMERICAL_FAILURE'
  | 'CSG_DEPTH_LIMIT'

export interface GeometryIssue {
  code: GeometryIssueCode
  path: string
  message: string
  /** Optional deterministic recovery hint for AI/human authoring tools. */
  suggestion?: string
}

export interface GeometryInspectionResult<T> {
  valid: boolean
  value?: T
  issues: readonly GeometryIssue[]
}
