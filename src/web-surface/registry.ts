import type { InteractionSelection, WebSurfaceInteractionDefinition, WorldLike } from '../core/types.js'

export interface WebSurfaceAppContext {
  readonly world: WorldLike
  readonly entityId: string
  readonly primitiveId: string
  readonly signal: AbortSignal
  readonly interaction: Required<WebSurfaceInteractionDefinition>
  runAction(name: string, params?: Record<string, unknown>): Promise<void>
  select(selection?: Partial<InteractionSelection>): Promise<boolean>
}

export interface WebSurfaceAppInstance {
  update?(props: Readonly<Record<string, unknown>>): void | Promise<void>
  setActive?(active: boolean): void
  pause?(): void
  resume?(): void
  dispose(): void
}

export interface RegisteredWebSurfaceApp {
  mount(
    container: HTMLElement,
    props: Readonly<Record<string, unknown>>,
    context: WebSurfaceAppContext,
  ): WebSurfaceAppInstance | (() => void) | void | Promise<WebSurfaceAppInstance | (() => void) | void>
}

export class WebSurfaceAppRegistry {
  private readonly apps = new Map<string, RegisteredWebSurfaceApp>()

  register(id: string, app: RegisteredWebSurfaceApp): () => void {
    const normalized = id.trim()
    if (!normalized) throw new Error('Web-surface app ids must be non-empty strings.')
    if (this.apps.has(normalized)) throw new Error(`Web-surface app "${normalized}" is already registered.`)
    this.apps.set(normalized, app)
    return () => {
      if (this.apps.get(normalized) === app) this.apps.delete(normalized)
    }
  }

  get(id: string): RegisteredWebSurfaceApp | undefined {
    return this.apps.get(id)
  }

  has(id: string): boolean {
    return this.apps.has(id)
  }

  clear(): void {
    this.apps.clear()
  }
}

export function createWebSurfaceAppRegistry(): WebSurfaceAppRegistry {
  return new WebSurfaceAppRegistry()
}
