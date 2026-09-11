import type {
  CameraAdapter,
  CompiledWorld,
  NormalizedWorldDocument,
  PickResult,
  RendererAdapter,
  RendererInfo,
  Vec3,
  WorldChange,
  RuntimeTransformUpdate,
} from './types.js'

class HeadlessCamera implements CameraAdapter {
  private position: Vec3 = [0, 0, 0]
  private rotation: readonly [number, number] = [0, 0]

  getPosition(): Vec3 { return this.position }
  setPosition(position: Vec3): void { this.position = [...position] as Vec3 }
  getRotation(): readonly [number, number] { return this.rotation }
  setRotation(yaw: number, pitch: number): void { this.rotation = [yaw, pitch] }
  getForward(): Vec3 { return [0, 0, -1] }
  getRight(): Vec3 { return [1, 0, 0] }
}

const headlessCanvas = {
  getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
} as unknown as HTMLCanvasElement

export class HeadlessRenderer implements RendererAdapter {
  readonly isHeadless = true
  readonly canvas = headlessCanvas
  readonly camera = new HeadlessCamera()
  readonly info: RendererInfo = {
    name: 'Anyo Headless Renderer',
    version: '0.4.0',
    capabilities: {
      text: true,
      images: true,
      models: true,
      lights: true,
      picking: false,
      roomVisibility: true,
      incrementalUpdates: true,
      runtimeTransforms: true,
      instancing: false,
      shadows: false,
      xr: false,
      webSurfaces: true,
      webSurfaceSnapshots: true,
      webSurfaceDomOverlay: false,
      backend: 'headless',
    },
  }

  mount(_compiled: CompiledWorld, _document: NormalizedWorldDocument): void {}
  applyChanges(_changes: readonly WorldChange[], _compiled: CompiledWorld, _document: NormalizedWorldDocument): void {}
  applyRuntimeTransforms(_updates: readonly RuntimeTransformUpdate[]): void {}
  setRoomVisibility(_roomId: string, _visible: boolean): void {}
  render(_deltaSeconds: number): void {}
  resize(_width: number, _height: number, _pixelRatio?: number): void {}
  pick(_clientX: number, _clientY: number): PickResult | null { return null }
  dispose(): void {}
}

export function isHeadlessRenderer(renderer: RendererAdapter): renderer is HeadlessRenderer {
  return renderer instanceof HeadlessRenderer
}
