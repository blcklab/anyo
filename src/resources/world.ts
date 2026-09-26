import type { CompiledWorld, MaterialDefinition, NormalizedWorldDocument, TransformDefinition } from '../core/types.js'
import { composeTransforms, createTransform, finalizeTransform } from '../math/transform.js'
import { lowerArchitecture } from '../geometry/architecture/index.js'
import type { GeometryDefinition } from '../geometry/types/index.js'
import { createResourceGraphBuilder } from './builder.js'
import type { ResourceGraph } from './graph.js'
import type { ResourceId, ResourceTransform } from './types.js'
import { resourceGraphModelAsset } from '../core/resourceAssetPolicy.js'

const MATERIAL_TEXTURE_FIELDS = [
  'baseColorTexture', 'normalTexture', 'roughnessTexture', 'metalnessTexture', 'metallicRoughnessTexture',
  'emissiveTexture', 'occlusionTexture', 'lightMapTexture',
] as const

function asResourceTransform(transform: { readonly position: readonly [number, number, number]; readonly rotation: readonly [number, number, number]; readonly scale: readonly [number, number, number] }): ResourceTransform {
  return { position: transform.position, rotation: transform.rotation, scale: transform.scale }
}

function composeResourceTransform(parent: TransformDefinition, child: { readonly position: readonly [number, number, number]; readonly rotation: readonly [number, number, number]; readonly scale: readonly [number, number, number] }): TransformDefinition {
  return finalizeTransform(composeTransforms(
    createTransform([...parent.position] as [number, number, number], [...parent.rotation] as [number, number, number], [...parent.scale] as [number, number, number]),
    createTransform([...child.position] as [number, number, number], [...child.rotation] as [number, number, number], [...child.scale] as [number, number, number]),
  ))
}

function particleMaterialReferences(entity: NormalizedWorldDocument['entities'][number]): readonly string[] {
  const materials: string[] = []
  for (const component of entity.components ?? []) {
    if (component.type !== 'anyo.vfx' || component.enabled === false) continue
    if (typeof component.material === 'string' && component.material.trim()) materials.push(component.material)
  }
  return materials
}

function namedGeometry(document: NormalizedWorldDocument, value: string | GeometryDefinition | undefined, entityId: string): GeometryDefinition {
  if (!value) throw new Error(`ANYO_PROCEDURAL_GEOMETRY_REQUIRED\nEntity: ${entityId}`)
  if (typeof value !== 'string') return value
  const definition = document.geometries?.[value]
  if (!definition) throw new Error(`ANYO_PROCEDURAL_GEOMETRY_NOT_FOUND\nEntity: ${entityId}\nGeometry: ${value}`)
  return definition
}

