import type { CompiledCollider, Vec3 } from '../core/types.js'
import type { PlayerShape } from '../explore/CollisionWorld.js'
import { CollisionWorld } from '../explore/CollisionWorld.js'

export interface TeleportResult {
  valid: boolean
  position?: Vec3
  colliderId?: string
  reason?: string
}

function rayAabbDistance(origin: Vec3, direction: Vec3, collider: CompiledCollider): number | null {
  let near = 0
  let far = Number.POSITIVE_INFINITY
  for (let axis = 0; axis < 3; axis += 1) {
    const value = direction[axis] ?? 0
    const start = origin[axis] ?? 0
    const min = collider.bounds.min[axis] ?? 0
    const max = collider.bounds.max[axis] ?? 0
    if (Math.abs(value) < 1e-8) {
      if (start < min || start > max) return null
      continue
    }
    const inverse = 1 / value
    let first = (min - start) * inverse
    let second = (max - start) * inverse
    if (first > second) [first, second] = [second, first]
    near = Math.max(near, first)
    far = Math.min(far, second)
    if (near > far) return null
  }
  return far >= 0 ? Math.max(0, near) : null
}

export class TeleportSystem {
  private readonly collisionWorld: CollisionWorld

  constructor(
    private colliders: readonly CompiledCollider[],
    private readonly shape: PlayerShape,
  ) {
    this.collisionWorld = new CollisionWorld(colliders)
  }

  setColliders(colliders: readonly CompiledCollider[]): void {
    this.colliders = colliders
    this.collisionWorld.setColliders(colliders)
  }

  test(origin: Vec3, direction: Vec3, maxDistance = 15): TeleportResult {
    if (direction[1] >= -1e-5) return { valid: false, reason: 'Teleport ray does not reach a floor.' }
    let bestDistance = Number.POSITIVE_INFINITY
    let best: CompiledCollider | null = null
    let bestPoint: Vec3 | null = null

    for (const collider of this.colliders) {
      if (!collider.enabled || (collider.kind !== 'floor' && collider.kind !== 'stair')) continue
      const top = collider.bounds.max[1]
      const distance = (top - origin[1]) / direction[1]
      if (distance < 0 || distance > maxDistance || distance >= bestDistance) continue
      const point: Vec3 = [
        origin[0] + direction[0] * distance,
        top,
        origin[2] + direction[2] * distance,
      ]
      const inset = this.shape.radius
      if (
        point[0] < collider.bounds.min[0] + inset ||
        point[0] > collider.bounds.max[0] - inset ||
        point[2] < collider.bounds.min[2] + inset ||
        point[2] > collider.bounds.max[2] - inset
      ) continue
      bestDistance = distance
      best = collider
      bestPoint = point
    }

    if (!best || !bestPoint) return { valid: false, reason: 'No valid floor was found.' }

    for (const collider of this.colliders) {
      if (!collider.enabled || collider.kind === 'floor' || collider.kind === 'stair') continue
      const blockingDistance = rayAabbDistance(origin, direction, collider)
      if (blockingDistance !== null && blockingDistance + 1e-4 < bestDistance) {
        return { valid: false, reason: `Teleport ray is blocked by collider "${collider.id}".` }
      }
    }

    const position: Vec3 = [bestPoint[0], bestPoint[1] + this.shape.eyeHeight, bestPoint[2]]
    if (!this.collisionWorld.canOccupy(position, this.shape)) {
      return { valid: false, reason: 'The destination does not have enough player clearance.' }
    }
    return { valid: true, position, colliderId: best.id }
  }
}
