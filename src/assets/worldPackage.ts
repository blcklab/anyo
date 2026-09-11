import type { AssetDefinition, JsonValue, WorldDocument } from '../core/types.js'
import { canonicalizeWorldDocument, hashWorldDocument } from '../document/canonical.js'
import { serializeWorldDocument } from '../document/index.js'
import { inspectAssetManifest } from './manifest.js'

export interface PortableWorldPackageAsset {
  id: string
  src: string
  type?: string
  format?: string
  integrity?: string
  sizeBytes?: number
  mimeType?: string
  license?: string
  attribution?: string
  preload: boolean
  dependencies: readonly string[]
  variants: Readonly<Record<string, string | { src: string; integrity?: string; sizeBytes?: number; mimeType?: string }>>
}

export interface PortableWorldPackageManifest {
  manifestVersion: '1.0'
  worldVersion: string
  worldRevision: number
  documentHash: string
  totalDeclaredBytes: number
  assetOrder: readonly string[]
  assets: readonly PortableWorldPackageAsset[]
  metadata?: Record<string, JsonValue>
}

function source(asset: AssetDefinition): string {
  if (typeof asset.src !== 'string') throw new Error('Portable package manifests require resolved string asset sources.')
  return asset.src
}

export function createPortableWorldPackageManifest(
  document: WorldDocument,
  metadata?: Record<string, JsonValue>,
): PortableWorldPackageManifest {
  const report = inspectAssetManifest(document)
  if (!report.valid) {
    const message = report.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.path}: ${issue.message}`).join('\n')
    throw new Error(`Cannot create a portable package manifest from an invalid asset graph.\n${message}`)
  }
  const canonical = canonicalizeWorldDocument(document)
  return {
    manifestVersion: '1.0',
    worldVersion: canonical.version,
    worldRevision: canonical.revision ?? 0,
    documentHash: hashWorldDocument(canonical),
    totalDeclaredBytes: report.totalDeclaredBytes,
    assetOrder: report.dependencyOrder,
    assets: report.dependencyOrder.map((id) => {
      const asset = canonical.assets?.[id] as AssetDefinition
      return {
        id,
        src: source(asset),
        type: asset.type,
        format: asset.format,
        integrity: asset.integrity,
        sizeBytes: asset.sizeBytes,
        mimeType: asset.mimeType,
        license: asset.license,
        attribution: asset.attribution,
        preload: asset.preload ?? asset.loading === 'eager',
        dependencies: [...(asset.dependencies ?? [])],
        variants: structuredClone(asset.variants ?? {}),
      }
    }),
    metadata: metadata ? structuredClone(metadata) : undefined,
  }
}

export function resolveAssetVariant(
  asset: AssetDefinition,
  variant?: string,
): { src: string; integrity?: string; sizeBytes?: number; mimeType?: string } {
  if (variant) {
    const selected = asset.variants?.[variant]
    if (typeof selected === 'string') return { src: selected }
    if (selected) return structuredClone(selected)
  }
  return { src: source(asset), integrity: asset.integrity, sizeBytes: asset.sizeBytes, mimeType: asset.mimeType }
}


export interface PortableWorldPackageDescriptor {
  worldPath: string
  manifestPath: string
  files: Readonly<Record<string, string>>
  requiredAssets: readonly { id: string; source: string; suggestedPath: string }[]
}

export interface PortableWorldPackageOptions {
  worldPath?: string
  manifestPath?: string
  assetDirectory?: string
  metadata?: Record<string, JsonValue>
}

function safePackagePath(value: string, label: string): string {
  const path = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!path || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a safe relative package path.`)
  }
  return path
}

function assetFileName(id: string, src: string): string {
  const pathname = src.split(/[?#]/, 1)[0] ?? ''
  const name = pathname.split('/').filter(Boolean).at(-1)
  const sanitized = (name || id).replace(/[^A-Za-z0-9._-]+/g, '-')
  return sanitized || `${id}.asset`
}

/**
 * Creates the deterministic text portion and required-file plan for a portable
 * Anyo world package. Binary fetching, ZIP creation, and filesystem writes stay
 * host-controlled so core Anyo remains browser, Node, and framework agnostic.
 */
export function createPortableWorldPackageDescriptor(
  document: WorldDocument,
  options: PortableWorldPackageOptions = {},
): PortableWorldPackageDescriptor {
  const worldPath = safePackagePath(options.worldPath ?? 'world.anyo.json', 'worldPath')
  const manifestPath = safePackagePath(options.manifestPath ?? 'manifest.json', 'manifestPath')
  const assetDirectory = safePackagePath(options.assetDirectory ?? 'assets', 'assetDirectory')
  const manifest = createPortableWorldPackageManifest(document, options.metadata)
  const requiredAssets = manifest.assets.map((asset) => ({
    id: asset.id,
    source: asset.src,
    suggestedPath: `${assetDirectory}/${assetFileName(asset.id, asset.src)}`,
  }))
  return {
    worldPath,
    manifestPath,
    files: Object.freeze({
      [worldPath]: serializeWorldDocument(document, { stableOrder: true }),
      [manifestPath]: `${JSON.stringify(manifest, null, 2)}\n`,
    }),
    requiredAssets,
  }
}
