import type { HistoryEntrySummary, WorldDocument, WorldPatch } from '../core/types.js'

export interface HistoryEntry extends HistoryEntrySummary {
  forward: WorldPatch[]
  inverse: WorldPatch[]
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function arrayIdentityChanged(before: unknown[], after: unknown[]): boolean {
  if (before.length !== after.length) return true
  const beforeIds = before.map((value) => value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).id
    : undefined)
  const afterIds = after.map((value) => value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).id
    : undefined)
  const hasIds = beforeIds.some((value) => typeof value === 'string') || afterIds.some((value) => typeof value === 'string')
  return hasIds && beforeIds.some((value, index) => value !== afterIds[index])
}

function pushReplace(
  path: string,
  before: unknown,
  after: unknown,
  forward: WorldPatch[],
  inverse: WorldPatch[],
): void {
  forward.push({ operation: 'replace', path, value: structuredClone(after) })
  inverse.unshift({ operation: 'replace', path, value: structuredClone(before) })
}

function diffValue(
  before: unknown,
  after: unknown,
  path: string,
  forward: WorldPatch[],
  inverse: WorldPatch[],
): void {
  if (Object.is(before, after)) return

  if (Array.isArray(before) && Array.isArray(after)) {
    if (arrayIdentityChanged(before, after)) {
      pushReplace(path, before, after, forward, inverse)
      return
    }
    for (let index = 0; index < before.length; index += 1) {
      diffValue(before[index], after[index], `${path}/${index}`, forward, inverse)
    }
    return
  }

  const beforeObject = before && typeof before === 'object' && !Array.isArray(before)
  const afterObject = after && typeof after === 'object' && !Array.isArray(after)
  if (beforeObject && afterObject) {
    const left = before as Record<string, unknown>
    const right = after as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of [...keys].sort()) {
      const childPath = `${path}/${escapePointer(key)}`
      const inLeft = Object.prototype.hasOwnProperty.call(left, key)
      const inRight = Object.prototype.hasOwnProperty.call(right, key)
      if (!inLeft && inRight) {
        forward.push({ operation: 'add', path: childPath, value: structuredClone(right[key]) })
        inverse.unshift({ operation: 'remove', path: childPath })
      } else if (inLeft && !inRight) {
        forward.push({ operation: 'remove', path: childPath })
        inverse.unshift({ operation: 'add', path: childPath, value: structuredClone(left[key]) })
      } else {
        diffValue(left[key], right[key], childPath, forward, inverse)
      }
    }
    return
  }

  pushReplace(path, before, after, forward, inverse)
}

export function createHistoryEntry(label: string, before: WorldDocument, after: WorldDocument): HistoryEntry | null {
  const forward: WorldPatch[] = []
  const inverse: WorldPatch[] = []
  diffValue(before, after, '', forward, inverse)
  if (forward.length === 0) return null
  return {
    label,
    forward,
    inverse,
    timestamp: Date.now(),
    operationCount: forward.length,
  }
}

export class DocumentHistory {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  constructor(private readonly limit = 100) {}

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  get length(): number { return this.undoStack.length }

  push(label: string, before: WorldDocument, after: WorldDocument): HistoryEntry | null {
    const entry = createHistoryEntry(label, before, after)
    return entry ? this.pushEntry(entry) : null
  }

  pushPatches(label: string, forward: readonly WorldPatch[], inverse: readonly WorldPatch[]): HistoryEntry | null {
    if (forward.length === 0) return null
    return this.pushEntry({
      label,
      forward: structuredClone([...forward]),
      inverse: structuredClone([...inverse]),
      timestamp: Date.now(),
      operationCount: forward.length,
    })
  }

  private pushEntry(entry: HistoryEntry): HistoryEntry {
    this.undoStack.push(entry)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
    return entry
  }

  undo(): HistoryEntry | null {
    const entry = this.undoStack.pop() ?? null
    if (entry) this.redoStack.push(entry)
    return entry
  }

  redo(): HistoryEntry | null {
    const entry = this.redoStack.pop() ?? null
    if (entry) this.undoStack.push(entry)
    return entry
  }

  listUndo(): HistoryEntrySummary[] {
    return this.undoStack.map(({ label, timestamp, operationCount }) => ({ label, timestamp, operationCount }))
  }

  listRedo(): HistoryEntrySummary[] {
    return this.redoStack.map(({ label, timestamp, operationCount }) => ({ label, timestamp, operationCount }))
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
