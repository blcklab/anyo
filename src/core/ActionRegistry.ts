import type { ActionHandler, WorldLike } from './types.js'

export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>()

  constructor(private readonly world: WorldLike) {}

  register(name: string, handler: ActionHandler): () => void {
    if (!name.trim()) throw new Error('Action name must not be empty.')
    this.handlers.set(name, handler)
    return () => this.handlers.delete(name)
  }

  has(name: string): boolean {
    return this.handlers.has(name)
  }

  async run(name: string, params: Record<string, unknown> = {}, source?: string): Promise<void> {
    const handler = this.handlers.get(name)
    if (!handler) {
      throw new Error(`No action named "${name}" is registered.`)
    }

    await handler(params, { world: this.world, source })
  }

  clear(): void {
    this.handlers.clear()
  }
}
