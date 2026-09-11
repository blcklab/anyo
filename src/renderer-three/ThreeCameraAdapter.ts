import * as THREE from 'three'
import type { CameraAdapter, CanvasProjection, Vec3 } from '../core/types.js'

export class ThreeCameraAdapter implements CameraAdapter {
  constructor(private readonly camera: any, private readonly canvas?: HTMLCanvasElement) {
    this.camera.rotation.order = 'YXZ'
  }

  getPosition(): Vec3 {
    return [this.camera.position.x, this.camera.position.y, this.camera.position.z]
  }

  setPosition(position: Vec3): void {
    this.camera.position.set(position[0], position[1], position[2])
  }

  getRotation(): readonly [number, number] {
    return [this.camera.rotation.y, this.camera.rotation.x]
  }

  setRotation(yaw: number, pitch: number): void {
    this.camera.rotation.y = yaw
    this.camera.rotation.x = pitch
  }

  getForward(): Vec3 {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    return [direction.x, direction.y, direction.z]
  }

  getRight(): Vec3 {
    const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    return [direction.x, direction.y, direction.z]
  }

  projectWorldPoint(point: Vec3): CanvasProjection {
    this.camera.updateMatrixWorld?.()
    const projected = new THREE.Vector3(point[0], point[1], point[2]).project(this.camera)
    const rect = this.canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 }
    return {
      x: rect.left + (projected.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - projected.y) * 0.5 * rect.height,
      depth: projected.z,
      visible: projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1.2 && Math.abs(projected.y) <= 1.2,
    }
  }
}

