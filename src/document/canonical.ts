import type { JsonValue, WorldDocument } from '../core/types.js'
import { assertSafeObjectGraph } from '../schema/safePath.js'

export interface CanonicalizeWorldOptions {
  omitSchema?: boolean
  omitDefaults?: boolean
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Canonical world documents cannot contain non-finite numbers.')
  if (Object.is(value, -0)) return 0
  return Number(value.toPrecision(15))
}

export function canonicalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return normalizeNumber(value)
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') throw new Error(`Canonical JSON does not support ${typeof value}.`)
  const output: Record<string, JsonValue> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key]
    if (child !== undefined) output[key] = canonicalizeJson(child)
  }
  return output
}

export function canonicalizeWorldDocument(
  document: WorldDocument,
  options: CanonicalizeWorldOptions = {},
): WorldDocument {
  assertSafeObjectGraph(document, 'canonical world document')
  const clone = structuredClone(document)
  if (options.omitSchema) delete clone.$schema
  if (options.omitDefaults) {
    if (clone.units === 'meters') delete clone.units
    if (clone.revision === 0) delete clone.revision
  }
  return canonicalizeJson(clone) as unknown as WorldDocument
}

export function canonicalWorldString(document: WorldDocument, options: CanonicalizeWorldOptions = {}): string {
  return JSON.stringify(canonicalizeWorldDocument(document, options))
}

/** Browser-safe FNV-1a 64-bit document identity. This is a cache/revision hash, not a cryptographic integrity hash. */
export function hashWorldDocument(document: WorldDocument, options: CanonicalizeWorldOptions = {}): string {
  const input = canonicalWorldString(document, options)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * prime)
  }
  return hash.toString(16).padStart(16, '0')
}
