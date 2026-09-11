import type { WorldEventHandler } from './types.js'

export class EventBus {
  private readonly handlers = new Map<string, Set<WorldEventHandler>>()

  on<T = unknown>(event: string, handler: WorldEventHandler<T>): () => void {
    const set = this.handlers.get(event) ?? new Set<WorldEventHandler>()
    set.add(handler as WorldEventHandler)
    this.handlers.set(event, set)

    return () => this.off(event, handler)
  }

  off<T = unknown>(event: string, handler: WorldEventHandler<T>): void {
    const set = this.handlers.get(event)
    if (!set) return
    set.delete(handler as WorldEventHandler)
    if (set.size === 0) this.handlers.delete(event)
  }

  has(event: string): boolean {
    return (this.handlers.get(event)?.size ?? 0) > 0
  }

  emit<T = unknown>(event: string, payload: T): void {
    const set = this.handlers.get(event)
    if (!set) return

    for (const handler of [...set]) {
      handler(payload)
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
