import type { GeometryDefinition, GeometrySafetyLimits } from '../types/index.js'
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

export function hashGeometryDefinition(
  definition: unknown,
  options: { limits?: Partial<GeometrySafetyLimits> } = {},
): string {
  return `g1-${fnv1a64(canonicalGeometryString(definition, options))}`
}

export function geometryDefinitionsEqual(a: unknown, b: unknown): boolean {
  return canonicalGeometryString(a) === canonicalGeometryString(b)
}

export type { GeometryDefinition }
