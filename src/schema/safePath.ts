export const FORBIDDEN_PATH_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
])

export function assertSafePath(
  path: readonly string[],
  context = 'object path',
  originalPath?: string,
): void {
  for (const segment of path) {
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      const source = originalPath ?? path.join('.')
      throw new Error(`Unsafe ${context} "${source}": segment "${segment}" is forbidden.`)
    }
  }
}

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function parseDataPath(path: string): string[] {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('Data paths must not be empty.')
  const normalized = path.replace(/\[(\d+)\]/g, '.$1')
  if (/\[[^\]]*\]/.test(normalized)) throw new Error(`Malformed data path "${path}".`)
  const parts = normalized.split('.').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error('Data paths must not be empty.')
  assertSafePath(parts, 'data path', path)
  return parts
}

function decodePointerSegment(segment: string, originalPath: string): string {
  let value = ''
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index]
    if (character !== '~') {
      value += character
      continue
    }
    const escape = segment[index + 1]
    if (escape === '0') value += '~'
    else if (escape === '1') value += '/'
    else throw new Error(`Malformed JSON Pointer escape in path "${originalPath}".`)
    index += 1
  }
  return value
}

export function parseJsonPointer(path: string): string[] {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('JSON patch paths must start with "/".')
  }
  const parts = path.slice(1).split('/').map((part) => decodePointerSegment(part, path))
  if (parts.some((part) => part.length === 0)) throw new Error(`JSON patch path "${path}" contains an empty segment.`)
  assertSafePath(parts, 'JSON patch path', path)
  return parts
}

export function assertSafeObjectGraph(value: unknown, context = 'object', seen = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) throw new Error(`Circular values are not supported in ${context}.`)
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeObjectGraph(item, `${context}[${index}]`, seen))
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Unsafe ${context}: only plain JSON objects are supported.`)
    }
    for (const key of Object.keys(value)) {
      assertSafePath([key], context)
      assertSafeObjectGraph((value as Record<string, unknown>)[key], `${context}.${key}`, seen)
    }
  }
  seen.delete(value)
}
