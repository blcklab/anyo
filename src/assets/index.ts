export { assetsPlugin } from './plugin.js'
export type { AssetsPluginOptions } from './plugin.js'
export {
  AssetTypeRegistry,
  createAssetTypeRegistry,
  registerBuiltInAssetTypes,
  validateAssetEcosystem,
} from './registry.js'
export type {
  AssetRegistryOptions,
  AssetTypeRegistration,
  AssetValidationContext,
  UnknownAssetPolicy,
  ValidateAssetEcosystemOptions,
} from './registry.js'

export { inspectAssetManifest } from './manifest.js'
export type { AssetManifestEntry, AssetManifestReport } from './manifest.js'

export { createPortableWorldPackageManifest, createPortableWorldPackageDescriptor, resolveAssetVariant } from './worldPackage.js'
export type { PortableWorldPackageAsset, PortableWorldPackageManifest, PortableWorldPackageDescriptor, PortableWorldPackageOptions } from './worldPackage.js'
