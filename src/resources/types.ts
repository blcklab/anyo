import type { AssetDefinition, JsonValue, NormalizedMaterialDefinition } from '../core/types.js'
import type { GeometryDefinition } from '../geometry/types/index.js'

export type ResourceKind = 'geometry' | 'material' | 'asset' | 'instance'
export type ResourceId = string

export interface ResourceFrame {
  tangent: readonly [number, number, number]
  normal: readonly [number, number, number]
  binormal: readonly [number, number, number]
}

export interface ResourceTransform {
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  scale: readonly [number, number, number]
}

export interface ResourceNodeBase {
  readonly id: ResourceId
  readonly kind: ResourceKind
  /** Content identity. Instance keys exclude semantic instance id. */
  readonly key: string
  /** Resource ids that must exist before this node can be realized. */
  readonly dependencies: readonly ResourceId[]
}

export interface GeometryResource extends ResourceNodeBase {
  readonly kind: 'geometry'
  readonly definition: GeometryDefinition
}

export interface MaterialResource extends ResourceNodeBase {
  readonly kind: 'material'
  readonly definition: NormalizedMaterialDefinition
  readonly assetDependencies: readonly ResourceId[]
}

export interface AssetResource extends ResourceNodeBase {
  readonly kind: 'asset'
  readonly definition: AssetDefinition
  readonly assetDependencies: readonly ResourceId[]
}

export interface InstanceResource extends ResourceNodeBase {
  readonly kind: 'instance'
  /** Stable authoring/semantic identity. Distinct instances are never deduplicated by content. */
  readonly instanceId: string
  readonly source: ResourceId
  readonly materials: readonly ResourceId[]
  /** Optional semantic geometry-group name -> material resource binding. */
  readonly materialBindings?: Readonly<Record<string, ResourceId>>
  readonly transform: ResourceTransform
  /** Optional transported orientation frame, used by path-aligned instances without renderer matrices. */
  readonly frame?: ResourceFrame
  readonly metadata?: Readonly<Record<string, JsonValue>>
}

export type ResourceNode = GeometryResource | MaterialResource | AssetResource | InstanceResource

export interface ResourceDependencyEdge {
  readonly dependency: ResourceId
  readonly dependent: ResourceId
}

export interface ResourceGraphSnapshot {
  readonly key: string
  readonly nodes: readonly ResourceNode[]
  readonly edges: readonly ResourceDependencyEdge[]
  /** Dependencies-first deterministic order. */
  readonly topologicalOrder: readonly ResourceId[]
}

export interface ResourceGraphLimits {
  maxResources: number
  maxEdges: number
  maxInstances: number
}

export type InstanceDeltaField = 'source' | 'materials' | 'transform' | 'frame' | 'metadata'
export type InstanceDeltaKind = InstanceDeltaField | 'composite'

export interface InstanceResourceDelta {
  readonly id: ResourceId
  readonly instanceId: string
  readonly kind: InstanceDeltaKind
  readonly fields: readonly InstanceDeltaField[]
  readonly previous: InstanceResource
  readonly next: InstanceResource
}

export interface ResourceGraphDiff {
  readonly previousKey: string | null
  readonly nextKey: string | null
  /** New resources in next-graph dependencies-first order. */
  readonly added: readonly ResourceId[]
  /** Removed resources in previous-graph dependencies-first order. */
  readonly removed: readonly ResourceId[]
  /** Byte/content-identical resources that can be reused as-is. */
  readonly reused: readonly ResourceId[]
  /** Stable semantic instances whose content changed in place. */
  readonly instanceUpdates: readonly InstanceResourceDelta[]
}

export interface ResourceTransitionStats {
  readonly reused: number
  readonly compile: number
  readonly createInstances: number
  readonly updateInstances: number
  readonly removeInstances: number
  readonly release: number
  readonly actions: number
}

export interface ResourceTransitionPlan {
  readonly previousKey: string | null
  readonly nextKey: string | null
  readonly noOp: boolean
  /** Resources carried forward without work. */
  readonly reuse: readonly ResourceId[]
  /** New non-instance resources, dependencies-first. */
  readonly compile: readonly ResourceId[]
  /** New semantic instances, after compile resources are ready. */
  readonly createInstances: readonly ResourceId[]
  /** Stable instances that must be invalidated/refreshed before applying their delta. */
  readonly invalidate: readonly ResourceId[]
  readonly updateInstances: readonly InstanceResourceDelta[]
  /** Removed semantic instances, before their dependencies are released. */
  readonly removeInstances: readonly ResourceId[]
  /** Removed non-instance resources, dependents-first. */
  readonly release: readonly ResourceId[]
  readonly stats: ResourceTransitionStats
}


export type RealizableResource = GeometryResource | MaterialResource | AssetResource
export type ResourceRealizationPhase =
  | 'validate'
  | 'prepare'
  | 'createInstance'
  | 'updateInstance'
  | 'commit'
  | 'removeInstance'
  | 'release'
  | 'rollback'

