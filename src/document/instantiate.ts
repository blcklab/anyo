import type {
  AnyoObjectDocument,
  AssetDefinition,
  ComponentDefinition,
  CompositionParameterDefinition,
  CompositionDefinition,
  EntityDefinition,
  MaterialDefinition,
  PrefabDefinition,
  ResolvedAnyoImport,
  ResolvedWorldDocumentGraph,
  WorldDocument,
} from '../core/types.js'
import type { GeometryDefinition } from '../geometry/types/index.js'
import { AnyoImportError } from './imports.js'
import { validateWorldDocument } from '../schema/validate.js'
import { mergeCompositionParameters } from '../schema/compositionParameters.js'

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

function resourceId(namespace: string, kind: 'asset' | 'material' | 'curve' | 'geometry' | 'composition', id: string): string {
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

function parameterDefinitionsForDefinition(
  definition: CompositionDefinition,
  node: ResolvedAnyoImport,
  stack: string[] = [],
): Record<string, CompositionParameterDefinition> | undefined {
  let base: Record<string, CompositionParameterDefinition> | undefined
  if (definition.extends && !stack.includes(definition.extends)) {
    const local = node.document.compositions?.[definition.extends]
    if (local) base = parameterDefinitionsForDefinition(local, node, [...stack, definition.extends])
    else {
      const imported = node.imports[definition.extends]
      if (imported) base = parameterDefinitionsForDefinition(imported.document.root, imported, [...stack, definition.extends])
    }
  }
  return mergeCompositionParameters(base, definition.parameters)
}

function parameterDefinitionsForReference(
  node: ResolvedAnyoImport,
  id: string | undefined,
): Record<string, CompositionParameterDefinition> | undefined {
  if (!id) return undefined
  const local = node.document.compositions?.[id]
  if (local) return parameterDefinitionsForDefinition(local, node, [id])
  const imported = node.imports[id]
  if (imported) return parameterDefinitionsForDefinition(imported.document.root, imported, [id])
  return undefined
}

function rewriteCompositionArguments(
  args: EntityDefinition['arguments'],
  parameters: Record<string, CompositionParameterDefinition> | undefined,
  node: ResolvedAnyoImport,
): EntityDefinition['arguments'] {
  if (!args) return args
  const output = structuredClone(args)
  for (const [name, value] of Object.entries(output)) {
    const parameter = parameters?.[name]
    if (!parameter || typeof value !== 'string') continue
    if (parameter.type === 'material') {
      output[name] = localReference(node.document.materials, value, (id) => resourceId(node.namespace, 'material', id)) ?? value
    } else if (parameter.type === 'asset') {
      output[name] = localReference(node.document.assets, value, (id) => resourceId(node.namespace, 'asset', id)) ?? value
    }
  }
  return output
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
  const originalComposition = 'composition' in output && typeof output.composition === 'string' ? output.composition : undefined
  if ('arguments' in output && output.arguments) {
    output.arguments = rewriteCompositionArguments(output.arguments, parameterDefinitionsForReference(node, originalComposition), node)
  }
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


function rewriteGeometry(definition: GeometryDefinition, node: ResolvedAnyoImport): GeometryDefinition {
  const output = structuredClone(definition)
  if (output.kind === 'sweep' && typeof output.path === 'string') {
    output.path = localReference(node.document.curves, output.path, (id) => resourceId(node.namespace, 'curve', id)) ?? output.path
  }
  for (const field of ['source', 'left', 'right'] as const) {
    const child = output[field]
    if (child && typeof child === 'object' && !Array.isArray(child)) output[field] = rewriteGeometry(child as GeometryDefinition, node)
  }
  return output
}

function rewriteComposition(composition: CompositionDefinition, node: ResolvedAnyoImport): CompositionDefinition {
  const output = rewriteEntity(composition, node)
  if (output.extends) output.extends = compositionReference(node, output.extends)
  if (output.parameters) {
    output.parameters = Object.fromEntries(Object.entries(output.parameters).map(([name, parameter]) => {
      const next = structuredClone(parameter)
      if (typeof next.default === 'string' && next.type === 'material') {
        next.default = localReference(node.document.materials, next.default, (id) => resourceId(node.namespace, 'material', id)) ?? next.default
      } else if (typeof next.default === 'string' && next.type === 'asset') {
        next.default = localReference(node.document.assets, next.default, (id) => resourceId(node.namespace, 'asset', id)) ?? next.default
      }
      return [name, next]
    }))
  }
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
  output: Required<Pick<WorldDocument, 'assets' | 'materials' | 'curves' | 'geometries' | 'compositions'>>,
): void {
  for (const alias of Object.keys(node.imports).sort()) instantiateNode(node.imports[alias] as ResolvedAnyoImport, output)

  for (const id of Object.keys(node.document.assets ?? {}).sort()) {
    mergeGenerated(output.assets, resourceId(node.namespace, 'asset', id), rewriteAsset((node.document.assets as NonNullable<AnyoObjectDocument['assets']>)[id] as AssetDefinition, node), node.sourceUrl)
  }
  for (const id of Object.keys(node.document.materials ?? {}).sort()) {
    mergeGenerated(output.materials, resourceId(node.namespace, 'material', id), rewriteMaterial((node.document.materials as NonNullable<AnyoObjectDocument['materials']>)[id] as MaterialDefinition, node), node.sourceUrl)
  }
  for (const id of Object.keys(node.document.curves ?? {}).sort()) {
    mergeGenerated(output.curves, resourceId(node.namespace, 'curve', id), structuredClone((node.document.curves as NonNullable<AnyoObjectDocument['curves']>)[id]), node.sourceUrl)
  }
  for (const id of Object.keys(node.document.geometries ?? {}).sort()) {
    mergeGenerated(output.geometries, resourceId(node.namespace, 'geometry', id), rewriteGeometry((node.document.geometries as NonNullable<AnyoObjectDocument['geometries']>)[id] as GeometryDefinition, node), node.sourceUrl)
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
  output.curves = structuredClone(output.curves ?? {})
  output.geometries = structuredClone(output.geometries ?? {})
  output.compositions = structuredClone(output.compositions ?? {})

  const generated = {
    assets: output.assets,
    materials: output.materials,
    curves: output.curves,
    geometries: output.geometries,
    compositions: output.compositions,
  }
  for (const alias of Object.keys(graph.imports).sort()) instantiateNode(graph.imports[alias] as ResolvedAnyoImport, generated)

  validateWorldDocument(output)
  return output
}
