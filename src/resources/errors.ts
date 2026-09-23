import type { ResourceIssue, ResourceRealizationIssue } from './types.js'

export class ResourceGraphError extends Error {
  readonly issues: readonly ResourceIssue[]

  constructor(issues: readonly ResourceIssue[]) {
    super(issues.map((issue) => `${issue.code}${issue.path ? ` ${issue.path}` : ''}: ${issue.message}`).join('\n'))
    this.name = 'ResourceGraphError'
    this.issues = Object.freeze([...issues])
  }
}

export function resourceError(issue: ResourceIssue): never {
  throw new ResourceGraphError([issue])
}


export class ResourceRealizationError extends Error {
  readonly issue: ResourceRealizationIssue
  readonly rollbackIssues: readonly ResourceRealizationIssue[]

  constructor(issue: ResourceRealizationIssue, rollbackIssues: readonly ResourceRealizationIssue[] = []) {
    super(`${issue.code}${issue.resourceId ? ` ${issue.resourceId}` : ''}: ${issue.message}`)
    this.name = 'ResourceRealizationError'
    this.issue = Object.freeze({ ...issue })
    this.rollbackIssues = Object.freeze([...rollbackIssues])
  }
}
