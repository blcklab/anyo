export type ValidationSeverity = 'error' | 'warning'

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  path: string
  message: string
  suggestion?: string
}

export class AnyoValidationError extends Error {
  readonly issues: readonly string[]
  readonly details: readonly ValidationIssue[]

  constructor(issues: string[] | ValidationIssue[]) {
    const details: ValidationIssue[] = issues.map((issue) => typeof issue === 'string'
      ? { severity: 'error', code: 'INVALID_DOCUMENT', path: '/', message: issue }
      : issue)
    super(`Invalid Anyo world document:\n${details.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`)
    this.name = 'AnyoValidationError'
    this.details = details
    this.issues = details.map((issue) => `${issue.path}: ${issue.message}`)
  }
}
