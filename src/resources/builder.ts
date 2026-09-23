import type { AssetDefinition, MaterialDefinition } from '../core/types.js'
import { GeometryCompiler } from '../geometry/core/GeometryCompiler.js'
import type { ArchitectureDefinition, ArchitectureAssembly, ArchitectureTransform } from '../geometry/architecture/types.js'
import { lowerArchitecture } from '../geometry/architecture/index.js'
import { layoutGeometryArray } from '../geometry/modifiers/index.js'
import { layoutPathArray } from '../geometry/path-array/index.js'
import type { GeometryArrayDefinition, GeometryDefinition, PathArrayDefinition } from '../geometry/types/index.js'
import { hashGeometryDefinition } from '../geometry/core/hashGeometry.js'
import { hashResourceValue } from './hash.js'
import { ResourceGraph } from './graph.js'
import { resourceError } from './errors.js'
import { resolveResourceGraphLimits } from './limits.js'
import { normalizeAssetResourceDefinition, normalizeMaterialResourceDefinition, normalizeResourceFrame, normalizeResourceMaterialBindings, normalizeResourceMetadata, normalizeResourceTransform } from './normalize.js'
import type {
  ArchitectureResourceOptions, AssetResource, GeometryResource, InstanceResource, InstanceResourceInput,
  MaterialResource, ResourceGraphLimits, ResourceId, ResourceNode, ResourceTransform,
} from './types.js'

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/

function freezeDependencies(values: Iterable<ResourceId>): readonly ResourceId[] {
  return Object.freeze([...new Set(values)].sort())
}

function asTransform(transform: ArchitectureTransform | Partial<ResourceTransform> | undefined): ResourceTransform {
  return normalizeResourceTransform(transform)
}

function geometryChildren(definition: GeometryDefinition): readonly { field: string; definition: GeometryDefinition }[] {
  if (definition.kind === 'transform' || definition.kind === 'mirror' || definition.kind === 'noise' || definition.kind === 'bend' || definition.kind === 'twist' || definition.kind === 'taper') {
    const source = definition.source
    return source && typeof source === 'object' && !Array.isArray(source) ? [{ field: 'source', definition: source as GeometryDefinition }] : []
  }
  if (definition.kind === 'union' || definition.kind === 'subtract' || definition.kind === 'intersect') {
    const result: { field: string; definition: GeometryDefinition }[] = []
    if (definition.left && typeof definition.left === 'object' && !Array.isArray(definition.left)) result.push({ field: 'left', definition: definition.left as GeometryDefinition })
    if (definition.right && typeof definition.right === 'object' && !Array.isArray(definition.right)) result.push({ field: 'right', definition: definition.right as GeometryDefinition })
    return result
  }
  return []
}

export interface ResourceGraphBuilderOptions {
  limits?: Partial<ResourceGraphLimits>
  geometryCompiler?: GeometryCompiler
}

export class ResourceGraphBuilder {
  readonly #nodes = new Map<ResourceId, ResourceNode>()
  readonly #limits: ResourceGraphLimits
  readonly #geometryCompiler: GeometryCompiler
  #instanceCount = 0

  constructor(options: ResourceGraphBuilderOptions = {}) {
    this.#limits = resolveResourceGraphLimits(options.limits)
    this.#geometryCompiler = options.geometryCompiler ?? new GeometryCompiler()
  }

  get size(): number { return this.#nodes.size }

  #assertRoom(additionalNodes = 1): void {
    if (this.#nodes.size + additionalNodes > this.#limits.maxResources) {
      resourceError({ code: 'RESOURCE_LIMIT', path: '/nodes', message: `Resource graph exceeds maxResources ${this.#limits.maxResources}.` })
    }
  }

