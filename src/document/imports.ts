import type {
  AnyoDocumentLoadRequest,
  AnyoDocumentLoader,
  AnyoImportDefinition,
  AnyoLoadedDocument,
  AnyoObjectDocument,
  ComponentDefinition,
  CompositionDefinition,
  EntityDefinition,
  ResolveWorldImportsOptions,
  ResolvedAnyoImport,
  ResolvedWorldDocumentGraph,
  WorldDocument,
  WorldSourceContext,
} from '../core/types.js'
import { inspectAnyoObjectDocument } from '../schema/object.js'
import { inspectAnyoImportMap } from '../schema/imports.js'
import { validateWorldDocument } from '../schema/validate.js'
import { assertSafeObjectGraph } from '../schema/safePath.js'
import type { ValidationIssue } from '../schema/errors.js'

export type AnyoImportErrorCode =
  | 'ANYO_IMPORT_ALIAS_DUPLICATE'
  | 'ANYO_IMPORT_BASE_URL_REQUIRED'
  | 'ANYO_IMPORT_CYCLE'
  | 'ANYO_IMPORT_DEPTH_EXCEEDED'
  | 'ANYO_IMPORT_INTEGRITY_MISMATCH'
  | 'ANYO_IMPORT_INTEGRITY_UNAVAILABLE'
  | 'ANYO_IMPORT_INTEGRITY_UNVERIFIABLE'
  | 'ANYO_IMPORT_INVALID_DOCUMENT'
  | 'ANYO_IMPORT_JSON_INVALID'
  | 'ANYO_IMPORTED_RESOURCE_CONFLICT'
  | 'ANYO_IMPORT_NOT_FOUND'
  | 'ANYO_IMPORT_URL_INVALID'

export class AnyoImportError extends Error {
  readonly code: AnyoImportErrorCode
  readonly alias?: string
  readonly source?: string
  readonly parent?: string
  readonly chain?: readonly string[]

  constructor(code: AnyoImportErrorCode, message: string, details: { alias?: string; source?: string; parent?: string; chain?: readonly string[]; cause?: unknown } = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'AnyoImportError'
    this.code = code
    this.alias = details.alias
    this.source = details.source
    this.parent = details.parent
    this.chain = details.chain
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index] ?? '')) index += 1
  return index
}

function parseStringToken(text: string, index: number): { value: string; end: number } {
  if (text[index] !== '"') throw new Error(`Expected string at ${index}.`)
  let cursor = index + 1
  let escaped = false
  while (cursor < text.length) {
    const char = text[cursor]
    if (escaped) escaped = false
    else if (char === '\\') escaped = true
    else if (char === '"') {
      const raw = text.slice(index, cursor + 1)
      return { value: JSON.parse(raw) as string, end: cursor + 1 }
    }
    cursor += 1
  }
  throw new Error(`Unterminated string at ${index}.`)
}

/** Lightweight structural scan used only to preserve duplicate import-alias diagnostics before JSON.parse discards duplicate keys. */
function scanJsonValue(text: string, start: number, importAliases: string[] = []): number {
  let index = skipWhitespace(text, start)
  const char = text[index]
  if (char === '"') return parseStringToken(text, index).end
  if (char === '[') {
    index = skipWhitespace(text, index + 1)
    if (text[index] === ']') return index + 1
    while (index < text.length) {
      index = scanJsonValue(text, index, importAliases)
      index = skipWhitespace(text, index)
      if (text[index] === ']') return index + 1
      if (text[index] !== ',') throw new Error(`Expected comma in array at ${index}.`)
      index = skipWhitespace(text, index + 1)
    }
  }
  if (char === '{') {
    index = skipWhitespace(text, index + 1)
    if (text[index] === '}') return index + 1
    while (index < text.length) {
      const key = parseStringToken(text, index)
      index = skipWhitespace(text, key.end)
      if (text[index] !== ':') throw new Error(`Expected colon after object key at ${index}.`)
      index = skipWhitespace(text, index + 1)
      if (key.value === 'imports' && text[index] === '{') {
        index = scanImportsObject(text, index, importAliases)
      } else {
        index = scanJsonValue(text, index, importAliases)
      }
      index = skipWhitespace(text, index)
      if (text[index] === '}') return index + 1
      if (text[index] !== ',') throw new Error(`Expected comma in object at ${index}.`)
      index = skipWhitespace(text, index + 1)
    }
  }
  const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index))
  if (literal) return index + literal[0].length
  throw new Error(`Invalid JSON token at ${index}.`)
}

