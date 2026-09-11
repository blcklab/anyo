import type { JsonValue, WorldRuntimeSnapshotInput } from '../core/types.js'
import { assertSafeObjectGraph } from '../schema/safePath.js'
import { canonicalizeJson } from '../document/canonical.js'

export interface SnapshotValidationOptions {
  worldRevision?: number
  worldId?: string
  maximumBytes?: number
  allowFutureRevision?: boolean
}

export interface SnapshotValidationResult {
  valid: boolean
  issues: Array<{ severity: 'error' | 'warning'; code: string; path: string; message: string }>
  bytes: number
}

export function inspectWorldRuntimeSnapshot(
  snapshot: WorldRuntimeSnapshotInput,
  options: SnapshotValidationOptions = {},
): SnapshotValidationResult {
  const issues: SnapshotValidationResult['issues'] = []
  try { assertSafeObjectGraph(snapshot, 'runtime snapshot') }
  catch (error) { issues.push({ severity: 'error', code: 'SNAPSHOT_UNSAFE', path: '', message: String(error instanceof Error ? error.message : error) }) }
  if (snapshot.snapshotVersion !== '1.0') issues.push({ severity: 'error', code: 'SNAPSHOT_VERSION_UNSUPPORTED', path: '/snapshotVersion', message: `Unsupported snapshot version "${String(snapshot.snapshotVersion)}".` })
  if (!Number.isSafeInteger(snapshot.worldRevision) || snapshot.worldRevision < 0) issues.push({ severity: 'error', code: 'SNAPSHOT_REVISION_INVALID', path: '/worldRevision', message: 'worldRevision must be a non-negative safe integer.' })
  if (options.worldRevision !== undefined && snapshot.worldRevision > options.worldRevision && !options.allowFutureRevision) issues.push({ severity: 'error', code: 'SNAPSHOT_FUTURE_REVISION', path: '/worldRevision', message: `Snapshot revision ${snapshot.worldRevision} is newer than world revision ${options.worldRevision}.` })
  if (options.worldId && snapshot.worldId && snapshot.worldId !== options.worldId) issues.push({ severity: 'error', code: 'SNAPSHOT_WORLD_MISMATCH', path: '/worldId', message: `Snapshot world ${snapshot.worldId} does not match ${options.worldId}.` })
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
  if (bytes > (options.maximumBytes ?? 16_000_000)) issues.push({ severity: 'error', code: 'SNAPSHOT_SIZE_EXCEEDED', path: '', message: `Snapshot size ${bytes} exceeds the configured limit.` })
  return { valid: !issues.some((issue) => issue.severity === 'error'), issues, bytes }
}

export function validateWorldRuntimeSnapshot(snapshot: WorldRuntimeSnapshotInput, options: SnapshotValidationOptions = {}): void {
  const result = inspectWorldRuntimeSnapshot(snapshot, options)
  if (!result.valid) throw new Error(result.issues.map((issue) => `${issue.code} ${issue.path}: ${issue.message}`).join('\n'))
}

export function canonicalSnapshotString(snapshot: WorldRuntimeSnapshotInput): string {
  return JSON.stringify(canonicalizeJson(snapshot as unknown as JsonValue))
}
