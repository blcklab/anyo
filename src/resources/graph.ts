import { hashResourceValue } from './hash.js'
import { ResourceGraphError, resourceError } from './errors.js'
import type { ResourceDependencyEdge, ResourceGraphSnapshot, ResourceId, ResourceNode } from './types.js'

function sortedUnique(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].sort())
}

function nodeDependencies(node: ResourceNode): readonly string[] {
  return node.dependencies
}

function validateReferenceKinds(nodes: ReadonlyMap<ResourceId, ResourceNode>): void {
  const issues: import('./types.js').ResourceIssue[] = []
  for (const node of nodes.values()) {
    for (const dependency of node.dependencies) {
      if (!nodes.has(dependency)) {
        issues.push({
          code: 'RESOURCE_REFERENCE_MISSING', path: `/nodes/${node.id}/dependencies`,
          message: `Resource "${node.id}" references missing dependency "${dependency}".`,
          suggestion: 'Register the dependency before building the graph or remove the stale reference.',
        })
      }
    }
    if (node.kind === 'material') {
      for (const id of node.assetDependencies) if (nodes.get(id)?.kind !== 'asset') issues.push({ code: 'RESOURCE_REFERENCE_INVALID', path: `/nodes/${node.id}/assetDependencies`, message: `Material dependency "${id}" must reference an asset resource.` })
    } else if (node.kind === 'asset') {
      for (const id of node.assetDependencies) if (nodes.get(id)?.kind !== 'asset') issues.push({ code: 'RESOURCE_REFERENCE_INVALID', path: `/nodes/${node.id}/assetDependencies`, message: `Asset dependency "${id}" must reference another asset resource.` })
    } else if (node.kind === 'geometry') {
      for (const id of node.dependencies) if (nodes.get(id)?.kind !== 'geometry') issues.push({ code: 'RESOURCE_REFERENCE_INVALID', path: `/nodes/${node.id}/dependencies`, message: `Geometry dependency "${id}" must reference a geometry resource.` })
    } else if (node.kind === 'instance') {
      const sourceKind = nodes.get(node.source)?.kind
      if (sourceKind !== 'geometry' && sourceKind !== 'asset') issues.push({ code: 'RESOURCE_REFERENCE_INVALID', path: `/nodes/${node.id}/source`, message: `Instance source "${node.source}" must reference geometry or asset.` })
      for (const id of node.materials) if (nodes.get(id)?.kind !== 'material') issues.push({ code: 'RESOURCE_REFERENCE_INVALID', path: `/nodes/${node.id}/materials`, message: `Instance material "${id}" must reference a material resource.` })
      for (const [name, id] of Object.entries(node.materialBindings ?? {})) if (nodes.get(id)?.kind !== 'material') issues.push({ code: 'RESOURCE_REFERENCE_INVALID', path: `/nodes/${node.id}/materialBindings/${name}`, message: `Instance material binding "${name}" must reference a material resource.` })
    }
  }
  if (issues.length > 0) throw new ResourceGraphError(issues)
}

function topological(nodes: ReadonlyMap<ResourceId, ResourceNode>): readonly ResourceId[] {
  const indegree = new Map<ResourceId, number>()
  const dependents = new Map<ResourceId, Set<ResourceId>>()
  for (const [id, node] of nodes) {
    indegree.set(id, nodeDependencies(node).length)
    for (const dep of nodeDependencies(node)) {
      let set = dependents.get(dep)
      if (!set) dependents.set(dep, set = new Set())
      set.add(id)
    }
  }
  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort()
  const result: ResourceId[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    result.push(id)
    for (const dependent of [...(dependents.get(id) ?? [])].sort()) {
      const next = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, next)
      if (next === 0) {
        const at = ready.findIndex((candidate) => candidate > dependent)
        if (at < 0) ready.push(dependent)
        else ready.splice(at, 0, dependent)
      }
    }
  }
  if (result.length !== nodes.size) {
    const cycle = [...indegree.entries()].filter(([, degree]) => degree > 0).map(([id]) => id).sort()
    resourceError({
      code: 'RESOURCE_CYCLE', path: '/nodes',
      message: `Resource dependency cycle detected among: ${cycle.join(', ')}.`,
      suggestion: 'Keep resource dependencies acyclic; references should flow assets/geometry/materials -> instances, not back to their dependents.',
    })
  }
  return Object.freeze(result)
}

