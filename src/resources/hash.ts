import { canonicalizeJson } from '../document/canonical.js'
import type { JsonValue } from '../core/types.js'

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * prime)
  }
  return hash.toString(16).padStart(16, '0')
}

export function canonicalResourceValue(value: unknown): JsonValue {
  return canonicalizeJson(value)
}

export function canonicalResourceString(value: unknown): string {
  return JSON.stringify(canonicalResourceValue(value))
}

export function hashResourceValue(prefix: string, value: unknown): string {
  return `${prefix}-${fnv1a64(canonicalResourceString(value))}`
}
