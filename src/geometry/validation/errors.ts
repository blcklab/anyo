import type { GeometryIssue } from '../types/index.js'

export class GeometryValidationError extends Error {
  readonly issues: readonly GeometryIssue[]

  constructor(issues: readonly GeometryIssue[], message = issues[0]?.message ?? 'Invalid geometry input.') {
    super(message)
    this.name = 'GeometryValidationError'
    this.issues = issues
  }
}
