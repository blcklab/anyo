import type { AssetDefinition, JsonValue, MaterialDefinition, NormalizedWorldDocument } from '../core/types.js'

export type UnknownAssetPolicy = 'error' | 'warn' | 'preserve'

export interface AssetValidationContext {
  id: string
  asset: AssetDefinition
  document: NormalizedWorldDocument
  sourcePath: string
}

export interface AssetTypeRegistration {
  type: string
  formats?: readonly string[] | '*'
  validate?(context: AssetValidationContext): void
}

export interface AssetRegistryOptions {
  builtins?: boolean
}

export class AssetTypeRegistry {
  private readonly registrations = new Map<string, AssetTypeRegistration>()

  constructor(options: AssetRegistryOptions = {}) {
    if (options.builtins ?? true) registerBuiltInAssetTypes(this)
  }

  register(registration: AssetTypeRegistration): () => void {
    const type = registration.type.trim()
    if (!type) throw new Error('Asset type registrations require a non-empty type.')
    if (this.registrations.has(type)) throw new Error(`Asset type "${type}" is already registered.`)
    const normalized: AssetTypeRegistration = {
      ...registration,
      type,
      formats: registration.formats === '*' ? '*' : registration.formats?.map((format) => format.toLowerCase()),
    }
    this.registrations.set(type, normalized)
    return () => {
      if (this.registrations.get(type) === normalized) this.registrations.delete(type)
    }
  }

  get(type: string): AssetTypeRegistration | undefined { return this.registrations.get(type) }
  has(type: string): boolean { return this.registrations.has(type) }
  list(): readonly AssetTypeRegistration[] { return [...this.registrations.values()] }
}

export function createAssetTypeRegistry(options: AssetRegistryOptions = {}): AssetTypeRegistry {
  return new AssetTypeRegistry(options)
}

export interface ValidateAssetEcosystemOptions {
  registry?: AssetTypeRegistry
  unknown?: UnknownAssetPolicy
  warn?: (message: string) => void
}

export function validateAssetEcosystem(document: NormalizedWorldDocument, options: ValidateAssetEcosystemOptions = {}): void {
  const registry = options.registry ?? createAssetTypeRegistry()
  const unknown = options.unknown ?? 'error'

  for (const [id, asset] of Object.entries(document.assets)) {
    const sourcePath = `/assets/${escapePointer(id)}`
    const type = asset.type ?? ''
    const registration = registry.get(type)
    if (!registration) {
      const message = `ANYO_ASSET_TYPE_UNSUPPORTED\nAsset: ${id}\nType: ${type || '(missing)'}\nSource: ${sourcePath}`
      if (unknown === 'error') throw new Error(message)
      if (unknown === 'warn') options.warn?.(message)
      continue
    }
    const format = asset.format?.toLowerCase()
    if (format && registration.formats !== '*' && registration.formats && !registration.formats.includes(format)) {
      throw new Error(`ANYO_ASSET_FORMAT_UNSUPPORTED\nAsset: ${id}\nType: ${type}\nFormat: ${format}\nSource: ${sourcePath}`)
    }
    registration.validate?.({ id, asset, document, sourcePath })
    if (asset.fallback && !document.assets[asset.fallback]) {
      throw new Error(`ANYO_ASSET_FALLBACK_NOT_FOUND\nAsset: ${id}\nFallback: ${asset.fallback}\nSource: ${sourcePath}/fallback`)
    }
  }

  for (const [materialId, material] of Object.entries(document.materials)) {
    validateMaterialAssets(materialId, material, document)
  }
}

const TEXTURE_FIELDS: readonly (keyof MaterialDefinition)[] = [
  'baseColorTexture', 'normalTexture', 'roughnessTexture', 'metalnessTexture', 'metallicRoughnessTexture', 'emissiveTexture', 'occlusionTexture',
]

function validateMaterialAssets(id: string, material: MaterialDefinition, document: NormalizedWorldDocument): void {
  for (const field of TEXTURE_FIELDS) {
    const assetId = material[field]
    if (typeof assetId !== 'string') continue
    const asset = document.assets[assetId]
    if (!asset) throw new Error(`ANYO_MATERIAL_ASSET_NOT_FOUND\nMaterial: ${id}\nField: ${String(field)}\nAsset: ${assetId}`)
    if (asset.type !== 'texture' && asset.type !== 'image') {
      throw new Error(`ANYO_MATERIAL_ASSET_TYPE_INVALID\nMaterial: ${id}\nField: ${String(field)}\nAsset: ${assetId}\nType: ${asset.type ?? '(missing)'}`)
    }
  }
  for (const field of ['normalTexture', 'roughnessTexture', 'heightTexture'] as const) {
    const assetId = material.detail?.[field]
    if (typeof assetId !== 'string') continue
    const asset = document.assets[assetId]
    if (!asset) throw new Error(`ANYO_MATERIAL_ASSET_NOT_FOUND\nMaterial: ${id}\nField: detail.${field}\nAsset: ${assetId}`)
    if (asset.type !== 'texture' && asset.type !== 'image') {
      throw new Error(`ANYO_MATERIAL_ASSET_TYPE_INVALID\nMaterial: ${id}\nField: detail.${field}\nAsset: ${assetId}\nType: ${asset.type ?? '(missing)'}`)
    }
  }
}

function escapePointer(value: string): string { return value.replace(/~/g, '~0').replace(/\//g, '~1') }

export function registerBuiltInAssetTypes(registry: AssetTypeRegistry): void {
  const builtins: AssetTypeRegistration[] = [
    { type: 'model', formats: ['gltf', 'glb', 'vrm', 'obj'] },
    { type: 'texture', formats: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'ktx2'] },
    { type: 'image', formats: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg'] },
    { type: 'audio', formats: ['mp3', 'ogg', 'wav', 'm4a'] },
    { type: 'video', formats: ['mp4', 'webm'] },
    { type: 'font', formats: ['woff', 'woff2', 'ttf', 'otf'] },
    { type: 'environment', formats: ['hdr', 'exr', 'png', 'jpg', 'jpeg', 'webp'] },
    { type: 'data', formats: '*' },
  ]
  for (const registration of builtins) registry.register(registration)
}
