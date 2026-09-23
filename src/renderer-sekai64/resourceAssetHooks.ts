import { Node } from '@blcklab/sekai64'
import type { AssetLoaderRegistration, AssetLoaderRegistry } from '@blcklab/sekai64/assets'
import type { Sekai64RendererResourceAdapterOptions } from './Sekai64ResourceAdapter.js'

interface PreparedAssetLoad {
  readonly loader: AssetLoaderRegistration<Node>
  readonly type: string
  readonly format: string
  readonly src: string
  readonly options?: Readonly<Record<string, unknown>>
}

/**
 * Internal S20 bridge from Anyo AssetResource nodes to Sekai64's existing
 * renderer asset-loader registry. Asset identity remains ResourceGraph-owned;
 * concrete model nodes are created per semantic InstanceResource so their node
 * ids and lifecycles remain independent.
 */
export function createResourceAssetLoaderOptions(
  registry: AssetLoaderRegistry,
): Pick<Sekai64RendererResourceAdapterOptions, 'prepareAsset' | 'createAssetInstance' | 'releaseAsset'> {
  return {
    prepareAsset({ resource }) {
      const src = resource.definition.src
      if (typeof src !== 'string') throw new Error(`ANYO_SEKAI64_RESOURCE_ASSET_SOURCE_UNRESOLVED: ${resource.id}`)
      const type = String(resource.definition.type ?? inferAssetType(src)).trim().toLowerCase()
      const format = String(resource.definition.format ?? inferAssetFormat(src) ?? '').trim().toLowerCase()
      if (!type || !format) throw new Error(`ANYO_SEKAI64_RESOURCE_ASSET_FORMAT_REQUIRED: ${resource.id}`)
      const loader = registry.resolve(type, format) as AssetLoaderRegistration<Node> | undefined
      if (!loader) throw new Error(`ANYO_SEKAI64_RESOURCE_ASSET_LOADER_MISSING: ${type}/${format} (${resource.id})`)
      return Object.freeze({
        loader,
        type,
        format,
        src,
        ...(resource.definition.options ? { options: resource.definition.options as Readonly<Record<string, unknown>> } : {}),
      }) satisfies PreparedAssetLoad
    },
    async createAssetInstance({ instance, resource, prepared }) {
      if (!isPreparedAssetLoad(prepared)) throw new Error(`ANYO_SEKAI64_RESOURCE_ASSET_PREPARED_INVALID: ${resource.id}`)
      const node = await prepared.loader.load({
        type: prepared.type,
        format: prepared.format,
        src: prepared.src,
        id: instance.instanceId,
        ...(prepared.options ? { options: prepared.options } : {}),
      })
      if (!(node instanceof Node)) throw new Error(`ANYO_SEKAI64_RESOURCE_ASSET_NODE_REQUIRED: ${resource.id}`)
      return node
    },
    releaseAsset(_resource, _prepared) {
      // The prepared handle is only an immutable loader recipe. Each concrete
      // Node owns its normal loader lifecycle and is disposed as an instance.
    },
  }
}

function isPreparedAssetLoad(value: unknown): value is PreparedAssetLoad {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PreparedAssetLoad>
  return Boolean(record.loader && typeof record.loader.load === 'function' && typeof record.type === 'string' && typeof record.format === 'string' && typeof record.src === 'string')
}

function inferAssetType(src: string): string {
  const format = inferAssetFormat(src)
  if (format === 'gltf' || format === 'glb' || format === 'vrm' || format === 'obj') return 'model'
  return 'unknown'
}

function inferAssetFormat(src: string): string | undefined {
  const clean = src.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  const match = /\.([a-z0-9]+)$/.exec(clean)
  return match?.[1]
}
