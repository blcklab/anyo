import type { ExplorationRuntimeController, PluginRuntimeContext, Vec3 } from '../core/types.js'
import { containsPoint } from '../math/aabb.js'
import { clamp } from '../math/vec3.js'
import { CollisionWorld } from './CollisionWorld.js'

export interface FirstPersonControllerOptions {
  enabled?: boolean
  inputEnabled?: boolean
  /** Installs scoped browser keyboard, mouse, pointer-lock, and touch input. Defaults to true. */
  browserInput?: boolean
  lookSensitivity?: number
  touchLookSensitivity?: number
  pointerLock?: boolean
}

interface TouchState {
  moveId: number | null
  lookId: number | null
  moveStart: readonly [number, number]
  moveCurrent: readonly [number, number]
  lookCurrent: readonly [number, number]
}

function normalizeXZ(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[2])
  return length > 0 ? [value[0] / length, 0, value[2] / length] : [0, 0, 0]
}

export class FirstPersonController implements ExplorationRuntimeController {
  private readonly keys = new Set<string>()
  private readonly collisions: CollisionWorld
  private readonly canvas: HTMLCanvasElement
  private readonly config
  private velocityY = 0
  private yaw = 0
  private pitch = 0
  private disposed = false
  private suspended = false
  private enabledState: boolean
  private inputEnabledState: boolean
  private externalMove: readonly [number, number] = [0, 0]
  private externalRun = false
  private browserInputInstalled = false
  private originalTabIndex: number | null = null
  private readonly xrCleanups: Array<() => void> = []
  private readonly touch: TouchState = {
    moveId: null,
    lookId: null,
    moveStart: [0, 0],
    moveCurrent: [0, 0],
    lookCurrent: [0, 0],
  }

  constructor(
    private readonly context: PluginRuntimeContext,
    private readonly options: FirstPersonControllerOptions = {},
  ) {
    this.canvas = context.renderer.canvas
    this.collisions = new CollisionWorld(context.compiled.colliders)
    this.enabledState = options.enabled ?? true
    this.inputEnabledState = options.inputEnabled ?? true
    const exploration = context.document.exploration ?? {}
    this.config = {
      height: exploration.height ?? 1.75,
      eyeHeight: exploration.eyeHeight ?? 1.65,
      radius: exploration.radius ?? 0.3,
      walkSpeed: exploration.walkSpeed ?? 3.2,
      runSpeed: exploration.runSpeed ?? 5.5,
      gravity: exploration.gravity ?? 9.81,
      stepHeight: exploration.stepHeight ?? 0.32,
      pointerLock: options.pointerLock ?? exploration.pointerLock ?? true,
      lookSensitivity: options.lookSensitivity ?? 0.0022,
      touchLookSensitivity: options.touchLookSensitivity ?? 0.006,
    }
    const rotation = context.renderer.camera.getRotation()
    this.yaw = rotation[0]
    this.pitch = rotation[1]
    this.xrCleanups.push(
      context.world.on('xr:session-start', () => {
        this.suspended = true
        this.clearInput()
        this.releasePointerLock()
      }),
      context.world.on('xr:session-end', () => { this.suspended = false }),
      context.world.on('world:stop', () => {
        this.clearInput()
        this.releasePointerLock()
      }),
    )
    if (options.browserInput !== false) this.installBrowserInput()
  }

  get enabled(): boolean { return this.enabledState }
  get inputEnabled(): boolean { return this.inputEnabledState }

  setEnabled(enabled: boolean): void {
    this.enabledState = Boolean(enabled)
    if (!this.enabledState) {
      this.clearInput()
      this.releasePointerLock()
    }
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabledState = Boolean(enabled)
    if (!this.inputEnabledState) {
      this.clearInput()
      this.releasePointerLock()
    }
  }

  setMoveAxes(right: number, forward: number): void {
    this.externalMove = [clamp(Number.isFinite(right) ? right : 0, -1, 1), clamp(Number.isFinite(forward) ? forward : 0, -1, 1)]
  }

  setRun(running: boolean): void { this.externalRun = Boolean(running) }

  addLookDelta(deltaX: number, deltaY: number): void {
    if (!this.canAcceptInput()) return
    this.applyLook(deltaX, deltaY, this.config.lookSensitivity)
  }

  clearInput(): void {
    this.keys.clear()
    this.externalMove = [0, 0]
    this.externalRun = false
    this.touch.moveId = null
    this.touch.lookId = null
  }

  releasePointerLock(): void {
    if (typeof document !== 'undefined' && document.pointerLockElement === this.canvas) void document.exitPointerLock?.()
  }

  setColliders(colliders: PluginRuntimeContext['compiled']['colliders']): void {
    this.collisions.setColliders(colliders)
  }

  update(deltaSeconds: number): void {
    if (this.disposed || !this.enabledState || !this.inputEnabledState || this.suspended || this.context.world.xr.state === 'active') return

    const camera = this.context.renderer.camera
    const forward = normalizeXZ(camera.getForward())
    const right = normalizeXZ(camera.getRight())
    const touchAxes = this.getTouchMoveAxes()
    const keyboardForward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'))
    const keyboardRight = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'))
    const moveForward = clamp(keyboardForward + touchAxes[1] + this.externalMove[1], -1, 1)
    const moveRight = clamp(keyboardRight + touchAxes[0] + this.externalMove[0], -1, 1)
    const moveLength = Math.hypot(moveForward, moveRight) || 1
    const running = this.externalRun || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const speed = running ? this.config.runSpeed : this.config.walkSpeed
    const horizontal: Vec3 = [
      ((forward[0] * moveForward + right[0] * moveRight) / moveLength) * speed * deltaSeconds,
      0,
      ((forward[2] * moveForward + right[2] * moveRight) / moveLength) * speed * deltaSeconds,
    ]

    this.velocityY -= this.config.gravity * deltaSeconds
    const vertical = this.velocityY * deltaSeconds
    const result = this.collisions.move(
      camera.getPosition(),
      [horizontal[0], vertical, horizontal[2]],
      this.velocityY,
      {
        height: this.config.height,
        eyeHeight: this.config.eyeHeight,
        radius: this.config.radius,
        stepHeight: this.config.stepHeight,
      },
    )
    this.velocityY = result.velocityY
    camera.setPosition(result.position)
    this.detectRoom(result.position)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearInput()
    this.releasePointerLock()
    this.uninstallBrowserInput()
    for (const cleanup of this.xrCleanups.splice(0)) cleanup()
  }