  #add(node: ResourceNode): ResourceId {
    const existing = this.#nodes.get(node.id)
    if (existing) {
      if (existing.kind !== node.kind || existing.key !== node.key || JSON.stringify(existing) !== JSON.stringify(node)) {
        resourceError({ code: 'RESOURCE_ID_CONFLICT', path: `/nodes/${node.id}`, message: `Resource id "${node.id}" resolves to different content.` })
      }
      return node.id
    }
    this.#assertRoom()
    this.#nodes.set(node.id, node)
    return node.id
  }

  addGeometry(definition: unknown): ResourceId {
    const normalized = this.#geometryCompiler.normalize(definition)
    const childIds = geometryChildren(normalized).map((child) => this.addGeometry(child.definition))
    const key = hashGeometryDefinition(normalized)
    const id = `geometry:${key}`
    const resource: GeometryResource = Object.freeze({
      id, kind: 'geometry', key,
      dependencies: freezeDependencies(childIds),
      definition: normalized,
    })
    return this.#add(resource)
  }

  addAsset(definition: AssetDefinition, options: { dependencies?: readonly ResourceId[] } = {}): ResourceId {
    const normalized = normalizeAssetResourceDefinition(definition)
    const dependencies = freezeDependencies(options.dependencies ?? [])
    const key = hashResourceValue('a1', { definition: normalized, dependencies })
    const id = `asset:${key}`
    const resource: AssetResource = Object.freeze({ id, kind: 'asset', key, dependencies, assetDependencies: dependencies, definition: normalized })
    return this.#add(resource)
  }

  addMaterial(definition: MaterialDefinition = {}, options: { assets?: readonly ResourceId[] } = {}): ResourceId {
    const normalized = normalizeMaterialResourceDefinition(definition)
    const assets = freezeDependencies(options.assets ?? [])
    const key = hashResourceValue('m1', { definition: normalized, assets })
    const id = `material:${key}`
    const resource: MaterialResource = Object.freeze({ id, kind: 'material', key, dependencies: assets, assetDependencies: assets, definition: normalized })
    return this.#add(resource)
  }

  addInstance(input: InstanceResourceInput): ResourceId {
    if (!INSTANCE_ID_PATTERN.test(input.id)) resourceError({ code: 'RESOURCE_ID_INVALID', path: '/instance/id', message: `Instance id "${input.id}" must match ${INSTANCE_ID_PATTERN}.` })
    const resourceId = `instance:${input.id}`
    if (!this.#nodes.has(resourceId) && ++this.#instanceCount > this.#limits.maxInstances) resourceError({ code: 'RESOURCE_LIMIT', path: '/instances', message: `Resource graph exceeds maxInstances ${this.#limits.maxInstances}.` })
    const materials = freezeDependencies(input.materials ?? [])
    const materialBindings = normalizeResourceMaterialBindings(input.materialBindings)
    const bindingMaterials = materialBindings ? Object.values(materialBindings) : []
    const transform = normalizeResourceTransform(input.transform)
    const frame = normalizeResourceFrame(input.frame)
    const metadata = normalizeResourceMetadata(input.metadata)
    const key = hashResourceValue('i1', { source: input.source, materials, ...(materialBindings ? { materialBindings } : {}), transform, ...(frame ? { frame } : {}), ...(metadata ? { metadata } : {}) })
    const id = resourceId
    const dependencies = freezeDependencies([input.source, ...materials, ...bindingMaterials])
    const resource: InstanceResource = Object.freeze({
      id, kind: 'instance', key, dependencies,
      instanceId: input.id, source: input.source, materials, ...(materialBindings ? { materialBindings } : {}), transform,
      ...(frame ? { frame } : {}),
      ...(metadata ? { metadata } : {}),
    })
    return this.#add(resource)
  }

  addGeometryInstance(id: string, geometry: GeometryDefinition, options: { materials?: readonly ResourceId[]; materialBindings?: InstanceResourceInput['materialBindings']; transform?: Partial<ResourceTransform>; metadata?: InstanceResourceInput['metadata'] } = {}): ResourceId {
    const source = this.addGeometry(geometry)
    return this.addInstance({ id, source, materials: options.materials, materialBindings: options.materialBindings, transform: options.transform, metadata: options.metadata })
  }

  addAssetInstance(id: string, asset: AssetDefinition | ResourceId, options: { materials?: readonly ResourceId[]; materialBindings?: InstanceResourceInput['materialBindings']; transform?: Partial<ResourceTransform>; metadata?: InstanceResourceInput['metadata'] } = {}): ResourceId {
    const source = typeof asset === 'string' ? asset : this.addAsset(asset)
    return this.addInstance({ id, source, materials: options.materials, materialBindings: options.materialBindings, transform: options.transform, metadata: options.metadata })
  }

  addGeometryArray(definition: GeometryArrayDefinition, options: { idPrefix: string; materials?: readonly ResourceId[]; materialBindings?: InstanceResourceInput['materialBindings'] } ): readonly ResourceId[] {
    const layout = layoutGeometryArray(definition)
    const source = this.addGeometry(layout.source)
    return Object.freeze(layout.placements.map((placement) => this.addInstance({
      id: `${options.idPrefix}/${placement.index}`,
      source,
      materials: options.materials,
      materialBindings: options.materialBindings,
      transform: placement,
    })))
  }

  addPathArray(sourceDefinition: GeometryDefinition, definition: PathArrayDefinition, options: { idPrefix: string; materials?: readonly ResourceId[]; materialBindings?: InstanceResourceInput['materialBindings']; scale?: readonly [number, number, number] }): readonly ResourceId[] {
    const layout = layoutPathArray(definition)
    const source = this.addGeometry(sourceDefinition)
    return Object.freeze(layout.placements.map((placement, index) => this.addInstance({
      id: `${options.idPrefix}/${index}`,
      source,
      materials: options.materials,
      materialBindings: options.materialBindings,
      transform: { position: placement.position, rotation: [0, 0, 0], scale: options.scale ?? [1, 1, 1] },
      ...(placement.tangent && placement.normal && placement.binormal ? { frame: { tangent: placement.tangent, normal: placement.normal, binormal: placement.binormal } } : {}),
      metadata: { pathDistance: placement.distance },
    })))
  }

  addArchitecture(definition: ArchitectureDefinition, options: ArchitectureResourceOptions = {}): { assembly: ArchitectureAssembly; instances: readonly ResourceId[] } {
    const assembly = lowerArchitecture(definition)
    const assemblyKey = hashResourceValue('c1', definition)
    const prefix = definition.id ? `architecture/${definition.id}` : `architecture/${assemblyKey}`
    const materialCache = new Map<string, ResourceId>()
    const materialFor = (role: string): readonly ResourceId[] => {
      const material = options.materialsByRole?.[role]
      if (!material) return Object.freeze([])
      let id = materialCache.get(role)
      if (!id) { id = this.addMaterial(material); materialCache.set(role, id) }
      return Object.freeze([id])
    }
    const instances: ResourceId[] = []
    for (const part of assembly.parts) {
      instances.push(this.addGeometryInstance(`${prefix}/${part.id}`, part.geometry, { transform: asTransform(part.transform), materials: materialFor(part.role), metadata: { architectureRole: part.role } }))
    }
    for (const group of assembly.instanceGroups) {
      const source = this.addGeometry(group.geometry)
      const materials = materialFor(group.role)
      for (const placement of group.placements) {
        instances.push(this.addInstance({
          id: `${prefix}/${group.id}/${placement.index}`,
          source, materials,
          transform: placement,
          metadata: { architectureRole: group.role, instanceGroup: group.id },
        }))
      }
    }
    return Object.freeze({ assembly, instances: Object.freeze(instances) })
  }

  build(): ResourceGraph {
    let edges = 0
    for (const node of this.#nodes.values()) edges += node.dependencies.length
    if (edges > this.#limits.maxEdges) resourceError({ code: 'RESOURCE_LIMIT', path: '/edges', message: `Resource graph exceeds maxEdges ${this.#limits.maxEdges}.` })
    return new ResourceGraph(this.#nodes.values())
  }
}

export function createResourceGraphBuilder(options: ResourceGraphBuilderOptions = {}): ResourceGraphBuilder {
  return new ResourceGraphBuilder(options)
}