/** S14: compile schema-0.8 procedural authoring into the existing S9-S13 ResourceGraph. */
export function compileWorldResourceGraph(document: NormalizedWorldDocument, compiled: CompiledWorld): ResourceGraph | undefined {
  if (!String(document.version).startsWith('0.8')) return undefined
  const entities = [...document.entities]
  for (let index = 0; index < entities.length; index += 1) {
    const current = entities[index]
    if (current) entities.push(...(current.children ?? []))
  }
  const resourceBacked = entities.some((entity) =>
    entity.type === 'geometry'
    || entity.type === 'construction'
    || Boolean(resourceGraphModelAsset(entity, document))
    || particleMaterialReferences(entity).length > 0
  )
  if (!resourceBacked) return undefined

  const builder = createResourceGraphBuilder()
  const assetIds = new Map<string, ResourceId>()
  const materialIds = new Map<string, ResourceId>()

  const asset = (id: string): ResourceId => {
    const cached = assetIds.get(id)
    if (cached) return cached
    const definition = document.assets[id]
    if (!definition) throw new Error(`ANYO_RESOURCE_ASSET_NOT_FOUND\nAsset: ${id}`)
    const resource = builder.addAsset(definition)
    assetIds.set(id, resource)
    return resource
  }
  const material = (id: string): ResourceId => {
    const cached = materialIds.get(id)
    if (cached) return cached
    const definition = document.materials[id]
    if (!definition) throw new Error(`ANYO_RESOURCE_MATERIAL_NOT_FOUND\nMaterial: ${id}`)
    const dependencies: ResourceId[] = []
    const resourceDefinition: MaterialDefinition = { ...definition }
    for (const field of MATERIAL_TEXTURE_FIELDS) {
      const reference = (definition as MaterialDefinition)[field]
      if (typeof reference !== 'string' || !document.assets[reference]) continue
      const resourceAssetId = asset(reference)
      dependencies.push(resourceAssetId)
      // ResourceGraph material references are internal resource identities, not
      // authoring-layer asset keys. Keeping the explicit ResourceId here makes
      // multi-texture materials unambiguous after content-addressing.
      ;(resourceDefinition as Record<string, unknown>)[field] = resourceAssetId
    }
    if (definition.detail) {
      const detail = { ...definition.detail }
      for (const field of ['normalTexture', 'roughnessTexture', 'heightTexture'] as const) {
        const reference = definition.detail[field]
        if (typeof reference !== 'string' || !document.assets[reference]) continue
        const resourceAssetId = asset(reference)
        dependencies.push(resourceAssetId)
        detail[field] = resourceAssetId
      }
      resourceDefinition.detail = detail
    }
    const resource = builder.addMaterial(resourceDefinition, { assets: dependencies })
    materialIds.set(id, resource)
    return resource
  }

  // Particle emitters reuse ordinary Anyo material resources. Emitter simulation state is
  // intentionally not a ResourceGraph resource; only reusable appearance dependencies belong here.
  for (const entity of entities) for (const materialId of particleMaterialReferences(entity)) material(materialId)

  for (const entity of entities) {
    const modelAsset = resourceGraphModelAsset(entity, document)
    if (entity.type !== 'geometry' && entity.type !== 'construction' && !modelAsset) continue
    const node = compiled.entityById.get(entity.id)
    if (!node) throw new Error(`ANYO_PROCEDURAL_ENTITY_NOT_COMPILED\nEntity: ${entity.id}`)
    if (modelAsset) {
      const source = asset(entity.asset as string)
      builder.addInstance({
        id: entity.id,
        source,
        transform: asResourceTransform(node.transform),
        metadata: {
          entityId: entity.id,
          authoringId: node.authoringId,
          name: entity.id,
          assetId: entity.asset as string,
        },
      })
      node.resourceInstanceIds.push(entity.id)
      node.resourceInstanceTransforms[entity.id] = node.transform
      continue
    }

    const defaultMaterials = entity.material ? [material(entity.material)] : []
    const authoredBindings = Object.fromEntries(Object.entries(entity.materialBindings ?? {}).map(([name, id]) => [name, material(id)]))

    if (entity.type === 'geometry') {
      const source = builder.addGeometry(namedGeometry(document, entity.geometry, entity.id))
      builder.addInstance({
        id: entity.id,
        source,
        materials: defaultMaterials,
        materialBindings: Object.keys(authoredBindings).length ? authoredBindings : undefined,
        transform: asResourceTransform(node.transform),
        metadata: { entityId: entity.id, authoringId: node.authoringId, name: entity.id },
      })
      node.resourceInstanceIds.push(entity.id)
      node.resourceInstanceTransforms[entity.id] = node.transform
      continue
    }

    if (!entity.construction) throw new Error(`ANYO_PROCEDURAL_CONSTRUCTION_REQUIRED\nEntity: ${entity.id}`)
    const assembly = lowerArchitecture(entity.construction)
    const prefix = `construction/${entity.id}`
    for (const part of assembly.parts) {
      const source = builder.addGeometry(part.geometry)
      const roleMaterial = entity.materialBindings?.[part.role]
      const instanceId = `${prefix}/${part.id}`
      const transform = composeResourceTransform(node.transform, part.transform)
      builder.addInstance({
        id: instanceId,
        source,
        materials: roleMaterial ? [material(roleMaterial)] : defaultMaterials,
        transform: asResourceTransform(transform),
        metadata: { entityId: entity.id, authoringId: node.authoringId, architectureRole: part.role, name: part.id },
      })
      node.resourceInstanceIds.push(instanceId)
      node.resourceInstanceTransforms[instanceId] = transform
    }
    for (const group of assembly.instanceGroups) {
      const source = builder.addGeometry(group.geometry)
      const roleMaterial = entity.materialBindings?.[group.role]
      for (const placement of group.placements) {
        const instanceId = `${prefix}/${group.id}/${placement.index}`
        const transform = composeResourceTransform(node.transform, placement)
        builder.addInstance({
          id: instanceId,
          source,
          materials: roleMaterial ? [material(roleMaterial)] : defaultMaterials,
          transform: asResourceTransform(transform),
          metadata: { entityId: entity.id, authoringId: node.authoringId, architectureRole: group.role, instanceGroup: group.id },
        })
        node.resourceInstanceIds.push(instanceId)
        node.resourceInstanceTransforms[instanceId] = transform
      }
    }
  }
  return builder.build()
}
