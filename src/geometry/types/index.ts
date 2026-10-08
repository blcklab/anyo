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

export type GeometryVertexColorAxis = 'x' | 'y' | 'z'
export type GeometryVertexColorGradientStop = [number, string]

export interface GeometryVertexColorConstantDefinition {
  mode: 'constant'
  color: string
}

export interface GeometryVertexColorGradientDefinition {
  mode: 'gradient'
  axis: GeometryVertexColorAxis
  stops: GeometryVertexColorGradientStop[]
}

export interface GeometryVertexColorNoiseDefinition {
  mode: 'noise'
  seed?: number
  frequency?: number
  strength?: number
  colors: [string, string]
}

export type GeometryVertexColorDefinition = GeometryVertexColorConstantDefinition | GeometryVertexColorGradientDefinition | GeometryVertexColorNoiseDefinition

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
  /** Optional deterministic RGBA vertex-color generation for World 0.9 authoring. */
  vertexColor?: GeometryVertexColorDefinition
  [key: string]: GeometryJsonValue | GeometryNormalPolicy | GeometryUvPolicy | GeometryVertexColorDefinition | GeometryDefinition | undefined
}

/**
 * Canonical renderer-neutral geometry source. This is an additive alias over the
 * established GeometryDefinition contract so existing authoring remains source-compatible.
 */
export type GeometrySource = GeometryDefinition

/**
 * JSON-first, source-free descriptor for one ordered geometry operator. Operators
 * are normalized and applied by the generic pipeline rather than nesting sources.
 */
export interface GeometryOperator {
  kind: string
  [key: string]: GeometryJsonValue | undefined
}

