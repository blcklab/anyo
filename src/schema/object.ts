import type { AnyoObjectDocument, CompositionDefinition, EntityDefinition, WorldDocument, WorldValidationOptions } from '../core/types.js'
import { AnyoValidationError, type ValidationIssue } from './errors.js'
import { inspectWorldDocument, type ValidationResult } from './validate.js'
import { inspectAnyoImportMap } from './imports.js'

const OBJECT_FIELDS = new Set(['$schema', 'kind', 'version', 'metadata', 'imports', 'assets', 'materials', 'curves', 'profiles', 'geometries', 'compositions', 'root'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function addIssue(issues: ValidationIssue[], code: string, path: string, message: string, suggestion?: string): void {
  issues.push({ severity: 'error', code, path, message, suggestion })
}

function remapRootPath(path: string): string {
  if (path === '/entities/0') return '/root'
  if (path.startsWith('/entities/0/')) return `/root/${path.slice('/entities/0/'.length)}`
  return path
}

function remapRootIssue(issue: ValidationIssue): ValidationIssue {
  return { ...issue, path: remapRootPath(issue.path) }
}

function rootAsEntity(root: CompositionDefinition): EntityDefinition {
  const {
    extends: _extends,
    version: _version,
    provenance: _provenance,
    parameters: _parameters,
    ...entity
  } = root
  return {
    ...entity,
    id: root.id?.trim() ? root.id : '@object:root',
    type: 'group',
  }
}

/**
 * Inspect a standalone Anyo Object 0.1 document without resolving imports.
 * Resource/entity semantics are validated through the existing World 0.9 validation path.
 */
export function inspectAnyoObjectDocument(document: AnyoObjectDocument, options: WorldValidationOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = []
  const raw = document as unknown

  if (!isRecord(raw)) {
    addIssue(issues, 'ANYO_OBJECT_DOCUMENT_REQUIRED', '/', 'The Anyo object document must be an object.')
    return { valid: false, issues, errors: issues, warnings: [] }
  }

  for (const key of Object.keys(raw)) {
    if (!OBJECT_FIELDS.has(key)) addIssue(issues, 'ANYO_OBJECT_FIELD_UNKNOWN', `/${key}`, `Unknown Anyo Object 0.1 field "${key}".`)
  }

  if (raw.$schema !== undefined && typeof raw.$schema !== 'string') addIssue(issues, 'ANYO_OBJECT_SCHEMA_INVALID', '/$schema', '$schema must be a string when provided.')
  if (raw.kind !== 'anyo-object') addIssue(issues, 'ANYO_OBJECT_KIND_INVALID', '/kind', 'Object documents must use kind "anyo-object".')

  const version = typeof raw.version === 'string' ? raw.version : ''
  if (version !== '0.1' && !version.startsWith('0.1.')) {
    addIssue(issues, 'ANYO_OBJECT_VERSION_UNSUPPORTED', '/version', `Unsupported Anyo object version "${version}".`, 'Use version "0.1" for the current native object contract.')
  }

  if (raw.metadata !== undefined && !isRecord(raw.metadata)) addIssue(issues, 'ANYO_OBJECT_METADATA_INVALID', '/metadata', 'metadata must be an object when provided.')
  inspectAnyoImportMap(raw.imports, '/imports', issues)
  for (const field of ['assets', 'materials', 'curves', 'profiles', 'geometries', 'compositions'] as const) {
    if (raw[field] !== undefined && !isRecord(raw[field])) addIssue(issues, 'ANYO_OBJECT_RESOURCE_MAP_INVALID', `/${field}`, `${field} must be an object map when provided.`)
  }

  if (!isRecord(raw.root)) {
    addIssue(issues, 'ANYO_OBJECT_ROOT_REQUIRED', '/root', 'Anyo Object 0.1 requires a root composition object.')
  } else {
    const root = raw.root as unknown as CompositionDefinition
    if (root.type !== undefined && root.type !== 'group') addIssue(issues, 'ANYO_OBJECT_ROOT_TYPE_INVALID', '/root/type', 'Object root type may only be "group" when provided.')
    for (const field of ['use', 'composition', 'arguments', 'repeat', 'scatter', 'instanceId', 'overrides', 'loading'] as const) {
      if (Object.prototype.hasOwnProperty.call(raw.root, field)) addIssue(issues, 'ANYO_OBJECT_ROOT_FIELD_INVALID', `/root/${field}`, `Object roots use composition-definition vocabulary; "${field}" is only valid on entity instances.`)
    }
    if (root.extends !== undefined && (typeof root.extends !== 'string' || !root.extends.trim())) addIssue(issues, 'ANYO_OBJECT_ROOT_EXTENDS_INVALID', '/root/extends', 'root.extends must be a non-empty local composition id when provided.')
    if (root.extends) {
      const hasLocalComposition = isRecord(raw.compositions) && Object.prototype.hasOwnProperty.call(raw.compositions, root.extends)
      const hasImportedComposition = isRecord(raw.imports) && Object.prototype.hasOwnProperty.call(raw.imports, root.extends)
      if (!hasLocalComposition && !hasImportedComposition) {
        addIssue(issues, 'ANYO_OBJECT_ROOT_EXTENDS_UNKNOWN', '/root/extends', `Unknown local/imported composition "${root.extends}".`)
      }
    }
  }

  const structuralErrors = issues.filter((entry) => entry.severity === 'error')
  if (structuralErrors.length === 0 && isRecord(raw.root)) {
    const objectCompositions = { ...(raw.compositions as AnyoObjectDocument['compositions'] ?? {}) }
    let rootContractId = '@object:root-contract'
    while (Object.prototype.hasOwnProperty.call(objectCompositions, rootContractId)) rootContractId += '-'
    objectCompositions[rootContractId] = raw.root as unknown as CompositionDefinition
    const synthetic: WorldDocument = {
      version: '0.9',
      metadata: raw.metadata as AnyoObjectDocument['metadata'],
      assets: raw.assets as AnyoObjectDocument['assets'],
      materials: raw.materials as AnyoObjectDocument['materials'],
      curves: raw.curves as AnyoObjectDocument['curves'],
      profiles: raw.profiles as AnyoObjectDocument['profiles'],
      geometries: raw.geometries as AnyoObjectDocument['geometries'],
      imports: raw.imports as AnyoObjectDocument['imports'],
      compositions: objectCompositions,
      entities: [rootAsEntity(raw.root as unknown as CompositionDefinition)],
    }
    const worldResult = inspectWorldDocument(synthetic, options)
    const rootContractPath = `/compositions/${rootContractId.replace(/~/g, '~0').replace(/\//g, '~1')}`
    issues.push(...worldResult.issues.map((entry) => {
      if (entry.path === rootContractPath) return { ...entry, path: '/root' }
      if (entry.path.startsWith(`${rootContractPath}/`)) return { ...entry, path: `/root/${entry.path.slice(rootContractPath.length + 1)}` }
      return remapRootIssue(entry)
    }))
  }

  const errors = issues.filter((entry) => entry.severity === 'error')
  const warnings = issues.filter((entry) => entry.severity === 'warning')
  return { valid: errors.length === 0, issues, errors, warnings }
}

export function validateAnyoObjectDocument(document: AnyoObjectDocument, options: WorldValidationOptions = {}): void {
  const result = inspectAnyoObjectDocument(document, options)
  if (!result.valid) throw new AnyoValidationError(result.errors)
}
