import {
  Euler,
  Geometry,
  Mesh,
  Quaternion,
  Scene,
  StandardMaterial,
  Texture,
  type Material,
  type Node,
  type TextureLoadOptions,
} from '@blcklab/sekai64'
import { GeometryCompiler } from '../geometry/core/GeometryCompiler.js'
import { createResourceRealizer, type ResourceRealizer } from '../resources/realization.js'
import type { ResourceGraph } from '../resources/graph.js'
import type { Sekai64Renderer, Sekai64RendererNativeAccess } from './Sekai64Renderer.js'
import type {
  AssetResource,
  InstanceResource,
  InstanceResourceDelta,
  MaterialResource,
  RealizableResource,
  ResourceFrame,
  ResourceId,
  ResourceRealizationContext,
  ResourceRealizationResult,
  ResourceRealizationSnapshot,
} from '../resources/types.js'

export type Sekai64RealizedResource =
  | { readonly kind: 'geometry'; readonly value: Geometry }
  | { readonly kind: 'material'; readonly value: Material }
  | { readonly kind: 'asset'; readonly value: unknown }

export interface Sekai64InstanceHandle {
  readonly node: Node
  readonly unregister?: () => void
}

export interface Sekai64AssetPrepareContext {
  readonly resource: AssetResource
  readonly realization: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>
}

export interface Sekai64AssetInstanceContext {
  readonly instance: InstanceResource
  readonly resource: AssetResource
  readonly prepared: unknown
  readonly realization: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>
}

export interface Sekai64ResourceAdapterOptions {
  readonly scene: Scene
  readonly geometryCompiler?: GeometryCompiler
  readonly defaultMaterial?: Material
  /** When true, dispose the supplied default material with the adapter. Defaults to false. */
  readonly ownsDefaultMaterial?: boolean
  readonly textureLoadOptions?: TextureLoadOptions
  /** Resolve authored material texture aliases to one of the material's explicit asset dependencies. */
  readonly resolveMaterialAsset?: (
    reference: string,
    material: MaterialResource,
    candidates: readonly AssetResource[],
  ) => ResourceId | undefined
  /** Optional preparation hook for non-texture assets. */
  readonly prepareAsset?: (context: Sekai64AssetPrepareContext) => unknown | Promise<unknown>
  /** Optional instance factory for AssetResource-backed semantic instances (for example glTF/VRM). */
  readonly createAssetInstance?: (context: Sekai64AssetInstanceContext) => Node | Promise<Node>
  /** Optional release hook for custom prepared asset values. */
  readonly releaseAsset?: (resource: AssetResource, prepared: unknown) => void | Promise<void>
  /** Optional picking/identity registration for newly-created native nodes. */
  readonly registerInstanceNode?: (instance: InstanceResource, node: Node) => (() => void) | void
}

export class Sekai64ResourceAdapterError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'Sekai64ResourceAdapterError'
  }
}

/**
 * S11 realization adapter for Sekai64.
 *
 * This class intentionally lives in the optional renderer-sekai64 subpath: Anyo
 * Core stays renderer-neutral and Sekai64 does not depend back on Anyo.
 */
export class Sekai64ResourceAdapter {
  readonly #scene: Scene
  readonly #compiler: GeometryCompiler
  readonly #defaultMaterial: Material
  readonly #ownsDefaultMaterial: boolean
  readonly #options: Sekai64ResourceAdapterOptions
  readonly #realizer: ResourceRealizer<Sekai64RealizedResource, Sekai64InstanceHandle>
  #disposed = false

