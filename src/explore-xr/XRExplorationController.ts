import type {
  PluginRuntimeContext,
  Vec3,
  XRButtonSnapshot,
  XRInputSnapshot,
  XRPlayerRigTransform,
} from '../core/types.js'
import { containsPoint } from '../math/aabb.js'
import { clamp } from '../math/vec3.js'
import { CollisionWorld, type PlayerShape } from '../explore/CollisionWorld.js'
import { TeleportSystem, type TeleportResult } from './TeleportSystem.js'
import type { XRExplorationPluginOptions } from './types.js'

interface ButtonState {
  select: boolean
  squeeze: boolean
}

function button(input: XRInputSnapshot, semantic: XRButtonSnapshot['semantic']): XRButtonSnapshot | undefined {
  return input.buttons.find(candidate => candidate.semantic === semantic)
}

function normalizedXZ(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[2])
  return length > 1e-8 ? [value[0] / length, 0, value[2] / length] : [0, 0, -1]
}

function rotateY(value: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [value[0] * cosine + value[2] * sine, value[1], -value[0] * sine + value[2] * cosine]
}

export class XRExplorationController {
  private readonly collisions: CollisionWorld
  private readonly teleport: TeleportSystem
  private readonly shape: PlayerShape
  private readonly config
  private readonly previousButtons = new Map<string, ButtonState>()
  private readonly snapReady = new Map<string, boolean>()
  private readonly cleanups: Array<() => void> = []
  private teleportResult: TeleportResult | null = null
  private rigInitialized = false
  private gazePrimitive: string | null = null
  private gazeStarted = 0
  private disposed = false

  constructor(
    private readonly context: PluginRuntimeContext,
    options: XRExplorationPluginOptions = {},
  ) {
    const exploration = context.document.exploration ?? {}
    const xr = exploration.xr ?? {}
    this.shape = {
      height: exploration.height ?? 1.75,
      eyeHeight: exploration.eyeHeight ?? 1.65,
      radius: exploration.radius ?? 0.3,
      stepHeight: exploration.stepHeight ?? 0.32,
    }
    this.config = {
      locomotion: options.locomotion ?? xr.locomotion ?? 'teleport',
      turning: options.turning ?? xr.turning ?? 'snap',
      snapAngle: (options.snapAngle ?? xr.snapAngle ?? 30) * Math.PI / 180,
      movementSpeed: options.movementSpeed ?? xr.movementSpeed ?? 1.5,
      turnSpeed: (options.turnSpeed ?? xr.turnSpeed ?? 90) * Math.PI / 180,
      interactionDistance: options.interactionDistance ?? xr.interactionDistance ?? 10,
      dominantHand: options.dominantHand ?? xr.dominantHand ?? 'auto',
      collision: options.collision ?? xr.collision ?? true,
      gazeDwellMs: Math.max(250, options.gazeDwellMs ?? 1200),
      teleportButton: options.teleportButton ?? 'squeeze',
    }
    this.collisions = new CollisionWorld(context.compiled.colliders)
    this.teleport = new TeleportSystem(context.compiled.colliders, this.shape)
    this.cleanups.push(
      context.world.on('xr:session-start', () => {
        this.rigInitialized = false
        this.previousButtons.clear()
        this.snapReady.clear()
      }),
      context.world.on('xr:session-end', () => {
        this.rigInitialized = false
        this.previousButtons.clear()
        this.snapReady.clear()
        this.clearTeleportPreview()
      }),
    )
  }

  setColliders(colliders: PluginRuntimeContext['compiled']['colliders']): void {
    this.collisions.setColliders(colliders)
    this.teleport.setColliders(colliders)
  }

  update(deltaSeconds: number): void {
    if (this.disposed || this.context.world.xr.state !== 'active') return
    const viewer = this.context.world.xr.viewer
    if (!viewer) return
    if (!this.rigInitialized) {
      this.initializeRig(viewer.position)
      return
    }

    this.context.renderer.camera.setPosition(viewer.position)
    const yaw = Math.atan2(-viewer.direction[0], -viewer.direction[2])
    const pitch = Math.asin(clamp(viewer.direction[1], -1, 1))
    this.context.renderer.camera.setRotation(yaw, pitch)
    this.detectRoom(viewer.position)

    const inputs = this.context.world.xr.inputs
    for (const input of inputs) this.updateInput(input, inputs, viewer.position, viewer.direction, deltaSeconds)
    if (!inputs.some(input => input.targetRayMode === 'gaze')) this.resetGaze()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.clearTeleportPreview()
  }

