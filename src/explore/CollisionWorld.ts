import type { CompiledCollider, Vec3 } from '../core/types.js'

export interface PlayerShape {
  height: number
  eyeHeight: number
  radius: number
  stepHeight: number
}

export interface MoveResult {
  position: Vec3
  grounded: boolean
  velocityY: number
}

function horizontalCircleIntersects(position: Vec3, radius: number, collider: CompiledCollider): boolean {
  const nearestX = Math.max(collider.bounds.min[0], Math.min(position[0], collider.bounds.max[0]))
  const nearestZ = Math.max(collider.bounds.min[2], Math.min(position[2], collider.bounds.max[2]))
  const dx = position[0] - nearestX
  const dz = position[2] - nearestZ
  return dx * dx + dz * dz < radius * radius
}

function verticalOverlap(position: Vec3, shape: PlayerShape, collider: CompiledCollider): boolean {
  const feet = position[1] - shape.eyeHeight
  const head = feet + shape.height
  return head > collider.bounds.min[1] + 1e-5 && feet < collider.bounds.max[1] - 1e-5
}

function pointInsideXZ(position: Vec3, collider: CompiledCollider, inset = 0): boolean {
  return (
    position[0] >= collider.bounds.min[0] + inset &&
    position[0] <= collider.bounds.max[0] - inset &&
    position[2] >= collider.bounds.min[2] + inset &&
    position[2] <= collider.bounds.max[2] - inset
  )
}

export class CollisionWorld {
  constructor(private colliders: readonly CompiledCollider[]) {}

  setColliders(colliders: readonly CompiledCollider[]): void {
    this.colliders = colliders
  }

  move(position: Vec3, delta: Vec3, velocityY: number, shape: PlayerShape): MoveResult {
    let next: Vec3 = [position[0], position[1], position[2]]
    let verticalVelocity = velocityY

    next = this.moveAxis(next, delta[0], 0, shape)
    next = this.moveAxis(next, delta[2], 2, shape)

    const proposedY = next[1] + delta[1]
    const feetBefore = next[1] - shape.eyeHeight
    const feetAfter = proposedY - shape.eyeHeight
    const support = this.findSupport(next, Math.max(feetBefore, feetAfter) + shape.stepHeight + 0.05)

    if (verticalVelocity <= 0 && support !== null && feetAfter <= support + 0.05) {
      next = [next[0], support + shape.eyeHeight, next[2]]
      verticalVelocity = 0
      return { position: next, grounded: true, velocityY: verticalVelocity }
    }

    next = [next[0], proposedY, next[2]]
    return { position: next, grounded: false, velocityY: verticalVelocity }
  }

  canOccupy(position: Vec3, shape: PlayerShape): boolean {
    return this.findBlocking(position, shape) === null
  }

  findSupportAt(position: Vec3, maxHeight = Number.POSITIVE_INFINITY): number | null {
    return this.findSupport(position, maxHeight)
  }

  private moveAxis(position: Vec3, amount: number, axis: 0 | 2, shape: PlayerShape): Vec3 {
    if (Math.abs(amount) < 1e-9) return position
    const maxSubstep = Math.max(0.04, shape.radius * 0.4)
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / maxSubstep))
    const increment = amount / steps
    let current = position

    for (let index = 0; index < steps; index += 1) {
      const candidate: Vec3 = axis === 0
        ? [current[0] + increment, current[1], current[2]]
        : [current[0], current[1], current[2] + increment]
      const blocking = this.findBlocking(candidate, shape)
      if (!blocking) {
        current = candidate
        continue
      }

      const feet = current[1] - shape.eyeHeight
      const obstacleTop = blocking.bounds.max[1]
      const climb = obstacleTop - feet
      if (climb > 0 && climb <= shape.stepHeight) {
        const stepped: Vec3 = [candidate[0], current[1] + climb + 0.002, candidate[2]]
        if (!this.findBlocking(stepped, shape)) {
          current = stepped
          continue
        }
      }
      break
    }

    return current
  }

  private findBlocking(position: Vec3, shape: PlayerShape): CompiledCollider | null {
    for (const collider of this.colliders) {
      if (!collider.enabled || collider.kind === 'floor') continue
      if (!verticalOverlap(position, shape, collider)) continue
      if (horizontalCircleIntersects(position, shape.radius, collider)) return collider
    }
    return null
  }

  private findSupport(position: Vec3, maxHeight: number): number | null {
    let support: number | null = null
    for (const collider of this.colliders) {
      if (!collider.enabled) continue
      if (collider.kind !== 'floor' && collider.kind !== 'stair' && collider.kind !== 'solid') continue
      if (!pointInsideXZ(position, collider)) continue
      const top = collider.bounds.max[1]
      if (top <= maxHeight && (support === null || top > support)) support = top
    }
    return support
  }
}