  constructor(options: Sekai64ResourceAdapterOptions) {
    this.#options = options
    this.#scene = options.scene
    this.#compiler = options.geometryCompiler ?? new GeometryCompiler()
    this.#defaultMaterial = options.defaultMaterial ?? new StandardMaterial({ label: 'anyo:resource-default', baseColor: '#ffffff', roughness: 1, metallic: 0 })
    this.#ownsDefaultMaterial = options.defaultMaterial ? (options.ownsDefaultMaterial ?? false) : true
    this.#realizer = createResourceRealizer({
      prepare: (resource, context) => this.#prepare(resource, context),
      createInstance: (instance, context) => this.#createInstance(instance, context),
      updateInstance: (delta, handle, context) => this.#updateInstance(delta, handle, context),
      removeInstance: (_instance, handle) => { handle.unregister?.(); handle.node.dispose() },
      release: (resource, handle) => this.#release(resource, handle),
    })
  }

  get graph(): ResourceGraph | null { return this.#realizer.graph }
  get graphKey(): string | null { return this.#realizer.graphKey }
  get faulted(): boolean { return this.#realizer.faulted }
  get resourceCount(): number { return this.#realizer.resourceCount }
  get instanceCount(): number { return this.#realizer.instanceCount }
  get retiredCount(): number { return this.#realizer.retiredCount }
  getResourceHandle(id: ResourceId): Sekai64RealizedResource | undefined { return this.#realizer.getResourceHandle(id) }
  getInstanceHandle(id: ResourceId): Sekai64InstanceHandle | undefined { return this.#realizer.getInstanceHandle(id) }
  snapshot(): ResourceRealizationSnapshot { return this.#realizer.snapshot() }

  async transition(nextGraph: ResourceGraph | null): Promise<ResourceRealizationResult> {
    this.#assertAlive()
    return this.#realizer.transition(nextGraph)
  }

  async flushRetired() {
    this.#assertAlive()
    return this.#realizer.flushRetired()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    await this.#realizer.dispose()
    if (this.#ownsDefaultMaterial) this.#defaultMaterial.dispose()
    this.#disposed = true
  }

  async #prepare(
    resource: RealizableResource,
    context: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>,
  ): Promise<Sekai64RealizedResource> {
    if (resource.kind === 'geometry') {
      const mesh = this.#compiler.compile(resource.definition)
      return {
        kind: 'geometry',
        value: new Geometry({
          positions: mesh.positions,
          indices: mesh.indices,
          ...(mesh.normals ? { normals: mesh.normals } : {}),
          ...(mesh.uvs ? { uvs: mesh.uvs } : {}),
          ...(mesh.colors ? { colors: mesh.colors } : {}),
          ...(mesh.tangents ? { tangents: mesh.tangents } : {}),
          ...(mesh.groups ? { groups: mesh.groups } : {}),
        }, resource.id),
      }
    }
    if (resource.kind === 'material') {
      return { kind: 'material', value: this.#createMaterial(resource, context) }
    }
    return { kind: 'asset', value: await this.#prepareAsset(resource, context) }
  }

  async #prepareAsset(
    resource: AssetResource,
    context: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>,
  ): Promise<unknown> {
    const type = resource.definition.type ?? inferAssetType(resource.definition.src)
    if (type === 'texture' || type === 'image') {
      if (typeof resource.definition.src !== 'string') {
        throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_ASSET_SOURCE_UNRESOLVED', `Asset ${resource.id} must resolve src to a string before Sekai64 realization.`)
      }
      const texture = new Texture({
        source: resource.definition.src,
        label: resource.id,
        colorSpace: resource.definition.colorSpace === 'linear' ? 'linear' : 'srgb',
        generateMipmaps: true,
      })
      try {
        await texture.load(this.#options.textureLoadOptions)
        return texture
      } catch (error) {
        texture.dispose()
        throw error
      }
    }
    if (this.#options.prepareAsset) return this.#options.prepareAsset({ resource, realization: context })
    throw new Sekai64ResourceAdapterError(
      'SEKAI64_RESOURCE_ASSET_UNSUPPORTED',
      `Sekai64 resource realization does not have a built-in preparer for asset type "${type}" (${resource.id}). Provide prepareAsset/createAssetInstance hooks for model or custom assets.`,
    )
  }

  #createMaterial(
    resource: MaterialResource,
    context: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>,
  ): Material {
    const definition = resource.definition
    const texture = (reference: string | undefined): Texture | undefined => {
      if (!reference) return undefined
      const assetId = this.#resolveMaterialAsset(reference, resource, context)
      if (!assetId) {
        throw new Sekai64ResourceAdapterError(
          'SEKAI64_RESOURCE_TEXTURE_BINDING_MISSING',
          `Material ${resource.id} texture reference "${reference}" cannot be mapped to an explicit AssetResource dependency.`,
        )
      }
      const handle = context.getResourceHandle(assetId)
      if (!handle || handle.kind !== 'asset' || !(handle.value instanceof Texture)) {
        throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_TEXTURE_INVALID', `Material ${resource.id} dependency ${assetId} is not a realized Sekai64 Texture.`)
      }
      return handle.value
    }
    return new StandardMaterial({
      label: resource.id,
      baseColor: definition.baseColor,
      baseColorTexture: texture(definition.baseColorTexture),
      metallicRoughnessTexture: texture(definition.metallicRoughnessTexture),
      metallicTexture: texture(definition.metalnessTexture),
      roughnessTexture: texture(definition.roughnessTexture),
      normalTexture: texture(definition.normalTexture),
      emissiveTexture: texture(definition.emissiveTexture),
      occlusionTexture: texture(definition.occlusionTexture),
      lightMapTexture: texture(definition.lightMapTexture),
      metallic: definition.metalness,
      roughness: definition.roughness,
      normalScale: definition.normalScale,
      emissive: definition.emissive,
      emissiveIntensity: definition.emissiveIntensity,
      occlusionStrength: definition.occlusionStrength,
      detail: definition.detail ? {
        ...definition.detail,
        normalTexture: texture(definition.detail.normalTexture),
        roughnessTexture: texture(definition.detail.roughnessTexture),
        heightTexture: texture(definition.detail.heightTexture),
      } : undefined,
      textureTransform: definition.textureTransform,
      textureWrap: definition.textureWrap,
      lightMapTexCoord: definition.lightMapTexCoord,
      lightMapIntensity: definition.lightMapIntensity,
      specularFactor: definition.specularFactor,
      specularColor: definition.specularColor,
      clearcoat: definition.clearcoat,
      clearcoatRoughness: definition.clearcoatRoughness,
      sheenColor: definition.sheenColor,
      sheenIntensity: definition.sheenIntensity,
      sheenRoughness: definition.sheenRoughness,
      transmission: definition.transmission,
      ior: definition.ior,
      thickness: definition.thickness,
      attenuationColor: definition.attenuationColor,
      attenuationDistance: definition.attenuationDistance,
      alphaMode: definition.alphaMode,
      alphaCutoff: definition.alphaCutoff,
      alphaDither: definition.alphaDither,
      transparent: definition.transparent,
      side: definition.side,
      wireframe: definition.wireframe,
      shadingModel: definition.shadingModel,
      toon: definition.toon,
      mtoon: definition.mtoon,
      water: definition.water,
      ownsTextures: false,
      autoloadTextures: false,
    })
  }

  #resolveMaterialAsset(
    reference: string,
    material: MaterialResource,
    context: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>,
  ): ResourceId | undefined {
    const graph = context.nextGraph ?? context.previousGraph
    const candidates = material.assetDependencies
      .map((id) => graph?.get(id))
      .filter((node): node is AssetResource => node?.kind === 'asset')
    const explicit = this.#options.resolveMaterialAsset?.(reference, material, candidates)
    if (explicit) {
      if (!material.assetDependencies.includes(explicit)) {
        throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_TEXTURE_BINDING_INVALID', `Resolved texture asset ${explicit} is not a dependency of material ${material.id}.`)
      }
      return explicit
    }
    const byResourceId = candidates.filter((candidate) => candidate.id === reference)
    if (byResourceId.length === 1) return byResourceId[0]!.id
    const exact = candidates.filter((candidate) => candidate.definition.src === reference)
    if (exact.length === 1) return exact[0]!.id
    const references = materialTextureReferences(material)
    if (references.length === 1 && candidates.length === 1) return candidates[0]!.id
    return undefined
  }

  async #createInstance(
    instance: InstanceResource,
    context: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>,
  ): Promise<Sekai64InstanceHandle> {
    const source = context.getResourceHandle(instance.source)
    if (!source) throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_SOURCE_MISSING', `Instance ${instance.id} source ${instance.source} is not realized.`)
    if (source.kind === 'asset') {
      const resource = context.nextGraph?.get(instance.source)
      if (resource?.kind !== 'asset' || !this.#options.createAssetInstance) {
        throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_ASSET_INSTANCE_UNSUPPORTED', `Instance ${instance.id} uses an AssetResource source but no createAssetInstance hook is installed.`)
      }
      const node = await this.#options.createAssetInstance({ instance, resource, prepared: source.value, realization: context })
      applyInstanceState(node, instance)
      this.#scene.add(node)
      return { node, unregister: this.#options.registerInstanceNode?.(instance, node) || undefined }
    }
    if (source.kind !== 'geometry') throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_SOURCE_INVALID', `Instance ${instance.id} source must be geometry or asset.`)
    const materialState = this.#materialsForInstance(instance, source.value, context)
    const node = new Mesh({
      id: instance.instanceId,
      name: metadataString(instance, 'name') ?? instance.instanceId,
      geometry: source.value,
      materials: materialState.materials,
      materialGroupSlots: materialState.groupSlots,
      ownsResources: false,
      castShadow: materialState.materials.some(material => !material.transparent),
      receiveShadow: true,
    })
    applyInstanceState(node, instance)
    this.#scene.add(node)
    return { node, unregister: this.#options.registerInstanceNode?.(instance, node) || undefined }
  }

  #materialsForInstance(
    instance: InstanceResource,
    geometry: Geometry,
    context: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>,
  ): { readonly materials: readonly Material[]; readonly groupSlots: Readonly<Record<string, number>> } {
    const materials: Material[] = []
    const slotByResource = new Map<ResourceId, number>()
    const add = (id: ResourceId): number => {
      const existing = slotByResource.get(id)
      if (existing !== undefined) return existing
      const handle = context.getResourceHandle(id)
      if (!handle || handle.kind !== 'material') throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_MATERIAL_MISSING', `Instance ${instance.id} material ${id} is not realized.`)
      const slot = materials.length
      materials.push(handle.value)
      slotByResource.set(id, slot)
      return slot
    }

    for (const id of instance.materials) add(id)
    if (materials.length === 0) materials.push(this.#defaultMaterial)

    const groupSlots: Record<string, number> = {}
    const groupNames = new Set(geometry.groups.map(group => group.name).filter((name): name is string => Boolean(name)))
    for (const [name, id] of Object.entries(instance.materialBindings ?? {})) {
      if (!groupNames.has(name)) {
        throw new Sekai64ResourceAdapterError(
          'SEKAI64_RESOURCE_MATERIAL_REGION_UNKNOWN',
          `Instance ${instance.id} binds material ${id} to unknown geometry region "${name}". Available regions: ${[...groupNames].sort().join(', ') || '(none)'}.`,
        )
      }
      groupSlots[name] = add(id)
    }

    for (const group of geometry.groups) {
      if (group.name && groupSlots[group.name] !== undefined) continue
      if (group.materialIndex >= materials.length) {
        throw new Sekai64ResourceAdapterError(
          'SEKAI64_RESOURCE_MATERIAL_SLOT_MISSING',
          `Instance ${instance.id} geometry region ${group.name ?? '(unnamed)'} requires material slot ${group.materialIndex}, but only ${materials.length} material slot(s) are available.`,
        )
      }
    }
    return { materials: Object.freeze(materials), groupSlots: Object.freeze(groupSlots) }
  }

  async #updateInstance(
    delta: InstanceResourceDelta,
    handle: Sekai64InstanceHandle,
    context: ResourceRealizationContext<Sekai64RealizedResource, Sekai64InstanceHandle>,
  ): Promise<Sekai64InstanceHandle> {
    const node = handle.node
    if (node instanceof Mesh) {
      let geometry = node.geometry
      if (delta.fields.includes('source')) {
        const source = context.getResourceHandle(delta.next.source)
        if (!source || source.kind !== 'geometry') {
          throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_SOURCE_UPDATE_UNSUPPORTED', `Stable Mesh instance ${delta.id} can only update to a GeometryResource source.`)
        }
        geometry = source.value
        node.setGeometry(geometry, { disposePrevious: false, ownsResource: false })
      }
      if (delta.fields.includes('source') || delta.fields.includes('materials')) {
        const materialState = this.#materialsForInstance(delta.next, geometry, context)
        node.setMaterials(materialState.materials, { disposePrevious: false, ownsResource: false })
        node.setMaterialGroupSlots(materialState.groupSlots)
        node.castShadow = materialState.materials.some(material => !material.transparent)
      }
    } else if (delta.fields.includes('source') || delta.fields.includes('materials')) {
      throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_CUSTOM_INSTANCE_UPDATE_UNSUPPORTED', `Custom asset instance ${delta.id} cannot change source/materials through the built-in adapter.`)
    }
    if (delta.fields.includes('transform') || delta.fields.includes('frame')) applyInstanceState(node, delta.next)
    if (delta.fields.includes('metadata')) node.name = metadataString(delta.next, 'name') ?? delta.next.instanceId
    return handle
  }

  async #release(resource: RealizableResource, handle: Sekai64RealizedResource): Promise<void> {
    if (resource.kind === 'geometry') {
      if (handle.kind !== 'geometry') throw releaseMismatch(resource, handle)
      handle.value.dispose()
      return
    }
    if (resource.kind === 'material') {
      if (handle.kind !== 'material') throw releaseMismatch(resource, handle)
      handle.value.dispose()
      return
    }
    if (handle.kind !== 'asset') throw releaseMismatch(resource, handle)
    if (this.#options.releaseAsset) await this.#options.releaseAsset(resource, handle.value)
    else if (hasDispose(handle.value)) handle.value.dispose()
  }

  #assertAlive(): void {
    if (this.#disposed) throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_ADAPTER_DISPOSED', 'Sekai64ResourceAdapter has been disposed.')
  }
}

export function createSekai64ResourceAdapter(options: Sekai64ResourceAdapterOptions): Sekai64ResourceAdapter {
  return new Sekai64ResourceAdapter(options)
}

export type Sekai64RendererResourceAdapterOptions = Omit<Sekai64ResourceAdapterOptions, 'scene' | 'registerInstanceNode'>

/** Attach S11 realization to an already-mounted Sekai64Renderer native scene and picking identity. */
export function createSekai64RendererResourceAdapter(
  renderer: Sekai64Renderer,
  options: Sekai64RendererResourceAdapterOptions = {},
): Sekai64ResourceAdapter {
  const native = renderer.getNativeAccess()
  if (!native) throw new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_RENDERER_NOT_MOUNTED', 'Sekai64Renderer must have an active mounted native scene before creating a resource adapter.')
  return createSekai64ResourceAdapterFromNativeAccess(native, options)
}

export function createSekai64ResourceAdapterFromNativeAccess(
  native: Sekai64RendererNativeAccess,
  options: Sekai64RendererResourceAdapterOptions = {},
): Sekai64ResourceAdapter {
  return new Sekai64ResourceAdapter({
    ...options,
    scene: native.scene,
    registerInstanceNode: (instance, node) => native.registerExternalNode({
      primitiveId: instance.instanceId,
      entityId: metadataString(instance, 'entityId'),
      node,
      interactive: instance.metadata?.interactive !== false,
    }),
  })
}

function inferAssetType(src: unknown): string {
  if (typeof src !== 'string') return 'unknown'
  const clean = src.split(/[?#]/, 1)[0]!.toLowerCase()
  if (/\.(png|jpe?g|webp|avif|ktx2|basis)$/.test(clean) || clean.startsWith('data:image/')) return 'texture'
  return 'unknown'
}

function materialTextureReferences(material: MaterialResource): readonly string[] {
  const definition = material.definition
  return [...new Set([
    definition.baseColorTexture,
    definition.metallicRoughnessTexture,
    definition.metalnessTexture,
    definition.roughnessTexture,
    definition.normalTexture,
    definition.emissiveTexture,
    definition.occlusionTexture,
    definition.lightMapTexture,
  ].filter((value): value is string => typeof value === 'string'))]
}

function metadataString(instance: InstanceResource, key: string): string | undefined {
  const value = instance.metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

function applyInstanceState(node: Node, instance: InstanceResource): void {
  node.position.set(instance.transform.position[0], instance.transform.position[1], instance.transform.position[2])
  node.scale.set(instance.transform.scale[0], instance.transform.scale[1], instance.transform.scale[2])
  if (instance.frame) {
    const frameRotation = quaternionFromFrame(instance.frame)
    const localRotation = new Quaternion().setFromEuler(new Euler(
      instance.transform.rotation[0],
      instance.transform.rotation[1],
      instance.transform.rotation[2],
      'XYZ',
    ))
    frameRotation.multiply(localRotation).normalize()
    node.rotation.setFromQuaternion(frameRotation)
  } else {
    node.rotation.set(instance.transform.rotation[0], instance.transform.rotation[1], instance.transform.rotation[2], 'XYZ')
  }
}

function quaternionFromFrame(frame: ResourceFrame): Quaternion {
  // Frame contract from S5: local +X = normal, +Y = binormal, +Z = tangent.
  const m00 = frame.normal[0], m01 = frame.binormal[0], m02 = frame.tangent[0]
  const m10 = frame.normal[1], m11 = frame.binormal[1], m12 = frame.tangent[1]
  const m20 = frame.normal[2], m21 = frame.binormal[2], m22 = frame.tangent[2]
  const trace = m00 + m11 + m22
  const q = new Quaternion()
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    q.set((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s)
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    q.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    q.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    q.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
  }
  return q.normalize()
}

function hasDispose(value: unknown): value is { dispose(): void } {
  return !!value && typeof value === 'object' && typeof (value as { dispose?: unknown }).dispose === 'function'
}

function releaseMismatch(resource: RealizableResource, handle: Sekai64RealizedResource): Sekai64ResourceAdapterError {
  return new Sekai64ResourceAdapterError('SEKAI64_RESOURCE_HANDLE_MISMATCH', `Resource ${resource.id} (${resource.kind}) has incompatible Sekai64 handle kind ${handle.kind}.`)
}
