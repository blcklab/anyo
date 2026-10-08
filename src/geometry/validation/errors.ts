import type { GeometryIssue, GeometryIssueContext } from '../types/index.js'

function mergeContext(issue: GeometryIssue, context: GeometryIssueContext): GeometryIssue {
  return {
    ...issue,
    context: { ...context, ...(issue.context ?? {}) },
  }
}

export class GeometryValidationError extends Error {
  readonly issues: readonly GeometryIssue[]

  constructor(issues: readonly GeometryIssue[], message = issues[0]?.message ?? 'Invalid geometry input.') {
    super(message)
    this.name = 'GeometryValidationError'
    this.issues = issues
  }

  withContext(context: GeometryIssueContext): GeometryValidationError {
    return new GeometryValidationError(this.issues.map(issue => mergeContext(issue, context)), this.message)
  }
}

export function withGeometryValidationContext(error: unknown, context: GeometryIssueContext): never {
  if (error instanceof GeometryValidationError) throw error.withContext(context)
  throw error
}
