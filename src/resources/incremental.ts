import { ResourceGraph } from './graph.js'
import { canonicalResourceString } from './hash.js'
import { resourceError } from './errors.js'
import type {
  InstanceDeltaField,
  InstanceDeltaKind,
  InstanceResource,
  InstanceResourceDelta,
  ResourceGraphDiff,
  ResourceId,
  ResourceNode,
  ResourceTransitionPlan,
} from './types.js'

function nodeMap(graph: ResourceGraph | null): Map<ResourceId, ResourceNode> {
  return new Map((graph?.list() ?? []).map((node) => [node.id, node]))
}

function topologicalOrder(graph: ResourceGraph | null): readonly ResourceId[] {
  return graph?.snapshot().topologicalOrder ?? Object.freeze([])
}

function orderedFrom(graph: ResourceGraph | null, ids: ReadonlySet<ResourceId>, reverse = false): readonly ResourceId[] {
  const order = topologicalOrder(graph)
  const values = order.filter((id) => ids.has(id))
  if (reverse) values.reverse()
  return Object.freeze(values)
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalResourceString(left) === canonicalResourceString(right)
}

function arrayEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function tupleEqual(left: readonly number[] | undefined, right: readonly number[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return arrayEqual(left, right)
}

function transformEqual(left: InstanceResource['transform'], right: InstanceResource['transform']): boolean {
  return tupleEqual(left.position, right.position) && tupleEqual(left.rotation, right.rotation) && tupleEqual(left.scale, right.scale)
}

function frameEqual(left: InstanceResource['frame'], right: InstanceResource['frame']): boolean {
  if (left === undefined || right === undefined) return left === right
  return tupleEqual(left.tangent, right.tangent) && tupleEqual(left.normal, right.normal) && tupleEqual(left.binormal, right.binormal)
}

function classifyInstanceDelta(previous: InstanceResource, next: InstanceResource): InstanceResourceDelta {
  const fields: InstanceDeltaField[] = []
  if (previous.source !== next.source) fields.push('source')
  if (!arrayEqual(previous.materials, next.materials) || !sameJson(previous.materialBindings ?? null, next.materialBindings ?? null)) fields.push('materials')
  if (!transformEqual(previous.transform, next.transform)) fields.push('transform')
  if (!frameEqual(previous.frame, next.frame)) fields.push('frame')
  if (!sameJson(previous.metadata ?? null, next.metadata ?? null)) fields.push('metadata')

  if (fields.length === 0) {
    resourceError({
      code: 'RESOURCE_DIFF_IDENTITY_MISMATCH',
      path: `/nodes/${next.id}`,
      message: `Instance resource "${next.id}" changed content key without a detectable authored field delta.`,
      suggestion: 'Rebuild the instance through ResourceGraphBuilder so its content key matches source/material/materialBindings/transform/frame/metadata state.',
    })
  }

  const kind: InstanceDeltaKind = fields.length === 1 ? fields[0]! : 'composite'
  return Object.freeze({
    id: next.id,
    instanceId: next.instanceId,
    kind,
    fields: Object.freeze(fields),
    previous,
    next,
  })
}

function assertSharedIdentity(previous: ResourceNode, next: ResourceNode): void {
  if (previous.kind !== next.kind) {
    resourceError({
      code: 'RESOURCE_DIFF_IDENTITY_MISMATCH',
      path: `/nodes/${next.id}`,
      message: `Resource "${next.id}" changed kind from ${previous.kind} to ${next.kind}.`,
      suggestion: 'Use a new content-addressed resource id when resource kind changes.',
    })
  }

  if (previous.kind !== 'instance' && previous.key !== next.key) {
    resourceError({
      code: 'RESOURCE_DIFF_IDENTITY_MISMATCH',
      path: `/nodes/${next.id}`,
      message: `Content-addressed resource "${next.id}" changed key from ${previous.key} to ${next.key}.`,
      suggestion: 'Geometry, material, and asset resources are immutable by id; add the changed content as a new resource instead.',
    })
  }

  if (previous.key === next.key && !sameJson(previous, next)) {
    resourceError({
      code: 'RESOURCE_DIFF_IDENTITY_MISMATCH',
      path: `/nodes/${next.id}`,
      message: `Resource "${next.id}" has the same content key but different canonical content.`,
      suggestion: 'Rebuild resource keys from canonical content; do not reuse a key for different resource data.',
    })
  }
}

/**
 * Deterministically compare two renderer-neutral resource graphs.
 *
 * Content-addressed resources are immutable by id. Semantic instances may keep
 * their id while changing source/material/transform/frame/metadata, producing an
 * in-place instance delta rather than remove+create churn.
 */
export function diffResourceGraphs(previous: ResourceGraph | null, next: ResourceGraph | null): ResourceGraphDiff {
  const previousNodes = nodeMap(previous)
  const nextNodes = nodeMap(next)
  const added = new Set<ResourceId>()
  const removed = new Set<ResourceId>()
  const reused = new Set<ResourceId>()
  const updatedInstances = new Map<ResourceId, InstanceResourceDelta>()

  for (const [id, nextNode] of nextNodes) {
    const previousNode = previousNodes.get(id)
    if (!previousNode) {
      added.add(id)
      continue
    }
    assertSharedIdentity(previousNode, nextNode)
    if (previousNode.key === nextNode.key) {
      reused.add(id)
      continue
    }
    if (previousNode.kind !== 'instance' || nextNode.kind !== 'instance') {
      // Non-instance key changes are rejected by assertSharedIdentity above.
      resourceError({ code: 'RESOURCE_DIFF_IDENTITY_MISMATCH', path: `/nodes/${id}`, message: `Only instance resources may update in place.` })
    }
    updatedInstances.set(id, classifyInstanceDelta(previousNode, nextNode))
  }

  for (const id of previousNodes.keys()) if (!nextNodes.has(id)) removed.add(id)

  const addedOrder = orderedFrom(next, added)
  const removedOrder = orderedFrom(previous, removed)
  const reusedOrder = orderedFrom(next, reused)
  const updateOrder = topologicalOrder(next)
    .filter((id) => updatedInstances.has(id))
    .map((id) => updatedInstances.get(id)!)

  return Object.freeze({
    previousKey: previous?.key ?? null,
    nextKey: next?.key ?? null,
    added: addedOrder,
    removed: removedOrder,
    reused: reusedOrder,
    instanceUpdates: Object.freeze(updateOrder),
  })
}

/**
 * Build a dependency-safe transition plan without performing compilation,
 * renderer allocation, or release side effects.
 */
export function planResourceGraphTransition(previous: ResourceGraph | null, next: ResourceGraph | null): ResourceTransitionPlan {
  const diff = diffResourceGraphs(previous, next)
  const previousNodes = nodeMap(previous)
  const nextNodes = nodeMap(next)
  const removedSet = new Set(diff.removed)

  const compile = Object.freeze(diff.added.filter((id) => nextNodes.get(id)?.kind !== 'instance'))
  const createInstances = Object.freeze(diff.added.filter((id) => nextNodes.get(id)?.kind === 'instance'))
  const invalidate = Object.freeze(diff.instanceUpdates.map((delta) => delta.id))

  // Release in previous dependents-first order so instances/materials/parents stop
  // consuming a resource before the dependency itself is released.
  const releaseOrder = orderedFrom(previous, removedSet, true)
  const removeInstances = Object.freeze(releaseOrder.filter((id) => previousNodes.get(id)?.kind === 'instance'))
  const release = Object.freeze(releaseOrder.filter((id) => previousNodes.get(id)?.kind !== 'instance'))

  const actionCount = compile.length + createInstances.length + diff.instanceUpdates.length + removeInstances.length + release.length

  return Object.freeze({
    previousKey: diff.previousKey,
    nextKey: diff.nextKey,
    noOp: actionCount === 0,
    reuse: diff.reused,
    compile,
    createInstances,
    invalidate,
    updateInstances: diff.instanceUpdates,
    removeInstances,
    release,
    stats: Object.freeze({
      reused: diff.reused.length,
      compile: compile.length,
      createInstances: createInstances.length,
      updateInstances: diff.instanceUpdates.length,
      removeInstances: removeInstances.length,
      release: release.length,
      actions: actionCount,
    }),
  })
}