function scanImportsObject(text: string, start: number, importAliases: string[]): number {
  let index = skipWhitespace(text, start + 1)
  const aliases = new Set<string>()
  if (text[index] === '}') return index + 1
  while (index < text.length) {
    const key = parseStringToken(text, index)
    if (aliases.has(key.value)) importAliases.push(key.value)
    aliases.add(key.value)
    index = skipWhitespace(text, key.end)
    if (text[index] !== ':') throw new Error(`Expected colon after import alias at ${index}.`)
    index = scanJsonValue(text, skipWhitespace(text, index + 1), importAliases)
    index = skipWhitespace(text, index)
    if (text[index] === '}') return index + 1
    if (text[index] !== ',') throw new Error(`Expected comma in imports object at ${index}.`)
    index = skipWhitespace(text, index + 1)
  }
  throw new Error('Unterminated imports object.')
}

function parseAnyoJson(text: string, source: string): unknown {
  try {
    const duplicates: string[] = []
    const end = skipWhitespace(text, scanJsonValue(text, 0, duplicates))
    if (end !== text.length) throw new Error(`Unexpected trailing JSON at ${end}.`)
    if (duplicates.length) {
      const alias = duplicates[0] as string
      throw new AnyoImportError('ANYO_IMPORT_ALIAS_DUPLICATE', `Duplicate import alias "${alias}" in ${source}.`, { alias, source })
    }
    return JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof AnyoImportError) throw error
    throw new AnyoImportError('ANYO_IMPORT_JSON_INVALID', `Invalid JSON in Anyo document ${source}: ${error instanceof Error ? error.message : String(error)}`, { source, cause: error })
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0
    const b = bytes[index + 1] ?? 0
    const c = bytes[index + 2] ?? 0
    const remaining = bytes.length - index
    output += alphabet[a >> 2]
    output += alphabet[((a & 3) << 4) | (b >> 4)]
    output += remaining > 1 ? alphabet[((b & 15) << 2) | (c >> 6)] : '='
    output += remaining > 2 ? alphabet[c & 63] : '='
  }
  return output
}

async function verifyIntegrity(sourceText: string | undefined, integrity: string | undefined, source: string): Promise<void> {
  if (!integrity) return
  if (sourceText === undefined) throw new AnyoImportError('ANYO_IMPORT_INTEGRITY_UNVERIFIABLE', `Cannot verify integrity for ${source}: the document loader did not provide sourceText.`, { source })
  if (!globalThis.crypto?.subtle) throw new AnyoImportError('ANYO_IMPORT_INTEGRITY_UNAVAILABLE', `Cannot verify integrity for ${source}: Web Crypto SHA-256 is unavailable.`, { source })
  const expected = integrity.slice('sha256-'.length)
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceText)))
  const actual = bytesToBase64(digest)
  if (actual !== expected) throw new AnyoImportError('ANYO_IMPORT_INTEGRITY_MISMATCH', `Integrity mismatch for ${source}.`, { source })
}

export function createFetchAnyoDocumentLoader(fetcher: typeof fetch = globalThis.fetch): AnyoDocumentLoader {
  return async (request: AnyoDocumentLoadRequest): Promise<AnyoLoadedDocument> => {
    if (typeof fetcher !== 'function') throw new AnyoImportError('ANYO_IMPORT_NOT_FOUND', `Loading ${request.url} requires fetch support or an injected AnyoDocumentLoader.`, { alias: request.alias, source: request.url, parent: request.parentUrl })
    let response: Response
    try {
      response = await fetcher(request.url)
    } catch (error) {
      throw new AnyoImportError('ANYO_IMPORT_NOT_FOUND', `Failed to load Anyo document ${request.url}.`, { alias: request.alias, source: request.url, parent: request.parentUrl, cause: error })
    }
    if (!response.ok) throw new AnyoImportError('ANYO_IMPORT_NOT_FOUND', `Failed to load Anyo document ${request.url}: ${response.status} ${response.statusText}`, { alias: request.alias, source: request.url, parent: request.parentUrl })
    if (typeof response.text === 'function') {
      const sourceText = await response.text()
      await verifyIntegrity(sourceText, request.integrity, request.url)
      return { document: parseAnyoJson(sourceText, request.url), documentUrl: response.url || request.url, sourceText }
    }
    if (request.integrity) throw new AnyoImportError('ANYO_IMPORT_INTEGRITY_UNVERIFIABLE', `Cannot verify integrity for ${request.url}: the fetch response did not expose source text.`, { alias: request.alias, source: request.url, parent: request.parentUrl })
    const legacyResponse = response as Response & { json?: () => Promise<unknown> }
    if (typeof legacyResponse.json !== 'function') throw new AnyoImportError('ANYO_IMPORT_JSON_INVALID', `Fetch response for ${request.url} exposes neither text() nor json().`, { alias: request.alias, source: request.url, parent: request.parentUrl })
    return { document: await legacyResponse.json(), documentUrl: response.url || request.url }
  }
}

function sourceContextFor(documentUrl: string): WorldSourceContext {
  return { documentUrl, baseUrl: new URL('.', documentUrl).href }
}

