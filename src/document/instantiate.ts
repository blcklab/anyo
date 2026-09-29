import type {
  AnyoObjectDocument,
  AssetDefinition,
  ComponentDefinition,
  CompositionDefinition,
  EntityDefinition,
  MaterialDefinition,
  PrefabDefinition,
  ResolvedAnyoImport,
  ResolvedWorldDocumentGraph,
  WorldDocument,
} from '../core/types.js'
import { AnyoImportError } from './imports.js'
import { validateWorldDocument } from '../schema/validate.js'

const MATERIAL_TEXTURE_FIELDS = [
  'baseColorTexture',
  'normalTexture',
  'roughnessTexture',
  'metalnessTexture',
  'metallicRoughnessTexture',
  'emissiveTexture',
  'occlusionTexture',
  'lightMapTexture',
] as const

function resourceId(namespace: string, kind: 'asset' | 'material' | 'geometry' | 'composition', id: string): string {
  return `${namespace}::${kind}::${id}`
}

function rootCompositionId(namespace: string): string {
  return `${namespace}::root`
}

function localReference(map: Record<string, unknown> | undefined, id: string | undefined, replacement: (value: string) => string): string | undefined {
  if (!id || !map || !Object.prototype.hasOwnProperty.call(map, id)) return id
  return replacement(id)
}

function compositionReference(node: ResolvedAnyoImport, id: string | undefined): string | undefined {
  if (!id) return id
  if (node.document.compositions && Object.prototype.hasOwnProperty.call(node.document.compositions, id)) {
    return resourceId(node.namespace, 'composition', id)
  }
  const imported = node.imports[id]
  if (imported) return rootCompositionId(imported.namespace)
  return id
}

function rewriteComponent(component: ComponentDefinition, node: ResolvedAnyoImport): ComponentDefinition {
  const output = structuredClone(component)
  if (output.type === 'anyo.vfx' && typeof output.material === 'string') {
    output.material = localReference(node.document.materials, output.material, (id) => resourceId(node.namespace, 'material', id))
  }
  return output
}

function rewriteEntity<T extends EntityDefinition | CompositionDefinition>(entity: T, node: ResolvedAnyoImport): T {
  const output = structuredClone(entity) as T
  if ('composition' in output && typeof output.composition === 'string') output.composition = compositionReference(node, output.composition)
  if ('material' in output && typeof output.material === 'string') {
    output.material = localReference(node.document.materials, output.material, (id) => resourceId(node.namespace, 'material', id))
  }
  if ('materialBindings' in output && output.materialBindings) {
    output.materialBindings = Object.fromEntries(Object.entries(output.materialBindings).map(([role, id]) => [
      role,
      localReference(node.document.materials, id, (value) => resourceId(node.namespace, 'material', value)) ?? id,
    ]))
  }
  if ('asset' in output && typeof output.asset === 'string') {
    output.asset = localReference(node.document.assets, output.asset, (id) => resourceId(node.namespace, 'asset', id))
  }
  if ('geometry' in output && typeof output.geometry === 'string') {
    output.geometry = localReference(node.document.geometries, output.geometry, (id) => resourceId(node.namespace, 'geometry', id))
  }
  if (output.components) output.components = output.components.map((component) => rewriteComponent(component, node))
  if (output.children) output.children = output.children.map((child) => rewriteEntity(child, node))
  return output
}

function rewriteAsset(asset: AssetDefinition, node: ResolvedAnyoImport): AssetDefinition {
  const output = structuredClone(asset)
  if (output.fallback) {
    output.fallback = localReference(node.document.assets, output.fallback, (id) => resourceId(node.namespace, 'asset', id)) ?? output.fallback
  }
  if (output.dependencies) {
    output.dependencies = output.dependencies.map((id) => localReference(node.document.assets, id, (value) => resourceId(node.namespace, 'asset', value)) ?? id)
  }
  return output
}

function rewriteMaterial(material: MaterialDefinition, node: ResolvedAnyoImport): MaterialDefinition {
  const output = structuredClone(material)
  for (const field of MATERIAL_TEXTURE_FIELDS) {
    const value = output[field]
    if (typeof value === 'string') output[field] = localReference(node.document.assets, value, (id) => resourceId(node.namespace, 'asset', id))
  }
  if (output.detail) {
    const detail = { ...output.detail }
    for (const field of ['normalTexture', 'roughnessTexture', 'heightTexture'] as const) {
      const value = detail[field]
      if (typeof value === 'string') detail[field] = localReference(node.document.assets, value, (id) => resourceId(node.namespace, 'asset', id))
    }
    output.detail = detail
  }
  if (output.mtoon?.faceShadowTexture) {
    output.mtoon = {
      ...output.mtoon,
      faceShadowTexture: localReference(node.document.assets, output.mtoon.faceShadowTexture, (id) => resourceId(node.namespace, 'asset', id)),
    }
  }
  return output
}

function rewriteComposition(composition: CompositionDefinition, node: ResolvedAnyoImport): CompositionDefinition {
  const output = rewriteEntity(composition, node)
  if (output.extends) output.extends = compositionReference(node, output.extends)
  return output
}