  private canAcceptInput(): boolean {
    return !this.disposed && this.enabledState && this.inputEnabledState && !this.suspended && this.context.world.xr.state !== 'active'
  }

  private installBrowserInput(): void {
    if (this.browserInputInstalled || typeof window === 'undefined' || typeof document === 'undefined') return
    this.browserInputInstalled = true
    this.originalTabIndex = this.canvas.tabIndex
    if (this.canvas.tabIndex < 0) this.canvas.tabIndex = 0
    this.canvas.addEventListener('keydown', this.onKeyDown)
    this.canvas.addEventListener('keyup', this.onKeyUp)
    this.canvas.addEventListener('blur', this.onBlur)
    document.addEventListener('mousemove', this.onMouseMove)
    this.canvas.addEventListener('click', this.onCanvasClick)
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false })
    this.canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false })
  }

  private uninstallBrowserInput(): void {
    if (!this.browserInputInstalled || typeof document === 'undefined') return
    this.browserInputInstalled = false
    this.canvas.removeEventListener('keydown', this.onKeyDown)
    this.canvas.removeEventListener('keyup', this.onKeyUp)
    this.canvas.removeEventListener('blur', this.onBlur)
    document.removeEventListener('mousemove', this.onMouseMove)
    this.canvas.removeEventListener('click', this.onCanvasClick)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    this.canvas.removeEventListener('touchend', this.onTouchEnd)
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd)
    if (this.originalTabIndex !== null) this.canvas.tabIndex = this.originalTabIndex
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.canAcceptInput()) return
    this.keys.add(event.code)
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code) }
  private readonly onBlur = (): void => { this.clearInput() }

  private readonly onCanvasClick = (): void => {
    if (!this.canAcceptInput()) return
    this.canvas.focus?.({ preventScroll: true })
    if (!this.config.pointerLock || document.pointerLockElement === this.canvas) return
    void this.canvas.requestPointerLock?.()
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.canAcceptInput()) return
    if (this.config.pointerLock) {
      if (document.pointerLockElement !== this.canvas) return
    } else if (event.target !== this.canvas) return
    this.applyLook(event.movementX, event.movementY, this.config.lookSensitivity)
  }

  private applyLook(deltaX: number, deltaY: number, sensitivity: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return
    this.yaw -= deltaX * sensitivity
    this.pitch = clamp(this.pitch - deltaY * sensitivity, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02)
    this.context.renderer.camera.setRotation(this.yaw, this.pitch)
  }

  private readonly onTouchStart = (event: TouchEvent): void => {
    if (!this.canAcceptInput()) return
    event.preventDefault()
    this.canvas.focus?.({ preventScroll: true })
    const rect = this.canvas.getBoundingClientRect()
    for (const touch of Array.from(event.changedTouches)) {
      const isMoveSide = touch.clientX < rect.left + rect.width / 2
      if (isMoveSide && this.touch.moveId === null) {
        this.touch.moveId = touch.identifier
        this.touch.moveStart = [touch.clientX, touch.clientY]
        this.touch.moveCurrent = [touch.clientX, touch.clientY]
      } else if (!isMoveSide && this.touch.lookId === null) {
        this.touch.lookId = touch.identifier
        this.touch.lookCurrent = [touch.clientX, touch.clientY]
      }
    }
  }

  private readonly onTouchMove = (event: TouchEvent): void => {
    if (!this.canAcceptInput()) return
    event.preventDefault()
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.touch.moveId) this.touch.moveCurrent = [touch.clientX, touch.clientY]
      if (touch.identifier === this.touch.lookId) {
        const dx = touch.clientX - this.touch.lookCurrent[0]
        const dy = touch.clientY - this.touch.lookCurrent[1]
        this.touch.lookCurrent = [touch.clientX, touch.clientY]
        this.applyLook(dx, dy, this.config.touchLookSensitivity)
      }
    }
  }

  private readonly onTouchEnd = (event: TouchEvent): void => {
    if (!this.canAcceptInput()) return
    event.preventDefault()
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.touch.moveId) this.touch.moveId = null
      if (touch.identifier === this.touch.lookId) this.touch.lookId = null
    }
  }

  private getTouchMoveAxes(): readonly [number, number] {
    if (this.touch.moveId === null) return [0, 0]
    const dx = clamp((this.touch.moveCurrent[0] - this.touch.moveStart[0]) / 50, -1, 1)
    const dy = clamp((this.touch.moveCurrent[1] - this.touch.moveStart[1]) / 50, -1, 1)
    return [dx, -dy]
  }

  private detectRoom(position: Vec3): void {
    const room = this.context.compiled.rooms.find((candidate) => containsPoint(candidate.bounds, position))
    this.context.world.setCurrentRoom(room?.roomId ?? null)
  }
}
