import { ResourceRealizationError } from './errors.js'
import { planResourceGraphTransition } from './incremental.js'
import type { ResourceGraph } from './graph.js'
import type {
  InstanceResource,
  InstanceResourceDelta,
  RealizableResource,
  ResourceId,
  ResourceRealizationCleanupResult,
  ResourceRealizationContext,
  ResourceRealizationHooks,
  ResourceRealizationIssue,
  ResourceRealizationPhase,
  ResourceRealizationResult,
  ResourceRealizationSnapshot,
  ResourceTransitionPlan,
} from './types.js'

type RetiredEntry<ResourceHandle, InstanceHandle> =
  | { readonly type: 'instance'; readonly node: InstanceResource; readonly handle: InstanceHandle }
  | { readonly type: 'resource'; readonly node: RealizableResource; readonly handle: ResourceHandle }

type AttemptedUpdate<InstanceHandle> = {
  readonly delta: InstanceResourceDelta
  readonly handleBefore: InstanceHandle
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function reverseDelta(delta: InstanceResourceDelta): InstanceResourceDelta {
  return Object.freeze({
    id: delta.id,
    instanceId: delta.instanceId,
    kind: delta.kind,
    fields: delta.fields,
    previous: delta.next,
    next: delta.previous,
  })
}

function realizationError(
  code: ResourceRealizationIssue['code'],
  phase: ResourceRealizationPhase,
  message: string,
  options: { resourceId?: ResourceId; cause?: unknown; rollbackIssues?: readonly ResourceRealizationIssue[] } = {},
): ResourceRealizationError {
  return new ResourceRealizationError({
    code,
    phase,
    message,
    ...(options.resourceId ? { resourceId: options.resourceId } : {}),
    ...(options.cause !== undefined ? { cause: options.cause } : {}),
  }, options.rollbackIssues)
}

function requireNode<T extends 'instance' | 'resource'>(
  graph: ResourceGraph | null,
  id: ResourceId,
  expected: T,
): T extends 'instance' ? InstanceResource : RealizableResource {
  const node = graph?.get(id)
  const valid = expected === 'instance'
    ? node?.kind === 'instance'
    : node !== undefined && node.kind !== 'instance'
  if (!valid) {
    throw realizationError(
      'RESOURCE_REALIZATION_STATE_MISMATCH',
      'validate',
      `Transition plan references ${expected} resource "${id}" that is missing from the expected graph.`,
      { resourceId: id },
    )
  }
  return node as never
}

/**
 * Renderer-neutral execution/cache layer for S10 ResourceTransitionPlan values.
 *
 * The realizer owns only opaque handles supplied by the adapter hooks. It does
 * not allocate GPU/renderer objects itself and does not depend on Sekai64.
 */
export class ResourceRealizer<ResourceHandle = unknown, InstanceHandle = unknown> {
  readonly #hooks: ResourceRealizationHooks<ResourceHandle, InstanceHandle>
  #graph: ResourceGraph | null = null
  #resourceHandles = new Map<ResourceId, ResourceHandle>()
  #instanceHandles = new Map<ResourceId, InstanceHandle>()
  #retired: RetiredEntry<ResourceHandle, InstanceHandle>[] = []
  #busy = false
  #faulted = false

  constructor(hooks: ResourceRealizationHooks<ResourceHandle, InstanceHandle>) {
    this.#hooks = hooks
  }

  get graph(): ResourceGraph | null { return this.#graph }
  get graphKey(): string | null { return this.#graph?.key ?? null }
  get faulted(): boolean { return this.#faulted }
  get resourceCount(): number { return this.#resourceHandles.size }
  get instanceCount(): number { return this.#instanceHandles.size }
  get retiredCount(): number { return this.#retired.length }

  hasResource(id: ResourceId): boolean { return this.#resourceHandles.has(id) }
  hasInstance(id: ResourceId): boolean { return this.#instanceHandles.has(id) }
  getResourceHandle(id: ResourceId): ResourceHandle | undefined { return this.#resourceHandles.get(id) }
  getInstanceHandle(id: ResourceId): InstanceHandle | undefined { return this.#instanceHandles.get(id) }

  snapshot(): ResourceRealizationSnapshot {
    return Object.freeze({
      graphKey: this.graphKey,
      resourceIds: Object.freeze([...this.#resourceHandles.keys()].sort()),
      instanceIds: Object.freeze([...this.#instanceHandles.keys()].sort()),
      retiredIds: Object.freeze(this.#retired.map((entry) => entry.node.id)),
      faulted: this.#faulted,
    })
  }

  #assertReady(): void {
    if (this.#busy) {
      throw realizationError('RESOURCE_REALIZATION_BUSY', 'validate', 'A resource realization transition is already running.')
    }
    if (this.#faulted) {
      throw realizationError(
        'RESOURCE_REALIZATION_FAULTED',
        'validate',
        'The resource realizer is faulted because a previous rollback could not restore adapter state.',
      )
    }
  }

  #assertCacheMatchesGraph(): void {
    if (!this.#graph) {
      if (this.#resourceHandles.size !== 0 || this.#instanceHandles.size !== 0) {
        throw realizationError(
          'RESOURCE_REALIZATION_STATE_MISMATCH',
          'validate',
          'The realization cache contains active handles while no active resource graph is installed.',
        )
      }
      return
    }
    for (const node of this.#graph.list()) {
      const hasHandle = node.kind === 'instance' ? this.#instanceHandles.has(node.id) : this.#resourceHandles.has(node.id)
      if (!hasHandle) {
        throw realizationError(
          'RESOURCE_REALIZATION_STATE_MISMATCH',
          'validate',
          `Active graph resource "${node.id}" has no realization handle.`,
          { resourceId: node.id },
        )
      }
    }
    if (this.#resourceHandles.size !== this.#graph.list().filter((node) => node.kind !== 'instance').length
      || this.#instanceHandles.size !== this.#graph.list('instance').length) {
      throw realizationError(
        'RESOURCE_REALIZATION_STATE_MISMATCH',
        'validate',
        'The realization cache contains active handles that are not represented by the active graph.',
      )
    }
  }

  #context(
    phase: ResourceRealizationPhase,
    previousGraph: ResourceGraph | null,
    nextGraph: ResourceGraph | null,
    plan: ResourceTransitionPlan | null,
    resourceHandles: ReadonlyMap<ResourceId, ResourceHandle>,
    instanceHandles: ReadonlyMap<ResourceId, InstanceHandle>,
  ): ResourceRealizationContext<ResourceHandle, InstanceHandle> {
    const retiredResources = this.#retired
    return Object.freeze({
      phase,
      previousGraph,
      nextGraph,
      plan,
      getResourceHandle: (id: ResourceId) => {
        if (resourceHandles.has(id)) return resourceHandles.get(id)
        const retired = retiredResources.find((entry) => entry.type === 'resource' && entry.node.id === id)
        return retired?.type === 'resource' ? retired.handle : undefined
      },
      getInstanceHandle: (id: ResourceId) => {
        if (instanceHandles.has(id)) return instanceHandles.get(id)
        const retired = retiredResources.find((entry) => entry.type === 'instance' && entry.node.id === id)
        return retired?.type === 'instance' ? retired.handle : undefined
      },
    })
  }

  async #flushRetiredInternal(): Promise<ResourceRealizationCleanupResult> {
    let removedInstances = 0
    let releasedResources = 0
    let issue: ResourceRealizationIssue | undefined

    while (this.#retired.length > 0) {
      const entry = this.#retired[0]!
      const phase: ResourceRealizationPhase = entry.type === 'instance' ? 'removeInstance' : 'release'
      const context = this.#context(phase, this.#graph, this.#graph, null, this.#resourceHandles, this.#instanceHandles)
      try {
        if (entry.type === 'instance') {
          await this.#hooks.removeInstance(entry.node, entry.handle, context)
          removedInstances += 1
        } else {
          await this.#hooks.release(entry.node, entry.handle, context)
          releasedResources += 1
        }
        this.#retired.shift()
      } catch (cause) {
        issue = Object.freeze({
          code: 'RESOURCE_REALIZATION_CLEANUP_FAILED',
          phase,
          resourceId: entry.node.id,
          message: `Cleanup hook failed for "${entry.node.id}": ${asErrorMessage(cause)}`,
          cause,
        })
        break
      }
    }

    return Object.freeze({
      removedInstances,
      releasedResources,
      pending: this.#retired.length,
      ...(issue ? { issue } : {}),
    })
  }

  /** Retry post-commit removals/releases that previously failed. */
  async flushRetired(): Promise<ResourceRealizationCleanupResult> {
    this.#assertReady()
    this.#busy = true
    try {
      return await this.#flushRetiredInternal()
    } finally {
      this.#busy = false
    }
  }

  async #rollback(
    previousGraph: ResourceGraph | null,
    nextGraph: ResourceGraph | null,
    plan: ResourceTransitionPlan,
    workingResources: Map<ResourceId, ResourceHandle>,
    workingInstances: Map<ResourceId, InstanceHandle>,
    stagedResourceIds: readonly ResourceId[],
    stagedInstanceIds: readonly ResourceId[],
    attemptedUpdates: readonly AttemptedUpdate<InstanceHandle>[],
  ): Promise<readonly ResourceRealizationIssue[]> {
    const issues: ResourceRealizationIssue[] = []

    for (const update of [...attemptedUpdates].reverse()) {
      const currentHandle = workingInstances.get(update.delta.id)
      if (currentHandle === undefined && !workingInstances.has(update.delta.id)) continue
      const reverse = reverseDelta(update.delta)
      try {
        const context = this.#context('rollback', previousGraph, nextGraph, plan, workingResources, workingInstances)
        const restored = await this.#hooks.updateInstance(reverse, currentHandle as InstanceHandle, context)
        if (restored !== undefined) workingInstances.set(update.delta.id, restored)
      } catch (cause) {
        issues.push(Object.freeze({
          code: 'RESOURCE_REALIZATION_ROLLBACK_FAILED',
          phase: 'rollback',
          resourceId: update.delta.id,
          message: `Could not roll back instance update for "${update.delta.id}": ${asErrorMessage(cause)}`,
          cause,
        }))
      }
    }

    for (const id of [...stagedInstanceIds].reverse()) {
      const node = requireNode(nextGraph, id, 'instance')
      const handle = workingInstances.get(id)
      if (handle === undefined && !workingInstances.has(id)) continue
      try {
        const context = this.#context('rollback', previousGraph, nextGraph, plan, workingResources, workingInstances)
        await this.#hooks.removeInstance(node, handle as InstanceHandle, context)
        workingInstances.delete(id)
      } catch (cause) {
        issues.push(Object.freeze({
          code: 'RESOURCE_REALIZATION_ROLLBACK_FAILED',
          phase: 'rollback',
          resourceId: id,
          message: `Could not roll back newly-created instance "${id}": ${asErrorMessage(cause)}`,
          cause,
        }))
      }
    }

    for (const id of [...stagedResourceIds].reverse()) {
      const node = requireNode(nextGraph, id, 'resource')
      const handle = workingResources.get(id)
      if (handle === undefined && !workingResources.has(id)) continue
      try {
        const context = this.#context('rollback', previousGraph, nextGraph, plan, workingResources, workingInstances)
        await this.#hooks.release(node, handle as ResourceHandle, context)
        workingResources.delete(id)
      } catch (cause) {
        issues.push(Object.freeze({
          code: 'RESOURCE_REALIZATION_ROLLBACK_FAILED',
          phase: 'rollback',
          resourceId: id,
          message: `Could not roll back newly-prepared resource "${id}": ${asErrorMessage(cause)}`,
          cause,
        }))
      }
    }

    return Object.freeze(issues)
  }

  /**
   * Realize `nextGraph` incrementally from the currently active graph.
   *
   * New allocations are staged before destructive cleanup. If prepare/create/
   * update fails, the realizer attempts to reverse successful instance updates,
   * remove staged instances, and release staged resources. Old resources are
   * retired only after the next graph becomes the active cache state.
   */
  async transition(nextGraph: ResourceGraph | null): Promise<ResourceRealizationResult> {
    this.#assertReady()
    this.#busy = true
    try {
      if (this.#retired.length > 0) {
        const pending = await this.#flushRetiredInternal()
        if (pending.issue) {
          throw realizationError(
            'RESOURCE_REALIZATION_CLEANUP_FAILED',
            pending.issue.phase,
            'Cannot start another transition while previous retired resources still require cleanup.',
            { resourceId: pending.issue.resourceId, cause: pending.issue.cause },
          )
        }
      }

      this.#assertCacheMatchesGraph()
      const previousGraph = this.#graph
      const plan = planResourceGraphTransition(previousGraph, nextGraph)
      if (plan.noOp) {
        return Object.freeze({
          previousKey: plan.previousKey,
          nextKey: plan.nextKey,
          noOp: true,
          committed: true,
          plan,
          cleanup: Object.freeze({ removedInstances: 0, releasedResources: 0, pending: 0 }),
          stats: Object.freeze({ prepared: 0, createdInstances: 0, updatedInstances: 0, removedInstances: 0, releasedResources: 0, reused: plan.reuse.length }),
        })
      }

      const workingResources = new Map(this.#resourceHandles)
      const workingInstances = new Map(this.#instanceHandles)
      const stagedResourceIds: ResourceId[] = []
      const stagedInstanceIds: ResourceId[] = []
      const attemptedUpdates: AttemptedUpdate<InstanceHandle>[] = []
      let operation: { phase: ResourceRealizationPhase; resourceId?: ResourceId } = { phase: 'validate' }

      try {
        for (const id of plan.compile) {
          operation = { phase: 'prepare', resourceId: id }
          const node = requireNode(nextGraph, id, 'resource')
          const context = this.#context('prepare', previousGraph, nextGraph, plan, workingResources, workingInstances)
          const handle = await this.#hooks.prepare(node, context)
          workingResources.set(id, handle)
          stagedResourceIds.push(id)
        }

        for (const id of plan.createInstances) {
          operation = { phase: 'createInstance', resourceId: id }
          const node = requireNode(nextGraph, id, 'instance')
          const context = this.#context('createInstance', previousGraph, nextGraph, plan, workingResources, workingInstances)
          const handle = await this.#hooks.createInstance(node, context)
          workingInstances.set(id, handle)
          stagedInstanceIds.push(id)
        }

        for (const delta of plan.updateInstances) {
          operation = { phase: 'updateInstance', resourceId: delta.id }
          const handle = workingInstances.get(delta.id)
          if (handle === undefined && !workingInstances.has(delta.id)) {
            throw realizationError(
              'RESOURCE_REALIZATION_STATE_MISMATCH',
              'updateInstance',
              `Stable instance "${delta.id}" has no active realization handle.`,
              { resourceId: delta.id },
            )
          }
          attemptedUpdates.push({ delta, handleBefore: handle as InstanceHandle })
          const context = this.#context('updateInstance', previousGraph, nextGraph, plan, workingResources, workingInstances)
          const updated = await this.#hooks.updateInstance(delta, handle as InstanceHandle, context)
          if (updated !== undefined) workingInstances.set(delta.id, updated)
        }
      } catch (cause) {
        const rollbackIssues = await this.#rollback(
          previousGraph,
          nextGraph,
          plan,
          workingResources,
          workingInstances,
          stagedResourceIds,
          stagedInstanceIds,
          attemptedUpdates,
        )

        // Instance rollback may legitimately replace the opaque handle while the
        // semantic previous graph remains active. Preserve those restored handles.
        for (const attempted of attemptedUpdates) {
          if (workingInstances.has(attempted.delta.id)) this.#instanceHandles.set(attempted.delta.id, workingInstances.get(attempted.delta.id) as InstanceHandle)
        }

        if (rollbackIssues.length > 0) {
          this.#faulted = true
          throw realizationError(
            'RESOURCE_REALIZATION_ROLLBACK_FAILED',
            'rollback',
            `Transition failed during ${operation.phase} and adapter rollback could not fully restore the previous realization state.`,
            { resourceId: operation.resourceId, cause, rollbackIssues },
          )
        }

        if (cause instanceof ResourceRealizationError) throw cause
        const code = operation.phase === 'prepare'
          ? 'RESOURCE_REALIZATION_PREPARE_FAILED'
          : operation.phase === 'createInstance'
            ? 'RESOURCE_REALIZATION_CREATE_FAILED'
            : operation.phase === 'updateInstance'
              ? 'RESOURCE_REALIZATION_UPDATE_FAILED'
              : 'RESOURCE_REALIZATION_STATE_MISMATCH'
        throw realizationError(
          code,
          operation.phase,
          `Resource realization hook failed during ${operation.phase}${operation.resourceId ? ` for "${operation.resourceId}"` : ''}: ${asErrorMessage(cause)}`,
          { resourceId: operation.resourceId, cause },
        )
      }

      // Commit the non-destructive next state first.
      for (const id of stagedResourceIds) this.#resourceHandles.set(id, workingResources.get(id) as ResourceHandle)
      for (const id of stagedInstanceIds) this.#instanceHandles.set(id, workingInstances.get(id) as InstanceHandle)
      for (const delta of plan.updateInstances) this.#instanceHandles.set(delta.id, workingInstances.get(delta.id) as InstanceHandle)

      // Move obsolete handles out of the active cache in the dependency-safe S10 order.
      for (const id of plan.removeInstances) {
        const node = requireNode(previousGraph, id, 'instance')
        if (!this.#instanceHandles.has(id)) {
          throw realizationError('RESOURCE_REALIZATION_STATE_MISMATCH', 'commit', `Removed instance "${id}" has no cached handle.`, { resourceId: id })
        }
        const handle = this.#instanceHandles.get(id) as InstanceHandle
        this.#instanceHandles.delete(id)
        this.#retired.push({ type: 'instance', node, handle })
      }
      for (const id of plan.release) {
        const node = requireNode(previousGraph, id, 'resource')
        if (!this.#resourceHandles.has(id)) {
          throw realizationError('RESOURCE_REALIZATION_STATE_MISMATCH', 'commit', `Released resource "${id}" has no cached handle.`, { resourceId: id })
        }
        const handle = this.#resourceHandles.get(id) as ResourceHandle
        this.#resourceHandles.delete(id)
        this.#retired.push({ type: 'resource', node, handle })
      }

      this.#graph = nextGraph
      const cleanup = await this.#flushRetiredInternal()

      return Object.freeze({
        previousKey: plan.previousKey,
        nextKey: plan.nextKey,
        noOp: false,
        committed: true,
        plan,
        cleanup,
        stats: Object.freeze({
          prepared: stagedResourceIds.length,
          createdInstances: stagedInstanceIds.length,
          updatedInstances: plan.updateInstances.length,
          removedInstances: cleanup.removedInstances,
          releasedResources: cleanup.releasedResources,
          reused: plan.reuse.length,
        }),
      })
    } finally {
      this.#busy = false
    }
  }

  /** Full-disposal shorthand. A cleanup failure is returned as pending retired work. */
  dispose(): Promise<ResourceRealizationResult> {
    return this.transition(null)
  }
}

export function createResourceRealizer<ResourceHandle = unknown, InstanceHandle = unknown>(
  hooks: ResourceRealizationHooks<ResourceHandle, InstanceHandle>,
): ResourceRealizer<ResourceHandle, InstanceHandle> {
  return new ResourceRealizer(hooks)
}
