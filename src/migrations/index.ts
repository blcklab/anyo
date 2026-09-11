import type { AssetDefinition, WorldDocument } from '../core/types.js'
import { assertSafeObjectGraph } from '../schema/safePath.js'

export interface MigrationChange { path: string; description: string }
export interface MigrationResult {
  document: WorldDocument
  from: string
  to: '0.7'
  changed: boolean
  changes: MigrationChange[]
  warnings: string[]
}

function inferFormat(asset: AssetDefinition): string | undefined {
  if (asset.format) return asset.format.toLowerCase()
  if (typeof asset.src !== 'string') return undefined
  try {
    const pathname = new URL(asset.src, 'https://anyo.invalid').pathname
    const extension = pathname.split('.').pop()?.toLowerCase()
    return extension && extension !== pathname ? extension : undefined
  } catch { return undefined }
}

function inferType(format: string | undefined): string {
  if (format && ['png', 'jpg', 'jpeg', 'webp', 'avif', 'ktx2'].includes(format)) return 'texture'
  if (format && ['mp3', 'ogg', 'wav', 'm4a'].includes(format)) return 'audio'
  if (format && ['mp4', 'webm'].includes(format)) return 'video'
  if (format && ['hdr', 'exr'].includes(format)) return 'environment'
  if (format && ['woff', 'woff2', 'ttf', 'otf'].includes(format)) return 'font'
  return 'model'
}

function updateSchemaReference(value: string): string {
  return value.replace(/world-0\.(?:2|3(?:\.1)?|4|5|6)\.schema\.json/g, 'world-0.7.schema.json')
}

const KNOWN_ROOT_FIELDS = new Set([
  '$schema', 'version', 'revision', 'units', 'metadata', 'data', 'environment', 'rendering', 'cameras', 'activeCamera', 'channels',
  'requires', 'events', 'materials', 'assets', 'prefabs', 'building', 'entities', 'exploration', 'visibility', 'extensions',
])

export function migrateWorldDocument(input: WorldDocument): MigrationResult {
  assertSafeObjectGraph(input, 'migration input')
  const document = structuredClone(input)
  const from = String(document.version ?? '')
  const changes: MigrationChange[] = []
  const warnings: string[] = []

  if (from === '0.7' || from.startsWith('0.7.')) {
    document.revision ??= 0
    return { document, from, to: '0.7', changed: input.revision === undefined, changes: input.revision === undefined ? [{ path: '/revision', description: 'Added the default authored-document revision.' }] : [], warnings }
  }
  if (!['0.2', '0.3', '0.4', '0.5', '0.6'].some((version) => from.startsWith(version))) {
    throw new Error(`Unsupported Anyo document version "${from}". Supported migrations are 0.2 through 0.6 to 0.7.`)
  }

  document.version = '0.7'
  changes.push({ path: '/version', description: `Updated the document version from ${from} to 0.7.` })
  document.revision ??= 0
  changes.push({ path: '/revision', description: 'Added the authored-document revision used by stable transactions.' })

  if (document.$schema) {
    const nextSchema = updateSchemaReference(document.$schema)
    if (nextSchema !== document.$schema) {
      document.$schema = nextSchema
      changes.push({ path: '/$schema', description: 'Updated the JSON Schema reference to world-0.7.schema.json.' })
    }
  }

  for (const [id, asset] of Object.entries(document.assets ?? {})) {
    const format = inferFormat(asset)
    if (!asset.format && format) { asset.format = format; changes.push({ path: `/assets/${id}/format`, description: `Inferred asset format "${format}".` }) }
    if (!asset.type) { asset.type = inferType(format); changes.push({ path: `/assets/${id}/type`, description: `Inferred asset type "${asset.type}".` }) }
  }

  const record = document as unknown as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => !KNOWN_ROOT_FIELDS.has(key))
  if (unknown.length) {
    document.extensions ??= {}
    const legacy = ((document.extensions as Record<string, unknown>)['anyo.legacyRoot'] ??= {}) as Record<string, unknown>
    for (const key of unknown) {
      legacy[key] = structuredClone(record[key])
      delete record[key]
      changes.push({ path: `/extensions/anyo.legacyRoot/${key}`, description: `Preserved unknown legacy root field "${key}" in a namespaced extension object.` })
    }
    warnings.push('Unknown legacy root fields were preserved under extensions["anyo.legacyRoot"].')
  }

  const serialized = JSON.stringify(document)
  if (serialized.includes('"interaction"') || serialized.includes('"collision"') || serialized.includes('"audio"') || serialized.includes('"lod"')) {
    warnings.push('Legacy interaction, collision, audio, and LOD fields remain supported. Extension packages should own new specialized declarations.')
  }
  assertSafeObjectGraph(document, 'migration output')
  return { document, from, to: '0.7', changed: true, changes, warnings }
}