function withImportProvenance(composition: CompositionDefinition, node: ResolvedAnyoImport): CompositionDefinition {
  return {
    ...composition,
    provenance: {
      ...(composition.provenance ?? {}),
      source: composition.provenance?.source ?? node.sourceUrl,
    },
  }
}

function mergeGenerated<T>(target: Record<string, T>, id: string, value: T, sourceUrl: string): void {
  if (Object.prototype.hasOwnProperty.call(target, id)) {
    throw new AnyoImportError(
      'ANYO_IMPORTED_RESOURCE_CONFLICT',
      `Imported resource "${id}" from ${sourceUrl} conflicts with an existing world/generated resource.`,
      { source: sourceUrl },
    )
  }
  target[id] = value
}

function instantiateNode(
  node: ResolvedAnyoImport,
  output: Required<Pick<WorldDocument, 'assets' | 'materials' | 'geometries' | 'compositions'>>,
): void {
  for (const alias of Object.keys(node.imports).sort()) instantiateNode(node.imports[alias] as ResolvedAnyoImport, output)

  for (const id of Object.keys(node.document.assets ?? {}).sort()) {
    mergeGenerated(output.assets, resourceId(node.namespace, 'asset', id), rewriteAsset((node.document.assets as NonNullable<AnyoObjectDocument['assets']>)[id] as AssetDefinition, node), node.sourceUrl)
  }
  for (const id of Object.keys(node.document.materials ?? {}).sort()) {
    mergeGenerated(output.materials, resourceId(node.namespace, 'material', id), rewriteMaterial((node.document.materials as NonNullable<AnyoObjectDocument['materials']>)[id] as MaterialDefinition, node), node.sourceUrl)
  }
  for (const id of Object.keys(node.document.geometries ?? {}).sort()) {
    mergeGenerated(output.geometries, resourceId(node.namespace, 'geometry', id), structuredClone((node.document.geometries as NonNullable<AnyoObjectDocument['geometries']>)[id]), node.sourceUrl)
  }
  for (const id of Object.keys(node.document.compositions ?? {}).sort()) {
    const composition = (node.document.compositions as NonNullable<AnyoObjectDocument['compositions']>)[id] as CompositionDefinition
    mergeGenerated(
      output.compositions,
      resourceId(node.namespace, 'composition', id),
      withImportProvenance(rewriteComposition(composition, node), node),
      node.sourceUrl,
    )
  }

  const root = rewriteComposition(node.document.root, node)
  mergeGenerated(output.compositions, rootCompositionId(node.namespace), withImportProvenance(root, node), node.sourceUrl)
}

function rewriteWorldEntity<T extends EntityDefinition | CompositionDefinition | PrefabDefinition>(
  entity: T,
  imports: Readonly<Record<string, ResolvedAnyoImport>>,
): T {
  const output = structuredClone(entity) as T
  if ('composition' in output && typeof output.composition === 'string') {
    const imported = imports[output.composition]
    if (imported) output.composition = rootCompositionId(imported.namespace)
  }
  if (output.children) output.children = output.children.map((child) => rewriteWorldEntity(child, imports))
  return output
}

function rewriteRootWorldReferences(document: WorldDocument, imports: Readonly<Record<string, ResolvedAnyoImport>>): WorldDocument {
  const output = structuredClone(document)
  output.entities = output.entities?.map((entity) => rewriteWorldEntity(entity, imports))
  if (output.building) {
    output.building = {
      ...output.building,
      floors: output.building.floors.map((floor) => ({
        ...floor,
        rooms: floor.rooms.map((room) => ({
          ...room,
          entities: room.entities?.map((entity) => rewriteWorldEntity(entity, imports)),
        })),
      })),
    }
  }
  if (output.prefabs) {
    output.prefabs = Object.fromEntries(Object.entries(output.prefabs).map(([id, prefab]) => [id, rewriteWorldEntity(prefab, imports)]))
  }
  if (output.compositions) {
    output.compositions = Object.fromEntries(Object.entries(output.compositions).map(([id, composition]) => {
      const rewritten = rewriteWorldEntity(composition, imports)
      if (rewritten.extends && imports[rewritten.extends]) rewritten.extends = rootCompositionId(imports[rewritten.extends]!.namespace)
      return [id, rewritten]
    }))
  }
  return output
}

/**
 * Lower a resolved modular world graph into ordinary Anyo world vocabulary for runtime compilation.
 * Imports remain declared on the returned document; Step 7 owns removing them for portable bundling.
 */
export function instantiateResolvedWorldDocument(graph: ResolvedWorldDocumentGraph): WorldDocument {
  if (Object.keys(graph.imports).length === 0) {
    const output = structuredClone(graph.document)
    validateWorldDocument(output)
    return output
  }

  const output = rewriteRootWorldReferences(graph.document, graph.imports)
  output.assets = structuredClone(output.assets ?? {})
  output.materials = structuredClone(output.materials ?? {})
  output.geometries = structuredClone(output.geometries ?? {})
  output.compositions = structuredClone(output.compositions ?? {})

  const generated = {
    assets: output.assets,
    materials: output.materials,
    geometries: output.geometries,
    compositions: output.compositions,
  }
  for (const alias of Object.keys(graph.imports).sort()) instantiateNode(graph.imports[alias] as ResolvedAnyoImport, generated)

  validateWorldDocument(output)
  return output
}
