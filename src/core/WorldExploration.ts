import type {
  ExplorationRuntimeController,
  WorldExplorationControllerLike,
} from './types.js'

const clampAxis = (value: number): number => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0

export class WorldExplorationController implements WorldExplorationControllerLike {
  private readonly controllers: ExplorationRuntimeController[] = []
  private desiredEnabled = true
  private desiredInputEnabled = true
  private moveRight = 0
  private moveForward = 0
  private running = false

  private get controller(): ExplorationRuntimeController | null {
    return this.controllers.at(-1) ?? null
  }

  get available(): boolean { return this.controller !== null }
  get enabled(): boolean { return this.controller?.enabled ?? this.desiredEnabled }
  get inputEnabled(): boolean { return this.controller?.inputEnabled ?? this.desiredInputEnabled }

  bind(controller: ExplorationRuntimeController): () => void {
    const existingIndex = this.controllers.indexOf(controller)
    if (existingIndex >= 0) this.controllers.splice(existingIndex, 1)
    const previous = this.controller
    if (previous && previous !== controller) this.deactivate(previous)
    this.controllers.push(controller)
    this.activate(controller)
    let active = true
    return () => {
      if (!active) return
      active = false
      const index = this.controllers.indexOf(controller)
      if (index < 0) return
      const wasActive = index === this.controllers.length - 1
      this.controllers.splice(index, 1)
      this.deactivate(controller)
      if (wasActive) {
        const restored = this.controller
        if (restored) this.activate(restored)
      }
    }
  }

  setWorldRunning(running: boolean): void {
    this.running = running
    this.controller?.setInputEnabled(this.desiredInputEnabled && running)
    if (!running) {
      this.controller?.clearInput()
      this.controller?.releasePointerLock()
    }
  }

  setEnabled(enabled: boolean): void {
    this.desiredEnabled = Boolean(enabled)
    this.controller?.setEnabled(this.desiredEnabled)
  }

  setInputEnabled(enabled: boolean): void {
    this.desiredInputEnabled = Boolean(enabled)
    this.controller?.setInputEnabled(this.desiredInputEnabled && this.running)
  }

  clearInput(): void {
    this.moveRight = 0
    this.moveForward = 0
    this.controller?.clearInput()
  }

  releasePointerLock(): void { this.controller?.releasePointerLock() }

  setMoveAxes(right: number, forward: number): void {
    this.moveRight = clampAxis(right)
    this.moveForward = clampAxis(forward)
    this.controller?.setMoveAxes(this.moveRight, this.moveForward)
  }

  setRun(running: boolean): void { this.controller?.setRun(Boolean(running)) }
  addLookDelta(deltaX: number, deltaY: number): void { this.controller?.addLookDelta(deltaX, deltaY) }
  requestJump(): void { this.controller?.requestJump?.() }

  dispose(): void {
    for (const controller of this.controllers.splice(0).reverse()) this.deactivate(controller)
  }

  private activate(controller: ExplorationRuntimeController): void {
    controller.setEnabled(this.desiredEnabled)
    controller.setInputEnabled(this.desiredInputEnabled && this.running)
    controller.setMoveAxes(this.moveRight, this.moveForward)
  }

  private deactivate(controller: ExplorationRuntimeController): void {
    controller.clearInput()
    controller.setInputEnabled(false)
    controller.releasePointerLock()
  }
}
