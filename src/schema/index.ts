export { validateWorldDocument, inspectWorldDocument } from './validate.js'
export { inspectWorldSemantics } from './semantic.js'
export type { ValidationResult } from './validate.js'
export { normalizeWorldDocument } from './normalize.js'
export type { NormalizeWorldOptions } from './normalize.js'
export { AnyoValidationError } from './errors.js'
export type { ValidationIssue, ValidationSeverity } from './errors.js'
export { resolveDocumentBindings, getDataPath, setDataPath } from './bindings.js'

export { FORBIDDEN_PATH_SEGMENTS, assertSafePath, hasOwn, parseDataPath, parseJsonPointer, assertSafeObjectGraph } from './safePath.js'

export { inspectArchitectureDocument } from './architecture.js'
export { createWorldSchema } from './composition.js'
export type { ExtensionSchemaContribution, CreateWorldSchemaOptions } from './composition.js'