export class ResourceGraph {
  readonly #nodes: ReadonlyMap<ResourceId, ResourceNode>
  readonly #topological: readonly ResourceId[]
  readonly #dependents: ReadonlyMap<ResourceId, readonly ResourceId[]>
  readonly #edges: readonly ResourceDependencyEdge[]
  readonly #key: string

  constructor(inputNodes: Iterable<ResourceNode>) {
    const map = new Map<ResourceId, ResourceNode>()
    for (const node of inputNodes) {
      if (map.has(node.id)) resourceError({ code: 'RESOURCE_ID_CONFLICT', path: `/nodes/${node.id}`, message: `Duplicate resource id "${node.id}".` })
      map.set(node.id, node)
    }
    validateReferenceKinds(map)
    this.#topological = topological(map)
    const dependentSets = new Map<ResourceId, Set<ResourceId>>()
    const edges: ResourceDependencyEdge[] = []
    for (const node of map.values()) {
      for (const dependency of node.dependencies) {
        edges.push(Object.freeze({ dependency, dependent: node.id }))
        let set = dependentSets.get(dependency)
        if (!set) dependentSets.set(dependency, set = new Set())
        set.add(node.id)
      }
    }
    edges.sort((a, b) => a.dependency.localeCompare(b.dependency) || a.dependent.localeCompare(b.dependent))
    const dependents = new Map<ResourceId, readonly ResourceId[]>()
    for (const id of map.keys()) dependents.set(id, sortedUnique(dependentSets.get(id) ?? []))
    this.#nodes = map
    this.#dependents = dependents
    this.#edges = Object.freeze(edges)
    this.#key = hashResourceValue('rg1', this.#topological.map((id) => map.get(id)))
  }

  get key(): string { return this.#key }
  get size(): number { return this.#nodes.size }
  get(id: ResourceId): ResourceNode | undefined { return this.#nodes.get(id) }
  has(id: ResourceId): boolean { return this.#nodes.has(id) }

  list(kind?: ResourceNode['kind']): readonly ResourceNode[] {
    return Object.freeze(this.#topological.map((id) => this.#nodes.get(id)!).filter((node) => !kind || node.kind === kind))
  }

  dependenciesOf(id: ResourceId, options: { transitive?: boolean } = {}): readonly ResourceId[] {
    const node = this.#nodes.get(id)
    if (!node) return Object.freeze([])
    if (!options.transitive) return node.dependencies
    const seen = new Set<ResourceId>()
    const visit = (current: ResourceId) => {
      for (const dependency of this.#nodes.get(current)?.dependencies ?? []) {
        if (seen.has(dependency)) continue
        seen.add(dependency)
        visit(dependency)
      }
    }
    visit(id)
    return Object.freeze(this.#topological.filter((candidate) => seen.has(candidate)))
  }

  dependentsOf(id: ResourceId, options: { transitive?: boolean } = {}): readonly ResourceId[] {
    if (!this.#nodes.has(id)) return Object.freeze([])
    if (!options.transitive) return this.#dependents.get(id) ?? Object.freeze([])
    const seen = new Set<ResourceId>()
    const queue = [...(this.#dependents.get(id) ?? [])]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (seen.has(current)) continue
      seen.add(current)
      queue.push(...(this.#dependents.get(current) ?? []))
    }
    return Object.freeze(this.#topological.filter((candidate) => seen.has(candidate)))
  }

  /** Dependencies-first invalidation plan for changed resources and everything that consumes them. */
  invalidationSet(changed: Iterable<ResourceId>, options: { includeChanged?: boolean } = {}): readonly ResourceId[] {
    const includeChanged = options.includeChanged ?? true
    const impacted = new Set<ResourceId>()
    for (const id of changed) {
      if (!this.#nodes.has(id)) resourceError({ code: 'RESOURCE_REFERENCE_MISSING', path: '/changed', message: `Cannot invalidate unknown resource "${id}".` })
      if (includeChanged) impacted.add(id)
      for (const dependent of this.dependentsOf(id, { transitive: true })) impacted.add(dependent)
    }
    return Object.freeze(this.#topological.filter((id) => impacted.has(id)))
  }

  snapshot(): ResourceGraphSnapshot {
    return Object.freeze({
      key: this.#key,
      nodes: this.list(),
      edges: this.#edges,
      topologicalOrder: this.#topological,
    })
  }
}
