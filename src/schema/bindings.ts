import type { BindingDefinition, WorldDocument } from '../core/types.js'
import { assertSafePath, hasOwn, parseDataPath } from './safePath.js'

function isBinding(value: unknown): value is BindingDefinition {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).$bind === 'string',
  )
}

export function getDataPath(data: unknown, path: string): unknown {
  const parts = parseDataPath(path)
  let current = data
  for (const part of parts) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) return undefined
      const index = Number(part)
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
    } else if (current && typeof current === 'object') {
      if (!hasOwn(current, part)) return undefined
      current = (current as Record<string, unknown>)[part]
    } else return undefined
  }
  return current
}

export function setDataPath(data: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parseDataPath(path)
  let current: Record<string, unknown> | unknown[] = data

  for (const [index, part] of parts.slice(0, -1).entries()) {
    const nextPart = parts[index + 1]
    const shouldBeArray = nextPart !== undefined && /^\d+$/.test(nextPart)
    let existing: unknown

    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) throw new Error(`Expected an array index in data path "${path}", received "${part}".`)
      const arrayIndex = Number(part)
      if (!Number.isSafeInteger(arrayIndex) || arrayIndex < 0) throw new Error(`Invalid array index "${part}" in data path "${path}".`)
      existing = current[arrayIndex]
      if (!existing || typeof existing !== 'object') {
        const created: Record<string, unknown> | unknown[] = shouldBeArray ? [] : Object.create(null)
        current[arrayIndex] = created
        current = created
      } else current = existing as Record<string, unknown> | unknown[]
      continue
    }

    existing = hasOwn(current, part) ? current[part] : undefined
    if (!existing || typeof existing !== 'object') {
      const created: Record<string, unknown> | unknown[] = shouldBeArray ? [] : Object.create(null)
      current[part] = created
      current = created
    } else current = existing as Record<string, unknown> | unknown[]
  }

  const finalPart = parts.at(-1)
  if (finalPart === undefined) return
  assertSafePath([finalPart], 'data path', path)
  if (Array.isArray(current)) {
    if (!/^\d+$/.test(finalPart)) throw new Error(`Expected an array index in data path "${path}", received "${finalPart}".`)
    const index = Number(finalPart)
    if (!Number.isSafeInteger(index) || index < 0) throw new Error(`Invalid array index "${finalPart}" in data path "${path}".`)
    current[index] = value
  } else current[finalPart] = value
}

function resolveValue(value: unknown, data: Record<string, unknown>, seen = new WeakSet<object>()): unknown {
  if (isBinding(value)) {
    const resolved = getDataPath(data, value.$bind)
    const selected = resolved === undefined ? value.fallback : resolved
    if (value.format !== undefined) {
      return value.format.replaceAll('{value}', selected === undefined ? '' : String(selected))
    }
    return selected
  }

  if (Array.isArray(value)) return value.map((item) => resolveValue(item, data, seen))
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new Error('Circular values are not supported while resolving world bindings.')
    seen.add(value)
    const result: Record<string, unknown> = Object.create(null)
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertSafePath([key], 'document property')
      result[key] = resolveValue(item, data, seen)
    }
    seen.delete(value)
    return result
  }
  return value
}

export function resolveDocumentBindings(document: WorldDocument): WorldDocument {
  const data = document.data ?? {}
  return resolveValue(document, data) as WorldDocument
}