export interface GeometryTransformOperator extends GeometryOperator {
  kind: 'transform'
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

export interface GeometryTaperOperator extends GeometryOperator {
  kind: 'taper'
  axis?: GeometryAxis
  startScale?: number
  endScale?: number
}

export interface GeometryTwistOperator extends GeometryOperator {
  kind: 'twist'
  axis?: GeometryAxis
  angle?: number
}

export interface GeometryBendOperator extends GeometryOperator {
  kind: 'bend'
  axis?: GeometryAxis
  direction?: GeometryAxis
  angle?: number
}

export interface GeometryMirrorOperator extends GeometryOperator {
  kind: 'mirror'
  axis?: GeometryMirrorAxis
  /** Mirror plane offset along the selected axis, in meters. Defaults to 0. */
  offset?: number
  /** Keep the source alongside its mirrored copy. Defaults to true. */
  includeOriginal?: boolean
}

export interface GeometryNoiseOperator extends GeometryOperator {
  kind: 'noise'
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

export interface GeometryArrayOperator extends GeometryOperator {
  kind: 'array'
  count: number
  /** Per-copy translation step in meters. */
  offset: [number, number, number]
  /** Base transform of the first copy. */
  position?: [number, number, number]
  rotation?: [number, number, number]
  /** Per-copy Euler rotation step in radians. */
  rotationOffset?: [number, number, number]
  scale?: [number, number, number]
}

export interface GeometryWeldOperator extends GeometryOperator {
  kind: 'weld'
  /** Maximum positional distance for otherwise attribute-identical vertices. */
  tolerance?: number
}

export interface GeometryMeshAttributesDefinition {
  [key: string]: GeometryJsonValue | undefined
  normals?: number[]
  uvs?: number[]
  tangents?: number[]
  colors?: number[]
}

export interface GeometryMeshGroupDefinition {
  [key: string]: GeometryJsonValue | undefined
  start: number
  count: number
  materialIndex: number
  name?: string
}

/** Universal indexed triangle-list escape hatch for JSON-authored geometry. */
export interface MeshGeometryDefinition extends GeometryDefinition {
  kind: 'mesh'
  /** Flat xyz vertex positions. */
  positions: number[]
  /** Flat triangle-list indices. */
  indices: number[]
  /** Optional raw per-vertex attributes. Surface policies stay at the geometry root. */
  attributes?: GeometryMeshAttributesDefinition
  groups?: GeometryMeshGroupDefinition[]
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

/** Named profile resources are authoring conveniences; normalized geometry hashes profile content, not resource ids. */
export type ProfileResourceMap = Readonly<Record<string, ProfileDefinition>>
export type ProfileInput = ProfileDefinition | string

export interface ExtrudeBevelDefinition {
  [key: string]: GeometryJsonValue | undefined
  size: number
  segments?: number
}


export type CurveKind = 'line' | 'polyline' | 'quadraticBezier' | 'cubicBezier' | 'catmullRom' | 'arc' | 'circle' | 'helix'

/**
 * Renderer-neutral curve authoring. Point-based and analytic kinds normalize into
 * the same deterministic sampled-curve pipeline before geometry consumers run.
 */
export interface CurveDefinition {
  [key: string]: GeometryJsonValue | undefined
  kind: CurveKind
  /** Control points for line/polyline/Bezier/Catmull-Rom curves. */
  points?: [number, number, number][]
  /** Arc/circle center. */
  center?: [number, number, number]
  /** Helix center at t=0 before the radial offset is applied. */
  origin?: [number, number, number]
  radius?: number
  /** Arc start/end radians around normal; helix starting phase uses startAngle. */
  startAngle?: number
  endAngle?: number
  /** Arc/circle plane normal. Defaults to +Y. */
  normal?: [number, number, number]
  /** Helix axis. Defaults to +Y. */
  axis?: [number, number, number]
  /** Preferred zero-angle radial direction. It is projected perpendicular to normal/axis. */
  radial?: [number, number, number]
  /** Helix axial height from start to end. */
  height?: number
  /** Signed helix turn count; sign controls handedness. */
  turns?: number
  /** Deterministic sampled segment count. Explicit values override quality defaults. */
  segments?: number
  /** Supported by polyline and catmullRom. Closed samples include a seam duplicate internally. */
  closed?: boolean
  /** Cardinal tangent scale for catmullRom. Defaults to 0.5. */
  tension?: number
  quality?: GeometryQualityPreset
}

/** Named curve resources are authoring conveniences; normalized geometry hashes curve content, not resource ids. */
export type CurveResourceMap = Readonly<Record<string, CurveDefinition>>
export type CurveInput = CurveDefinition | string



export type GeometryAxis = 'x' | 'y' | 'z'

export type ScalarFieldKind = 'constant' | 'gradient' | 'distance' | 'radial' | 'noise' | 'add' | 'multiply' | 'min' | 'max' | 'invert' | 'clamp'

/** Renderer-neutral scalar field. Named references are resolved before geometry hashing. */
export interface ScalarFieldDefinition {
  [key: string]: GeometryJsonValue | ScalarFieldInput | ScalarFieldInput[] | undefined
  kind: ScalarFieldKind
  value?: number
  origin?: [number, number, number]
  direction?: [number, number, number]
  scale?: number
  offset?: number | [number, number, number]
  point?: [number, number, number]
  center?: [number, number, number]
  radius?: number
  seed?: number
  frequency?: number
  octaves?: number
  lacunarity?: number
  persistence?: number
  fields?: ScalarFieldInput[]
  field?: ScalarFieldInput
  min?: number
  max?: number
}

export type ScalarFieldResourceMap = Readonly<Record<string, ScalarFieldDefinition>>
export type ScalarFieldInput = ScalarFieldDefinition | string

export interface GeometryDisplaceOperator extends GeometryOperator {
  kind: 'displace'
  field: ScalarFieldInput
  /** Scalar multiplier applied to the sampled field value, in local meters. */
  strength?: number
  /** Displacement direction. Defaults to the vertex normal. */
  direction?: 'normal' | GeometryAxis
}

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

/** Ordered mesh-operator composition over one geometry source. */
export interface GeometryPipelineDefinition extends GeometryDefinition {
  kind: 'pipeline'
  source: GeometryDefinition
  modifiers: GeometryOperator[]
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

export interface SweepProfileStationDefinition {
  [key: string]: GeometryJsonValue | ProfileDefinition | undefined
  /** Normalized distance along the path from 0 to 1. First/last stations must be 0/1. */
  at: number
  /** Optional replacement profile. Topology must match the base sweep profile. */
  profile?: ProfileInput
  /** Positive local profile scale. Defaults to [1, 1]. */
  scale?: [number, number]
  /** Local profile rotation in radians. */
  rotation?: number
  /** Local profile offset in profile coordinates. */
  offset?: [number, number]
}

export interface SweepGeometryDefinition extends GeometryDefinition {
  kind: 'sweep'
  profile: ProfileInput
  path: CurveInput
  /** Optional profile morph/transform stations along normalized path distance. */
  profileStations?: SweepProfileStationDefinition[]
  /** Cap open path ends. Closed paths are never capped. */
  cap?: boolean
  /** Preferred initial profile-up direction. Parallel inputs use a stable fallback axis. */
  up?: [number, number, number]
}

export interface LoftSectionDefinition {
  [key: string]: GeometryJsonValue | ProfileDefinition | undefined
  /** Section position along local +Z, in meters. Sections must be strictly increasing. */
  z: number
  profile: ProfileInput
  /** Positive local profile scale. Defaults to [1, 1]. */
  scale?: [number, number]
  /** Rotation around local +Z, in radians. */
  rotation?: number
  /** Local XY profile offset. */
  offset?: [number, number]
}

export interface LoftGeometryDefinition extends GeometryDefinition {
  kind: 'loft'
  sections: LoftSectionDefinition[]
  cap?: boolean
}

export interface PathArrayDefinition {
  path: CurveInput
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
  profile: ProfileInput
  /** Extrusion depth along local +Z/-Z, in meters. */
  depth: number
  cap?: boolean
  bevel?: false | ExtrudeBevelDefinition
}

export type BuiltinGeometryDefinition =
  | MeshGeometryDefinition
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
  | LoftGeometryDefinition
  | GeometryPipelineDefinition
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
  /** Maximum semantic/material groups retained on one finalized mesh. */
  maxGeometryGroups: number
  /** Maximum optional per-vertex attribute scalar values retained on one mesh. */
  maxGeometryAttributeValues: number
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
  | 'GEOMETRY_OPERATOR_UNSUPPORTED'
  | 'GEOMETRY_EXTENSION_NAMESPACE_INVALID'
  | 'GEOMETRY_EXTENSION_NAMESPACE_CONFLICT'
  | 'GEOMETRY_EXTENSION_VERSION_INVALID'
  | 'GEOMETRY_EXTENSION_PROVIDER_EMPTY'
  | 'GEOMETRY_EXTENSION_KIND_INVALID'
  | 'GEOMETRY_EXTENSION_KIND_CONFLICT'
  | 'GEOMETRY_EXTENSION_UNREGISTERED'
  | 'GEOMETRY_EXTENSION_KIND_UNREGISTERED'
  | 'GEOMETRY_EXTENSION_KIND_MISMATCH'
  | 'GEOMETRY_EXTENSION_FIELD_INVALID'
  | 'GEOMETRY_EXTENSION_PARAMS_INVALID'
  | 'GEOMETRY_NON_FINITE_NUMBER'
  | 'GEOMETRY_DEFINITION_LIMIT'
  | 'GEOMETRY_PARAMETER_INVALID'
  | 'GEOMETRY_MESH_INVALID'
  | 'GEOMETRY_MESH_LIMIT'
  | 'GEOMETRY_INDEX_OUT_OF_RANGE'
  | 'GEOMETRY_ATTRIBUTE_LENGTH_INVALID'
  | 'GEOMETRY_GROUP_INVALID'
  | 'GEOMETRY_DEGENERATE_TRIANGLE'
  | 'GEOMETRY_WINDING_INCONSISTENT'
  | 'GEOMETRY_BOUNDS_INVALID'
  | 'GEOMETRY_BOUNDS_MISMATCH'
  | 'GEOMETRY_NORMAL_INVALID'
  | 'GEOMETRY_TANGENT_INVALID'
  | 'GEOMETRY_GROUP_OVERLAP'
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

export type GeometryIssueSeverity = 'warning' | 'error'

export interface GeometryIssueContext {
  /** Canonical root geometry kind when known. */
  geometryKind?: string
  /** Deterministic g2 build key when known. */
  geometryKey?: string
  /** Source-free operator kind when the issue originated during an operator pass. */
  operatorKind?: string
  /** Zero-based operator position when the issue originated inside a pipeline. */
  operatorIndex?: number
}

export interface GeometryIssue {
  code: GeometryIssueCode
  path: string
  message: string
  /** Warnings are non-fatal diagnostics; omitted severity preserves existing error semantics. */
  severity?: GeometryIssueSeverity
  /** Optional structured compiler context for developer tooling. */
  context?: GeometryIssueContext
  /** Optional deterministic recovery hint for AI/human authoring tools. */
  suggestion?: string
}

export interface GeometryInspectionResult<T> {
  valid: boolean
  value?: T
  /** Fatal validation issues. */
  issues: readonly GeometryIssue[]
  /** Non-fatal diagnostics emitted while preserving valid unusual geometry. */
  diagnostics?: readonly GeometryIssue[]
}

export type GeometryValidationLevel = 'ignore' | 'warn' | 'error'

export interface GeometryMeshValidationOptions {
  limits?: Partial<GeometrySafetyLimits>
  /** Degenerate indexed triangles are warnings by default, but strict callers may promote them to errors. */
  degenerateTriangles?: GeometryValidationLevel
  /** Zero-length/malformed normal and tangent vectors are warnings by default. */
  vectorAttributes?: GeometryValidationLevel
  /** Overlapping material groups are legal but suspicious, so they warn by default. */
  groupOverlaps?: GeometryValidationLevel
  /** Shared-edge winding conflicts warn by default for meshes below windingTriangleLimit. */
  winding?: GeometryValidationLevel
  /** Supplied stale/invalid bounds are repaired by default or may be promoted to errors. */
  bounds?: 'repair' | 'error'
  /** Bound diagnostic accumulation to keep malformed generated geometry from flooding tooling. */
  maxDiagnostics?: number
  /** Skip the memory-heavier shared-edge winding scan above this triangle count. */
  windingTriangleLimit?: number
  /** Optional structured compiler context copied onto emitted issues/diagnostics. */
  context?: GeometryIssueContext
  /** Optional sink for non-fatal diagnostics. */
  onDiagnostic?: (diagnostic: GeometryIssue) => void
}
