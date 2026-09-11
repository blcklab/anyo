import type { Aabb, Bounds3, EntityDefinition, PickResult, Vec3 } from '../core/types.js'

export type EditorSelectionTarget =
  | { kind: 'entity'; id: string }
  | { kind: 'primitive'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'floor'; id: string }

export interface EditorHierarchyNode {
  id: string
  authoringId: string
  type: string
  editable: boolean
  generated: boolean
  sourcePath: string
  bounds?: Aabb
  children: EditorHierarchyNode[]
}


export type EditorFieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'vec2'
  | 'vec3'
  | 'scale'
  | 'select'
  | 'asset'
  | 'material'
  | 'json'

export interface EditorInspectorField {
  path: string
  label: string
  kind: EditorFieldKind
  value: unknown
  readOnly?: boolean
  options?: readonly string[]
}

export interface EditorInspectorSection {
  id: string
  label: string
  fields: EditorInspectorField[]
}

export interface EditorInspectorModel {
  entityId: string
  authoringId: string
  type: string
  sourcePath: string
  editable: boolean
  sections: EditorInspectorSection[]
}

export interface EntityClipboardPayload {
  kind: 'anyo/entities'
  version: 1
  entities: EntityDefinition[]
}

export interface CreateEntityOptions {
  parentId?: string | null
  select?: boolean
  label?: string
}

export interface PasteEntitiesOptions {
  parentId?: string | null
  offset?: Vec3
  label?: string
}

export interface ReparentEntityOptions {
  preserve?: 'world' | 'local'
  label?: string
}

export interface DuplicateEntitiesOptions extends PasteEntitiesOptions {}

export interface EditorMutationResult {
  authoringIds: string[]
  entityIds: string[]
  idMap: Readonly<Record<string, string>>
}

export interface TransformPreviewUpdate {
  position?: Vec3
  rotation?: Vec3
  scale?: number | Vec3
}

export interface EditorSessionOptions {
  createId?: (base: string, used: ReadonlySet<string>) => string
  createAuthoringId?: (base: string) => string
}

export interface ResolvedPick {
  pick: PickResult
  target: EditorSelectionTarget
}

export interface EditorSelectionSnapshot {
  targets: readonly EditorSelectionTarget[]
  bounds: Bounds3 | null
}
