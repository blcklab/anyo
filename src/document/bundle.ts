import type {
  ResolveWorldImportsOptions,
  ResolvedWorldDocumentGraph,
  WorldDocument,
} from '../core/types.js'
import { validateWorldDocument } from '../schema/validate.js'
import { canonicalizeWorldDocument } from './canonical.js'
import { instantiateResolvedWorldDocument } from './instantiate.js'
import { resolveWorldDocumentImports, resolveWorldDocumentUrls } from './imports.js'

/**
 * Flatten a previously resolved modular Anyo world into one deterministic standalone world document.
 *
 * Imported resources/compositions are already namespace-qualified by Step 6 lowering. Bundling removes
 * only the declarative import dependency; composition reuse is preserved and instances are not expanded.
 */
export function bundleResolvedWorldDocument(graph: ResolvedWorldDocumentGraph): WorldDocument {
  const instantiated = instantiateResolvedWorldDocument(graph)
  const output = graph.sourceContext ? resolveWorldDocumentUrls(instantiated, graph.sourceContext) : instantiated
  delete output.imports
  const bundled = canonicalizeWorldDocument(output)
  validateWorldDocument(bundled)
  return bundled
}

/** Resolve imports and return one deterministic standalone Anyo world document. */
export async function bundleWorldDocument(
  document: WorldDocument,
  options: ResolveWorldImportsOptions = {},
): Promise<WorldDocument> {
  const graph = await resolveWorldDocumentImports(document, options)
  return bundleResolvedWorldDocument(graph)
}
