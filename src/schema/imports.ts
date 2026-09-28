import type { AnyoImportMap } from '../core/types.js'
import type { ValidationIssue } from './errors.js'

export const ANYO_IMPORT_ALIAS_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9@._-]*$/
export const ANYO_IMPORT_INTEGRITY_PATTERN = /^sha256-[A-Za-z0-9+/]+={0,2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function add(issues: ValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ severity: 'error', code, path, message })
}

/** Shared structural validation for World/Object import maps. */
export function inspectAnyoImportMap(value: unknown, path: string, issues: ValidationIssue[]): value is AnyoImportMap {
  if (value === undefined) return true
  if (!isRecord(value)) {
    add(issues, 'ANYO_IMPORT_MAP_INVALID', path, 'imports must be an object map keyed by stable aliases.')
    return false
  }
  let valid = true
  for (const [alias, raw] of Object.entries(value)) {
    const entryPath = `${path}/${alias.replace(/~/g, '~0').replace(/\//g, '~1')}`
    if (!ANYO_IMPORT_ALIAS_PATTERN.test(alias)) {
      add(issues, 'ANYO_IMPORT_ALIAS_INVALID', entryPath, `Import alias "${alias}" must match ${ANYO_IMPORT_ALIAS_PATTERN.source}.`)
      valid = false
    }
    if (!isRecord(raw)) {
      add(issues, 'ANYO_IMPORT_DEFINITION_INVALID', entryPath, 'Import definitions must be objects.')
      valid = false
      continue
    }
    const unknown = Object.keys(raw).filter((key) => key !== 'src' && key !== 'integrity')
    for (const key of unknown) {
      add(issues, 'ANYO_IMPORT_FIELD_UNKNOWN', `${entryPath}/${key}`, `Unknown import field "${key}".`)
      valid = false
    }
    if (typeof raw.src !== 'string' || !raw.src.trim()) {
      add(issues, 'ANYO_IMPORT_SOURCE_REQUIRED', `${entryPath}/src`, 'Import src must be a non-empty URL/path string.')
      valid = false
    }
    if (raw.integrity !== undefined && (typeof raw.integrity !== 'string' || !ANYO_IMPORT_INTEGRITY_PATTERN.test(raw.integrity))) {
      add(issues, 'ANYO_IMPORT_INTEGRITY_INVALID', `${entryPath}/integrity`, 'integrity must use the form sha256-<base64>.')
      valid = false
    }
  }
  return valid
}