  private initializeRig(viewerPosition: Vec3): void {
    const camera = this.context.renderer.camera
    const desired = camera.getPosition()
    const rig = this.context.world.xr.getPlayerRigTransform()
    const physicalOffset: Vec3 = [
      viewerPosition[0] - rig.position[0],
      viewerPosition[1] - rig.position[1],
      viewerPosition[2] - rig.position[2],
    ]
    this.context.world.xr.setPlayerRigTransform({
      position: [desired[0] - physicalOffset[0], desired[1] - physicalOffset[1], desired[2] - physicalOffset[2]],
      yaw: camera.getRotation()[0],
    })
    this.rigInitialized = true
  }

  private updateInput(
    input: XRInputSnapshot,
    inputs: readonly XRInputSnapshot[],
    viewerPosition: Vec3,
    viewerDirection: Vec3,
    deltaSeconds: number,
  ): void {
    const previous = this.previousButtons.get(input.id) ?? { select: false, squeeze: false }
    const selectPressed = Boolean(button(input, 'select')?.pressed)
    const squeezePressed = Boolean(button(input, 'squeeze')?.pressed)
    const ray = input.targetRay

    if (ray && selectPressed && !previous.select && this.config.teleportButton !== 'select') {
      this.selectRay(input)
    }

    const teleportPressed = this.config.teleportButton === 'select' ? selectPressed : squeezePressed
    const teleportPreviouslyPressed = this.config.teleportButton === 'select' ? previous.select : previous.squeeze
    if (this.config.locomotion === 'teleport' && ray) {
      if (teleportPressed) {
        this.teleportResult = this.teleport.test(ray.position, ray.direction, this.config.interactionDistance * 1.5)
        this.context.world.emit('xr:teleport-preview', { inputId: input.id, ...this.teleportResult })
      } else if (teleportPreviouslyPressed) {
        if (this.teleportResult?.valid && this.teleportResult.position) this.commitTeleport(this.teleportResult.position, viewerPosition)
        this.clearTeleportPreview()
      }
    }

    if (this.config.locomotion === 'smooth') this.updateSmoothMovement(input, inputs, viewerPosition, viewerDirection, deltaSeconds)
    this.updateTurning(input, inputs, viewerPosition, deltaSeconds)
    if (input.targetRayMode === 'gaze' && ray) this.updateGaze(input)

    this.previousButtons.set(input.id, { select: selectPressed, squeeze: squeezePressed })
  }

  private selectRay(input: XRInputSnapshot): void {
    const ray = input.targetRay
    if (!ray || !this.context.renderer.pickRay) return
    const hit = this.context.renderer.pickRay(ray.position, ray.direction, {
      near: 0.02,
      far: this.config.interactionDistance,
      precision: 'triangles',
    })
    if (hit) void this.context.world.selectPrimitive({ ...hit, source: input.targetRayMode === 'gaze' ? 'xr-gaze' : 'xr-controller' })
  }

  private updateGaze(input: XRInputSnapshot): void {
    const ray = input.targetRay
    if (!ray || !this.context.renderer.pickRay) return
    const hit = this.context.renderer.pickRay(ray.position, ray.direction, {
      near: 0.02,
      far: this.config.interactionDistance,
      precision: 'triangles',
    })
    if (!hit) {
      this.resetGaze()
      return
    }
    const time = typeof performance === 'undefined' ? Date.now() : performance.now()
    if (this.gazePrimitive !== hit.primitiveId) {
      this.gazePrimitive = hit.primitiveId
      this.gazeStarted = time
      this.context.world.emit('xr:gaze-target', { primitiveId: hit.primitiveId, progress: 0 })
      return
    }
    const progress = Math.min(1, (time - this.gazeStarted) / this.config.gazeDwellMs)
    this.context.world.emit('xr:gaze-target', { primitiveId: hit.primitiveId, progress })
    if (progress >= 1) {
      void this.context.world.selectPrimitive({ ...hit, source: 'xr-gaze' })
      this.gazeStarted = time + 1_000_000
    }
  }

  private updateSmoothMovement(
    input: XRInputSnapshot,
    inputs: readonly XRInputSnapshot[],
    viewerPosition: Vec3,
    viewerDirection: Vec3,
    deltaSeconds: number,
  ): void {
    if (!this.isMovementInput(input, inputs)) return
    const axes = input.axes
    if (axes.length < 2) return
    const x = axes.length >= 4 ? axes[2] ?? 0 : axes[0] ?? 0
    const z = axes.length >= 4 ? axes[3] ?? 0 : axes[1] ?? 0
    if (Math.hypot(x, z) < 0.15) return
    const forward = normalizedXZ(viewerDirection)
    const right: Vec3 = [-forward[2], 0, forward[0]]
    const speed = this.config.movementSpeed * deltaSeconds
    const delta: Vec3 = [
      (right[0] * x - forward[0] * z) * speed,
      0,
      (right[2] * x - forward[2] * z) * speed,
    ]
    const next = this.config.collision
      ? this.collisions.move(viewerPosition, delta, 0, this.shape).position
      : [viewerPosition[0] + delta[0], viewerPosition[1], viewerPosition[2] + delta[2]] as Vec3
    this.translateRig([next[0] - viewerPosition[0], next[1] - viewerPosition[1], next[2] - viewerPosition[2]])
  }

