export { EditorSession } from './EditorSession.js'
export type {
  CreateEntityOptions,
  DuplicateEntitiesOptions,
  EditorFieldKind,
  EditorHierarchyNode,
  EditorInspectorField,
  EditorInspectorModel,
  EditorInspectorSection,
  EditorMutationResult,
  EditorSelectionSnapshot,
  EditorSelectionTarget,
  EditorSessionOptions,
  EntityClipboardPayload,
  PasteEntitiesOptions,
  ReparentEntityOptions,
  ResolvedPick,
  TransformPreviewUpdate,
} from './types.js'

import type { World } from '../core/World.js'
import { EditorSession } from './EditorSession.js'
import type { EditorSessionOptions } from './types.js'

export function createEditorSession(world: World, options?: EditorSessionOptions): EditorSession {
  return new EditorSession(world, options)
}
