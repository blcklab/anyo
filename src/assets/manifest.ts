import type { AssetDefinition, WorldDocument } from '../core/types.js'
import type { ValidationIssue } from '../schema/errors.js'

export interface AssetManifestEntry {
  id: string
  type: string
  format?: string
  src: string
  integrity?: string
  sizeBytes?: number
  mimeType?: string
  license?: string
  attribution?: string
  dependencies: readonly string[]
  variants: Readonly<Record<string, unknown>>
}

export interface AssetManifestReport {
  valid: boolean
  issues: ValidationIssue[]
  totalDeclaredBytes: number
  dependencyOrder: string[]
}

function sourceString(asset: AssetDefinition): string | undefined {
  return typeof asset.src === 'string' ? asset.src : undefined
}

export function inspectAssetManifest(document: Pick<WorldDocument, 'assets'>): AssetManifestReport {
  const assets = document.assets ?? {}
  const issues: ValidationIssue[] = []
  let totalDeclaredBytes = 0
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const dependencyOrder: string[] = []

  const visit = (id: string, stack: string[]): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) {
      issues.push({ severity: 'error', code: 'ASSET_DEPENDENCY_CYCLE', path: `/assets/${id}/dependencies`, message: `Asset dependency cycle: ${[...stack, id].join(' -> ')}` })
      return
    }
    const asset = assets[id]
    if (!asset) {
      issues.push({ severity: 'error', code: 'ASSET_DEPENDENCY_UNKNOWN', path: `/assets/${id}`, message: `Unknown asset dependency "${id}".` })
      return
    }
    visiting.add(id)
    for (const dependency of asset.dependencies ?? []) visit(dependency, [...stack, id])
    visiting.delete(id)
    visited.add(id)
    dependencyOrder.push(id)
  }

  for (const [id, asset] of Object.entries(assets)) {
    const src = sourceString(asset)
    if (!src?.trim()) issues.push({ severity: 'warning', code: 'ASSET_BOUND_SOURCE_DYNAMIC', path: `/assets/${id}/src`, message: 'Bound asset sources cannot be preflighted until bindings are resolved.' })
    if (asset.sizeBytes !== undefined) {
      if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0) issues.push({ severity: 'error', code: 'ASSET_SIZE_INVALID', path: `/assets/${id}/sizeBytes`, message: 'sizeBytes must be a non-negative safe integer.' })
      else totalDeclaredBytes += asset.sizeBytes
    }
    if (asset.integrity && !/^(sha256|sha384|sha512)-[A-Za-z0-9+/=_-]+$/.test(asset.integrity)) {
      issues.push({ severity: 'error', code: 'ASSET_INTEGRITY_INVALID', path: `/assets/${id}/integrity`, message: 'integrity must use an SRI-style sha256, sha384, or sha512 value.' })
    }
    for (const dependency of asset.dependencies ?? []) {
      if (!(dependency in assets)) issues.push({ severity: 'error', code: 'ASSET_DEPENDENCY_UNKNOWN', path: `/assets/${id}/dependencies`, message: `Asset "${id}" references unknown dependency "${dependency}".` })
    }
    visit(id, [])
  }
  return { valid: !issues.some((item) => item.severity === 'error'), issues, totalDeclaredBytes, dependencyOrder }
}
