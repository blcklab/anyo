import { OrthographicCamera, PerspectiveCamera, type Camera } from '@blcklab/sekai64'
import type { CameraAdapter, CameraProjection, CanvasProjection, Vec3 } from '../core/types.js'

export class Sekai64CameraAdapter implements CameraAdapter {
  constructor(
    private readonly resolveNativeCamera: () => Camera,
    private readonly applyProjection: (projection: CameraProjection) => void,
    private readonly canvas?: HTMLCanvasElement,
  ) {}

  get nativeCamera(): Camera { return this.resolveNativeCamera() }

  getPosition(): Vec3 {
    const { x, y, z } = this.nativeCamera.position
    return [x, y, z]
  }

  setPosition(position: Vec3): void {
    this.nativeCamera.position.set(position[0], position[1], position[2])
  }

  getRotation(): readonly [number, number] {
    return [this.nativeCamera.rotation.y, this.nativeCamera.rotation.x]
  }

  setRotation(yaw: number, pitch: number): void {
    this.nativeCamera.rotation.set(pitch, yaw, 0, 'XYZ')
  }

  getForward(): Vec3 {
    const yaw = this.nativeCamera.rotation.y
    const pitch = this.nativeCamera.rotation.x
    const cosPitch = Math.cos(pitch)
    return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch]
  }

  getRight(): Vec3 {
    const yaw = this.nativeCamera.rotation.y
    return [Math.cos(yaw), 0, -Math.sin(yaw)]
  }

  getProjection(): CameraProjection {
    const camera = this.nativeCamera
    if (camera instanceof OrthographicCamera) {
      return {
        type: 'orthographic',
        verticalSize: Math.max(.001, camera.top - camera.bottom),
        near: camera.near,
        far: camera.far,
      }
    }
    if (camera instanceof PerspectiveCamera) {
      return {
        type: 'perspective',
        fieldOfView: camera.fieldOfView,
        near: camera.near,
        far: camera.far,
      }
    }
    return { type: 'perspective' }
  }

  setProjection(projection: CameraProjection): void { this.applyProjection(projection) }

  projectWorldPoint(point: Vec3): CanvasProjection {
    this.nativeCamera.updateMatrices()
    const e = this.nativeCamera.viewProjectionMatrix.elements
    const [x, y, z] = point
    const w = (e[3] ?? 0) * x + (e[7] ?? 0) * y + (e[11] ?? 0) * z + (e[15] ?? 1)
    if (Math.abs(w) <= Number.EPSILON) return { x: 0, y: 0, depth: 1, visible: false }
    const ndcX = ((e[0] ?? 0) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0)) / w
    const ndcY = ((e[1] ?? 0) * x + (e[5] ?? 0) * y + (e[9] ?? 0) * z + (e[13] ?? 0)) / w
    const ndcZ = ((e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 0) * z + (e[14] ?? 0)) / w
    const rect = this.canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 }
    return {
      x: rect.left + (ndcX + 1) * 0.5 * rect.width,
      y: rect.top + (1 - ndcY) * 0.5 * rect.height,
      depth: ndcZ,
      visible: ndcZ >= -1 && ndcZ <= 1 && Math.abs(ndcX) <= 1.2 && Math.abs(ndcY) <= 1.2,
    }
  }
}