function resolveImportUrl(definition: AnyoImportDefinition, parent: WorldSourceContext | undefined, alias: string): string {
  const source = definition.src.trim()
  const base = parent?.documentUrl ?? parent?.baseUrl
  try {
    if (base) return new URL(source, base).href
    return new URL(source).href
  } catch (error) {
    const code: AnyoImportErrorCode = base ? 'ANYO_IMPORT_URL_INVALID' : 'ANYO_IMPORT_BASE_URL_REQUIRED'
    const message = base
      ? `Import "${alias}" has an invalid source URL "${source}" relative to ${base}.`
      : `Import "${alias}" uses relative source "${source}" but the parent document has no documentUrl/baseUrl context.`
    throw new AnyoImportError(code, message, { alias, source, parent: base, cause: error })
  }
}

function resolveUrl(value: string, context: WorldSourceContext): string {
  try { return new URL(value, context.baseUrl ?? context.documentUrl).href }
  catch { return value }
}

function resolveComponentUrls(component: ComponentDefinition, context: WorldSourceContext): ComponentDefinition {
  const output = structuredClone(component)
  if (typeof output.src === 'string') output.src = resolveUrl(output.src, context)
  if (typeof output.source === 'string') output.source = resolveUrl(output.source, context)
  if (typeof output.texture === 'string') output.texture = resolveUrl(output.texture, context)
  const levels = Array.isArray(output.levels) ? output.levels : Array.isArray(output.lod) ? output.lod : undefined
  if (levels) {
    const next = levels.map((entry) => {
      if (!isRecord(entry)) return entry
      const value = { ...entry }
      if (typeof value.src === 'string') value.src = resolveUrl(value.src, context)
      return value
    })
    if (Array.isArray(output.levels)) output.levels = next
    else output.lod = next
  }
  return output
}

function resolveEntityLikeUrls<T extends EntityDefinition | CompositionDefinition>(entity: T, context: WorldSourceContext): T {
  const output = structuredClone(entity) as T
  if (typeof output.src === 'string') output.src = resolveUrl(output.src, context)
  if (output.audio?.src) output.audio = { ...output.audio, src: resolveUrl(output.audio.src, context) }
  if (output.lod) output.lod = output.lod.map((entry) => ({ ...entry, src: entry.src ? resolveUrl(entry.src, context) : entry.src }))
  if (output.webSurface) {
    const source = output.webSurface.source
    output.webSurface = {
      ...output.webSurface,
      source: source.type === 'url'
        ? { ...source, url: resolveUrl(source.url, context) }
        : source.type === 'snapshot'
          ? { ...source, image: resolveUrl(source.image, context), href: source.href ? resolveUrl(source.href, context) : undefined }
          : source,
      fallback: output.webSurface.fallback
        ? { ...output.webSurface.fallback, image: resolveUrl(output.webSurface.fallback.image, context), href: output.webSurface.fallback.href ? resolveUrl(output.webSurface.fallback.href, context) : undefined }
        : undefined,
    }
  }
  if (output.components) output.components = output.components.map((component) => resolveComponentUrls(component, context))
  if (output.children) output.children = output.children.map((child) => resolveEntityLikeUrls(child, context))
  return output
}

/** Resolve URL-bearing fields inside one imported object relative to that object's own source document. */
export function resolveAnyoObjectDocumentUrls(document: AnyoObjectDocument, context: WorldSourceContext): AnyoObjectDocument {
  const output = structuredClone(document)
  output.assets = Object.fromEntries(Object.entries(output.assets ?? {}).map(([id, asset]) => [id, {
    ...asset,
    src: typeof asset.src === 'string' ? resolveUrl(asset.src, context) : asset.src,
    lod: asset.lod?.map((entry) => ({ ...entry, src: entry.src ? resolveUrl(entry.src, context) : entry.src })),
    variants: asset.variants ? Object.fromEntries(Object.entries(asset.variants).map(([name, variant]) => [name, typeof variant === 'string' ? resolveUrl(variant, context) : { ...variant, src: resolveUrl(variant.src, context) }])) : undefined,
  }]))
  output.compositions = Object.fromEntries(Object.entries(output.compositions ?? {}).map(([id, composition]) => [id, resolveEntityLikeUrls(composition, context)]))
  output.root = resolveEntityLikeUrls(output.root, context)
  return output
}

function importedDocumentError(alias: string, sourceUrl: string, result: ReturnType<typeof inspectAnyoObjectDocument>): AnyoImportError {
  const summary = result.errors.slice(0, 4).map((entry) => `${entry.code} ${entry.path}: ${entry.message}`).join('; ')
  return new AnyoImportError('ANYO_IMPORT_INVALID_DOCUMENT', `Imported Anyo object "${alias}" from ${sourceUrl} is invalid${summary ? `: ${summary}` : '.'}`, { alias, source: sourceUrl })
}

