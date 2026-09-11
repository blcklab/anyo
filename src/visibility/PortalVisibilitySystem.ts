import type { PluginRuntimeContext } from '../core/types.js'

export interface PortalVisibilityOptions {
  enabled?: boolean
  maxDepth?: number
  hideUnreachableRooms?: boolean
}

export class PortalVisibilitySystem {
  private previousRoom: string | null | undefined
  private readonly visibleRooms = new Set<string>()

  constructor(
    private readonly context: PluginRuntimeContext,
    private readonly options: PortalVisibilityOptions = {},
  ) {}

  update(): void {
    if (this.options.enabled === false || this.context.document.visibility?.enabled === false) return
    const currentRoom = this.context.world.getCurrentRoom()
    if (currentRoom === this.previousRoom) return
    this.previousRoom = currentRoom
    this.recalculate(currentRoom)
  }

  recalculate(currentRoom: string | null): void {
    const hideUnreachable = this.options.hideUnreachableRooms
      ?? this.context.document.visibility?.hideUnreachableRooms
      ?? true

    if (!hideUnreachable || currentRoom === null) {
      for (const room of this.context.compiled.rooms) this.setVisible(room.roomId, true)
      return
    }

    const maxDepth = this.options.maxDepth
      ?? this.context.document.visibility?.maxPortalDepth
      ?? 2
    const reachable = new Set<string>([currentRoom])
    const queue: Array<{ roomId: string; depth: number }> = [{ roomId: currentRoom, depth: 0 }]

    while (queue.length > 0) {
      const item = queue.shift()
      if (!item || item.depth >= maxDepth) continue

      for (const portal of this.context.compiled.portals) {
        if (!portal.open) continue
        const next = portal.fromRoom === item.roomId
          ? portal.toRoom
          : portal.toRoom === item.roomId
            ? portal.fromRoom
            : null
        if (!next || reachable.has(next)) continue
        reachable.add(next)
        queue.push({ roomId: next, depth: item.depth + 1 })
      }
    }

    for (const room of this.context.compiled.rooms) {
      this.setVisible(room.roomId, reachable.has(room.roomId))
    }
  }

  private setVisible(roomId: string, visible: boolean): void {
    const currentlyVisible = this.visibleRooms.has(roomId)
    if (visible === currentlyVisible) return
    if (visible) this.visibleRooms.add(roomId)
    else this.visibleRooms.delete(roomId)
    this.context.world.setRoomVisibility(roomId, visible)
  }
}
