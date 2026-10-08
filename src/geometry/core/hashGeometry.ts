import type { GeometryDefinition, GeometrySafetyLimits } from '../types/index.js'
import type { GeometryBuildIdentity } from './geometryIdentity.js'
import { normalizeGeometryDefinition } from './normalizeGeometry.js'

function canonicalStringify(value: unknown): string {
  return JSON.stringify(value)
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  const bytes = new TextEncoder().encode(input)
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

export function canonicalGeometryString(
  definition: unknown,
  options: { limits?: Partial<GeometrySafetyLimits> } = {},
): string {
  return canonicalStringify(normalizeGeometryDefinition(definition, options))
}

/** Pure canonical-source identity retained for content-only callers. */
export function hashGeometryDefinition(
  definition: unknown,
  options: { limits?: Partial<GeometrySafetyLimits> } = {},
): string {
  return `g1-${fnv1a64(canonicalGeometryString(definition, options))}`
}

/** Canonical build identity including the geometry ABI and executable provenance. */
export function canonicalGeometryBuildIdentityString(identity: GeometryBuildIdentity): string {
  return canonicalStringify(identity)
}

/** Compiler/cache identity. Distinct from the legacy pure-source g1 hash. */
export function hashGeometryBuildIdentity(identity: GeometryBuildIdentity): string {
  return `g2-${fnv1a64(canonicalGeometryBuildIdentityString(identity))}`
}

export function geometryDefinitionsEqual(a: unknown, b: unknown): boolean {
  return canonicalGeometryString(a) === canonicalGeometryString(b)
}

export type { GeometryDefinition }