export async function resolveWorldDocumentImports(document: WorldDocument, options: ResolveWorldImportsOptions = {}): Promise<ResolvedWorldDocumentGraph> {
  validateWorldDocument(document, options.validation)
  const rootIssues: ValidationIssue[] = []
  inspectAnyoImportMap(document.imports, '/imports', rootIssues)
  if (rootIssues.length) throw new AnyoImportError('ANYO_IMPORT_INVALID_DOCUMENT', rootIssues.map((entry) => `${entry.code} ${entry.path}: ${entry.message}`).join('; '))

  const loader = options.documentLoader ?? createFetchAnyoDocumentLoader()
  const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 32))
  const cache = new Map<string, Promise<{ document: AnyoObjectDocument; context: WorldSourceContext }>>()

  const loadObject = async (sourceUrl: string, definition: AnyoImportDefinition, alias: string, parentUrl?: string): Promise<{ document: AnyoObjectDocument; context: WorldSourceContext }> => {
    const cacheKey = `${sourceUrl}\u0000${definition.integrity ?? ''}`
    const existing = cache.get(cacheKey)
    if (existing) return existing
    const pending = (async () => {
      let loaded: AnyoLoadedDocument
      try {
        loaded = await loader({ url: sourceUrl, parentUrl, alias, integrity: definition.integrity })
      } catch (error) {
        if (error instanceof AnyoImportError) throw error
        throw new AnyoImportError('ANYO_IMPORT_NOT_FOUND', `Failed to load import "${alias}" from ${sourceUrl}.`, { alias, source: sourceUrl, parent: parentUrl, cause: error })
      }
      await verifyIntegrity(loaded.sourceText, definition.integrity, sourceUrl)
      assertSafeObjectGraph(loaded.document, `import ${alias}`)
      if (!isRecord(loaded.document)) throw new AnyoImportError('ANYO_IMPORT_INVALID_DOCUMENT', `Import "${alias}" from ${sourceUrl} did not produce a JSON object.`, { alias, source: sourceUrl, parent: parentUrl })
      const canonicalUrl = (() => {
        try { return new URL(loaded.documentUrl ?? sourceUrl, sourceUrl).href }
        catch { return sourceUrl }
      })()
      const context = sourceContextFor(canonicalUrl)
      const candidate = loaded.document as unknown as AnyoObjectDocument
      const result = inspectAnyoObjectDocument(candidate, options.validation)
      if (!result.valid) throw importedDocumentError(alias, canonicalUrl, result)
      return { document: resolveAnyoObjectDocumentUrls(candidate, context), context }
    })()
    cache.set(cacheKey, pending)
    try { return await pending }
    catch (error) { cache.delete(cacheKey); throw error }
  }

  const resolveMap = async (
    imports: WorldDocument['imports'] | AnyoObjectDocument['imports'],
    parentContext: WorldSourceContext | undefined,
    namespacePrefix: string,
    chain: readonly string[],
    depth: number,
  ): Promise<Record<string, ResolvedAnyoImport>> => {
    if (!imports) return {}
    if (depth > maxDepth) throw new AnyoImportError('ANYO_IMPORT_DEPTH_EXCEEDED', `Anyo import depth exceeded the configured maximum of ${maxDepth}.`, { chain })
    const output: Record<string, ResolvedAnyoImport> = {}
    for (const alias of Object.keys(imports).sort()) {
      const definition = imports[alias] as AnyoImportDefinition
      const sourceUrl = resolveImportUrl(definition, parentContext, alias)
      if (chain.includes(sourceUrl)) {
        const cycle = [...chain, sourceUrl]
        throw new AnyoImportError('ANYO_IMPORT_CYCLE', `Anyo import cycle detected: ${cycle.join(' -> ')}`, { alias, source: sourceUrl, parent: parentContext?.documentUrl, chain: cycle })
      }
      const loaded = await loadObject(sourceUrl, definition, alias, parentContext?.documentUrl)
      const namespace = namespacePrefix ? `${namespacePrefix}::${alias}` : alias
      const nested = await resolveMap(loaded.document.imports, loaded.context, namespace, [...chain, sourceUrl], depth + 1)
      output[alias] = {
        alias,
        namespace,
        sourceUrl,
        sourceContext: loaded.context,
        document: loaded.document,
        imports: nested,
      }
    }
    return output
  }

  const rootChain = options.sourceContext?.documentUrl ? [options.sourceContext.documentUrl] : []
  return {
    document: structuredClone(document),
    sourceContext: options.sourceContext ? { ...options.sourceContext } : undefined,
    imports: await resolveMap(document.imports, options.sourceContext, '', rootChain, 1),
  }
}