export type ResourceRealizationIssueCode =
  | 'RESOURCE_REALIZATION_BUSY'
  | 'RESOURCE_REALIZATION_FAULTED'
  | 'RESOURCE_REALIZATION_STATE_MISMATCH'
  | 'RESOURCE_REALIZATION_PREPARE_FAILED'
  | 'RESOURCE_REALIZATION_CREATE_FAILED'
  | 'RESOURCE_REALIZATION_UPDATE_FAILED'
  | 'RESOURCE_REALIZATION_ROLLBACK_FAILED'
  | 'RESOURCE_REALIZATION_CLEANUP_FAILED'

export interface ResourceRealizationIssue {
  readonly code: ResourceRealizationIssueCode
  readonly phase: ResourceRealizationPhase
  readonly message: string
  readonly resourceId?: ResourceId
  readonly cause?: unknown
}

export interface ResourceRealizationContext<ResourceHandle = unknown, InstanceHandle = unknown> {
  readonly phase: ResourceRealizationPhase
  readonly previousGraph: import('./graph.js').ResourceGraph | null
  readonly nextGraph: import('./graph.js').ResourceGraph | null
  readonly plan: ResourceTransitionPlan | null
  readonly getResourceHandle: (id: ResourceId) => ResourceHandle | undefined
  readonly getInstanceHandle: (id: ResourceId) => InstanceHandle | undefined
}

export interface ResourceRealizationHooks<ResourceHandle = unknown, InstanceHandle = unknown> {
  /** Prepare one content-addressed geometry/material/asset resource. Dependencies are already available through the context. */
  prepare(resource: RealizableResource, context: ResourceRealizationContext<ResourceHandle, InstanceHandle>): ResourceHandle | Promise<ResourceHandle>
  /** Create one semantic instance after its source/material resources are prepared. */
  createInstance(instance: InstanceResource, context: ResourceRealizationContext<ResourceHandle, InstanceHandle>): InstanceHandle | Promise<InstanceHandle>
  /** Apply a stable semantic instance delta. Returning a handle replaces the cached opaque handle; undefined keeps the existing handle. */
  updateInstance(delta: InstanceResourceDelta, handle: InstanceHandle, context: ResourceRealizationContext<ResourceHandle, InstanceHandle>): InstanceHandle | void | Promise<InstanceHandle | void>
  /** Remove one semantic instance. Used both for committed retirement and pre-commit rollback of newly-created instances. */
  removeInstance(instance: InstanceResource, handle: InstanceHandle, context: ResourceRealizationContext<ResourceHandle, InstanceHandle>): void | Promise<void>
  /** Release one prepared geometry/material/asset resource. Used both for committed retirement and pre-commit rollback. */
  release(resource: RealizableResource, handle: ResourceHandle, context: ResourceRealizationContext<ResourceHandle, InstanceHandle>): void | Promise<void>
}

export interface ResourceRealizationCleanupResult {
  readonly removedInstances: number
  readonly releasedResources: number
  readonly pending: number
  readonly issue?: ResourceRealizationIssue
}

export interface ResourceRealizationStats {
  readonly prepared: number
  readonly createdInstances: number
  readonly updatedInstances: number
  readonly removedInstances: number
  readonly releasedResources: number
  readonly reused: number
}

export interface ResourceRealizationResult {
  readonly previousKey: string | null
  readonly nextKey: string | null
  readonly noOp: boolean
  readonly committed: boolean
  readonly plan: ResourceTransitionPlan
  readonly cleanup: ResourceRealizationCleanupResult
  readonly stats: ResourceRealizationStats
}

export interface ResourceRealizationSnapshot {
  readonly graphKey: string | null
  readonly resourceIds: readonly ResourceId[]
  readonly instanceIds: readonly ResourceId[]
  readonly retiredIds: readonly ResourceId[]
  readonly faulted: boolean
}

export type ResourceIssueCode =
  | 'RESOURCE_INVALID'
  | 'RESOURCE_ID_INVALID'
  | 'RESOURCE_ID_CONFLICT'
  | 'RESOURCE_REFERENCE_MISSING'
  | 'RESOURCE_REFERENCE_INVALID'
  | 'RESOURCE_CYCLE'
  | 'RESOURCE_LIMIT'
  | 'RESOURCE_DIFF_IDENTITY_MISMATCH'

export interface ResourceIssue {
  code: ResourceIssueCode
  path: string
  message: string
  suggestion?: string
}

export interface InstanceResourceInput {
  id: string
  source: ResourceId
  materials?: readonly ResourceId[]
  /** Optional semantic geometry-group name -> material resource binding. */
  materialBindings?: Readonly<Record<string, ResourceId>>
  transform?: Partial<ResourceTransform>
  frame?: ResourceFrame
  metadata?: Readonly<Record<string, JsonValue>>
}

export interface ArchitectureResourceOptions {
  /** Optional material definitions keyed by S7 semantic role (`wall`, `tread`, `post`, etc.). */
  materialsByRole?: Readonly<Record<string, import('../core/types.js').MaterialDefinition>>
}