  private updateTurning(
    input: XRInputSnapshot,
    inputs: readonly XRInputSnapshot[],
    viewerPosition: Vec3,
    deltaSeconds: number,
  ): void {
    if (!this.isTurningInput(input, inputs) || this.config.turning === 'physical' || this.config.turning === 'disabled') return
    const axes = input.axes
    const axis = axes.length >= 4 ? axes[2] ?? 0 : axes[0] ?? 0
    if (this.config.turning === 'snap') {
      const ready = this.snapReady.get(input.id) ?? true
      if (Math.abs(axis) < 0.25) this.snapReady.set(input.id, true)
      else if (ready && Math.abs(axis) > 0.65) {
        this.rotateRigAroundViewer(viewerPosition, axis > 0 ? -this.config.snapAngle : this.config.snapAngle)
        this.snapReady.set(input.id, false)
      }
      return
    }
    if (Math.abs(axis) > 0.15) this.rotateRigAroundViewer(viewerPosition, -axis * this.config.turnSpeed * deltaSeconds)
  }

  private commitTeleport(destination: Vec3, viewerPosition: Vec3): void {
    const rig = this.context.world.xr.getPlayerRigTransform()
    const offset: Vec3 = [viewerPosition[0] - rig.position[0], viewerPosition[1] - rig.position[1], viewerPosition[2] - rig.position[2]]
    this.context.world.xr.setPlayerRigTransform({
      position: [destination[0] - offset[0], destination[1] - offset[1], destination[2] - offset[2]],
      yaw: rig.yaw,
    })
    this.context.world.emit('xr:teleport', { position: destination })
    this.detectRoom(destination)
  }

  private translateRig(delta: Vec3): void {
    const rig = this.context.world.xr.getPlayerRigTransform()
    this.context.world.xr.setPlayerRigTransform({
      position: [rig.position[0] + delta[0], rig.position[1] + delta[1], rig.position[2] + delta[2]],
      yaw: rig.yaw,
    })
  }

  private rotateRigAroundViewer(viewerPosition: Vec3, angle: number): void {
    const rig = this.context.world.xr.getPlayerRigTransform()
    const offset: Vec3 = [viewerPosition[0] - rig.position[0], viewerPosition[1] - rig.position[1], viewerPosition[2] - rig.position[2]]
    const rotated = rotateY(offset, angle)
    this.context.world.xr.setPlayerRigTransform({
      position: [viewerPosition[0] - rotated[0], viewerPosition[1] - rotated[1], viewerPosition[2] - rotated[2]],
      yaw: rig.yaw + angle,
    })
    this.context.world.emit('xr:turn', { angle, yaw: rig.yaw + angle })
  }

  private isMovementInput(input: XRInputSnapshot, inputs: readonly XRInputSnapshot[]): boolean {
    const controllers = inputs.filter(candidate => candidate.axes.length > 0)
    if (controllers.length <= 1) return controllers[0]?.id === input.id
    const preferred = this.config.dominantHand === 'right' ? 'left'
      : this.config.dominantHand === 'left' ? 'right'
        : 'left'
    return (controllers.find(candidate => candidate.handedness === preferred) ?? controllers[0])?.id === input.id
  }

  private isTurningInput(input: XRInputSnapshot, inputs: readonly XRInputSnapshot[]): boolean {
    const controllers = inputs.filter(candidate => candidate.axes.length > 0)
    if (controllers.length <= 1) return controllers[0]?.id === input.id
    const preferred = this.config.dominantHand === 'auto' ? 'right' : this.config.dominantHand
    return (controllers.find(candidate => candidate.handedness === preferred) ?? controllers.at(-1))?.id === input.id
  }

  private detectRoom(position: Vec3): void {
    const room = this.context.compiled.rooms.find(candidate => containsPoint(candidate.bounds, position))
    this.context.world.setCurrentRoom(room?.roomId ?? null)
  }

  private clearTeleportPreview(): void {
    if (this.teleportResult) this.context.world.emit('xr:teleport-preview-end', undefined)
    this.teleportResult = null
  }

  private resetGaze(): void {
    if (this.gazePrimitive) this.context.world.emit('xr:gaze-target-end', { primitiveId: this.gazePrimitive })
    this.gazePrimitive = null
    this.gazeStarted = 0
  }
}
