import type { AssetDefinition, EntityDefinition, NormalizedWorldDocument } from './types.js'

/**
 * S20: schema-0.8 static model assets can be realized through ResourceGraph.
 *
 * VRM and animated-model assets intentionally remain on the established legacy
 * renderer/Player path so character fitting, humanoid animation and root-motion
 * ownership are not changed by the mixed-resource milestone.
 */
export function resourceGraphModelAsset(
  entity: EntityDefinition,
  document: Pick<NormalizedWorldDocument, 'version' | 'assets'>,
): AssetDefinition | undefined {
  if (!String(document.version).startsWith('0.8')) return undefined
  if (entity.type !== 'model' || !entity.asset) return undefined
  const asset = document.assets[entity.asset]
  if (!asset) return undefined
  const type = String(asset.type ?? 'model').trim().toLowerCase()
  const format = String(asset.format ?? inferFormat(asset.src)).trim().toLowerCase()
  if (type !== 'model') return undefined
  if (format === 'vrm') return undefined
  return asset
}

function inferFormat(src: AssetDefinition['src']): string {
  if (typeof src !== 'string') return ''
  const clean = src.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  const match = /\.([a-z0-9]+)$/.exec(clean)
  return match?.[1] ?? ''
}
