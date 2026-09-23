import * as THREE from 'three'
import type {
  CompiledPrimitive,
  CompiledWorld,
  MaterialDefinition,
  NormalizedWorldDocument,
  RendererAdapter,
  RuntimeTransformUpdate,
} from '../core/types.js'
import { ThreeCameraAdapter } from './ThreeCameraAdapter.js'
import { createTextTexture } from './textTexture.js'

export interface ThreeRendererOptions {
  canvas: HTMLCanvasElement
  antialias?: boolean
  alpha?: boolean
  shadows?: boolean
  fieldOfView?: number
  near?: number
  far?: number
  toneMappingExposure?: number
}

export class ThreeRenderer implements RendererAdapter {
  readonly canvas: HTMLCanvasElement
  readonly camera: ThreeCameraAdapter
  readonly info = {
    name: 'three',
    capabilities: {
      models: true, text: true, images: true, lights: true,
      ambientLights: true, directionalLights: true, pointLights: true,
      picking: true, trianglePicking: true, instancedPicking: false,
      roomVisibility: true, incrementalUpdates: true, runtimeTransforms: true, instancing: false, shadows: true, xr: false, backend: 'webgl',
      materialFeatures: ['normalScale', 'occlusionStrength', 'emissiveIntensity', 'transmission', 'ior', 'thickness', 'attenuation'],
      colorManagement: true, environmentLighting: true, environmentMaps: true,
    },
  } as const

  private readonly webgl: any
  private readonly scene: any
  private readonly perspectiveCamera: any
  private readonly root: any
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly objects = new Map<string, any>()
  private readonly roomGroups = new Map<string, any>()
  private readonly materialCache = new Map<string, any>()
  private document: NormalizedWorldDocument | null = null
  private compiled: CompiledWorld | null = null
  private disposed = false

  constructor(private readonly options: ThreeRendererOptions) {
    this.canvas = options.canvas
    this.webgl = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: options.antialias ?? true,
      alpha: options.alpha ?? false,
      powerPreference: 'high-performance',
    })
    this.webgl.outputColorSpace = THREE.SRGBColorSpace
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping
    this.webgl.toneMappingExposure = options.toneMappingExposure ?? 1
    this.webgl.shadowMap.enabled = options.shadows ?? false
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.root = new THREE.Group()
    this.root.name = 'AnyoWorld'
    this.scene.add(this.root)
    this.perspectiveCamera = new THREE.PerspectiveCamera(
      options.fieldOfView ?? 70,
      1,
      options.near ?? 0.05,
      options.far ?? 500,
    )
    this.camera = new ThreeCameraAdapter(this.perspectiveCamera, this.canvas)
  }

  async mount(compiled: CompiledWorld, document: NormalizedWorldDocument): Promise<void> {
    this.assertNotDisposed()
    this.clearWorld()
    this.clearMaterialCache()
    this.compiled = compiled
    this.document = document
    this.scene.background = new THREE.Color(document.environment.background)
    this.webgl.toneMappingExposure = this.options.toneMappingExposure ?? document.environment.colorManagement.exposure
    this.webgl.shadowMap.enabled = this.options.shadows ?? document.environment.shadows.enabled
    this.installEnvironment(document)

    for (const room of compiled.rooms) {
      const group = new THREE.Group()
      group.name = `Room:${room.roomId}`
      group.visible = room.visible
      this.roomGroups.set(room.roomId, group)
      this.root.add(group)
    }

    for (const primitive of compiled.primitives) {
      await this.addPrimitive(primitive)
    }
  }

  async updatePrimitive(primitive: CompiledPrimitive): Promise<void> {
    this.assertNotDisposed()
    const existing = this.objects.get(primitive.id)
    if (existing) {
      existing.parent?.remove(existing)
      this.disposeObject(existing, true)
      this.objects.delete(primitive.id)
    }
    await this.addPrimitive(primitive)
  }

  async applyChanges(changes: readonly import('../core/types.js').WorldChange[]): Promise<void> {
    for (const change of changes) {
      switch (change.type) {
        case 'primitive-transform': {
          const object = this.objects.get(change.primitiveId)
          if (object) {
            object.position.set(...change.primitive.transform.position)
            object.rotation.set(...change.primitive.transform.rotation)
            object.scale.set(...change.primitive.transform.scale)
          }
          break
        }
        case 'primitive-visibility':
          this.setPrimitiveVisibility(change.primitiveId, change.visible)
          break
        case 'primitive-material':
        case 'primitive-content':
        case 'primitive-replace':
          await this.updatePrimitive(change.primitive)
          break
        case 'primitive-remove':
          await this.removePrimitive(change.primitiveId)
          break
        case 'room-visibility':
          this.setRoomVisibility(change.roomId, change.visible)
          break
        case 'portal-state':
        case 'resource-graph':
        case 'world-rebuild':
          break
      }
    }
  }

  applyRuntimeTransforms(updates: readonly RuntimeTransformUpdate[]): void {
    for (const update of updates) {
      const object = this.objects.get(update.primitiveId)
      if (!object) continue
      object.position.set(...update.transform.position)
      object.rotation.set(...update.transform.rotation)
      object.scale.set(...update.transform.scale)
    }
  }

  async removePrimitive(primitiveId: string): Promise<void> {
    const object = this.objects.get(primitiveId)
    if (!object) return
    object.parent?.remove(object)
    this.disposeObject(object, true)
    this.objects.delete(primitiveId)
  }

  setPrimitiveVisibility(primitiveId: string, visible: boolean): void {
    const object = this.objects.get(primitiveId)
    if (object) object.visible = visible
  }

  setRoomVisibility(roomId: string, visible: boolean): void {
    const group = this.roomGroups.get(roomId)
    if (group) group.visible = visible
  }

  render(): void {
    this.assertNotDisposed()
    this.webgl.render(this.scene, this.perspectiveCamera)
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    this.assertNotDisposed()
    const safeWidth = Math.max(1, Math.floor(width))
    const safeHeight = Math.max(1, Math.floor(height))
    this.webgl.setPixelRatio(Math.min(Math.max(pixelRatio, 1), 2))
    this.webgl.setSize(safeWidth, safeHeight, false)
    this.perspectiveCamera.aspect = safeWidth / safeHeight
    this.perspectiveCamera.updateProjectionMatrix()
  }

  pick(clientX: number, clientY: number): { entityId?: string; primitiveId: string } | null {
    this.assertNotDisposed()
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.perspectiveCamera)
    const hits = this.raycaster.intersectObject(this.root, true)

    for (const hit of hits) {
      let object: any = hit.object
      while (object) {
        if (object.userData?.anyoPrimitiveId) {
          return {
            primitiveId: object.userData.anyoPrimitiveId,
            entityId: object.userData.anyoEntityId,
          }
        }
        object = object.parent
      }
    }
    return null
  }

  dispose(): void {
    if (this.disposed) return
    this.clearWorld()
    this.clearMaterialCache()
    this.webgl.setAnimationLoop?.(null)
    this.webgl.renderLists?.dispose?.()
    this.webgl.dispose()
    this.webgl.forceContextLoss?.()
    this.disposed = true
  }

  private async addPrimitive(primitive: CompiledPrimitive): Promise<void> {
    const object = await this.createObject(primitive)
    object.name = primitive.id
    object.visible = primitive.visible
    object.position.set(...primitive.transform.position)
    object.rotation.set(...primitive.transform.rotation)
    object.scale.set(...primitive.transform.scale)
    object.userData.anyoPrimitiveId = primitive.id
    object.userData.anyoEntityId = primitive.entityId
    object.traverse?.((child: any) => {
      child.userData.anyoPrimitiveId = primitive.id
      child.userData.anyoEntityId = primitive.entityId
      if ('castShadow' in child) child.castShadow = this.options.shadows ?? false
      if ('receiveShadow' in child) child.receiveShadow = primitive.tags?.includes('floor') ?? false
    })

    const parent = primitive.roomId ? this.roomGroups.get(primitive.roomId) ?? this.root : this.root
    parent.add(object)
    this.objects.set(primitive.id, object)
  }

  private async createObject(primitive: CompiledPrimitive): Promise<any> {
    const size = primitive.size ?? [1, 1, 1]
    switch (primitive.kind) {
      case 'box': {
        const geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
        return new THREE.Mesh(geometry, this.getMaterial(primitive.material, primitive))
      }
      case 'plane': {
        const geometry = new THREE.PlaneGeometry(size[0], size[1])
        return new THREE.Mesh(geometry, this.getMaterial(primitive.material, primitive))
      }
      case 'cylinder': {
        const radius = primitive.radius ?? size[0] / 2
        const height = primitive.height ?? size[1]
        const geometry = new THREE.CylinderGeometry(radius, radius, height, 24)
        return new THREE.Mesh(geometry, this.getMaterial(primitive.material, primitive))
      }
      case 'disc': {
        const radius = primitive.radius ?? size[0] / 2
        const height = primitive.height ?? size[1]
        const geometry = new THREE.CylinderGeometry(radius, radius, height, 32)
        return new THREE.Mesh(geometry, this.getMaterial(primitive.material, primitive))
      }
      case 'cone': {
        const radius = primitive.radius ?? size[0] / 2
        const height = primitive.height ?? size[1]
        const geometry = new THREE.ConeGeometry(radius, height, 20)
        return new THREE.Mesh(geometry, this.getMaterial(primitive.material, primitive))
      }
      case 'sphere': {
        const radius = primitive.radius ?? size[0] / 2
        const geometry = new THREE.SphereGeometry(radius, 16, 10)
        return new THREE.Mesh(geometry, this.getMaterial(primitive.material, primitive))
      }
      case 'text': {
        const texture = createTextTexture(primitive)
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material)
        mesh.userData.anyoOwnedMaterial = true
        return mesh
      }
      case 'image': {
        let texture: any = null
        if (primitive.src) {
          try {
            texture = await new THREE.TextureLoader().loadAsync(primitive.src)
            texture.colorSpace = THREE.SRGBColorSpace
          } catch (error) {
            console.warn(`[Anyo] Failed to load image "${primitive.src}".`, error)
          }
        }
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          color: texture ? '#ffffff' : primitive.color ?? '#d4d4d8',
          transparent: true,
          side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material)
        mesh.userData.anyoOwnedMaterial = true
        return mesh
      }
      case 'model':
        return this.loadModel(primitive)
      case 'light':
        return this.createLight(primitive)
      case 'audio':
        return new THREE.Object3D()
    }
  }

  private async loadModel(primitive: CompiledPrimitive): Promise<any> {
    if (!primitive.src) return this.createFallbackModel(primitive)
    try {
      const module = await import('three/addons/loaders/GLTFLoader.js')
      const loader = new module.GLTFLoader()
      const gltf = await loader.loadAsync(primitive.src)
      const scene = gltf.scene ?? gltf.scenes?.[0]
      if (!scene) throw new Error('The glTF file has no scene.')
      scene.userData.anyoOwnedMaterial = true
      scene.traverse?.((child: any) => { child.userData.anyoOwnedMaterial = true })
      return scene
    } catch (error) {
      console.warn(`[Anyo] Failed to load model "${primitive.src}".`, error)
      return this.createFallbackModel(primitive)
    }
  }

  private createFallbackModel(primitive: CompiledPrimitive): any {
    const size = primitive.size ?? [1, 1, 1]
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      new THREE.MeshStandardMaterial({ color: primitive.color ?? '#a1a1aa', roughness: 0.75 }),
    )
    mesh.userData.anyoOwnedMaterial = true
    return mesh
  }

  private createLight(primitive: CompiledPrimitive): any {
    const color = primitive.color ?? '#ffffff'
    const intensity = primitive.intensity ?? 1
    if (primitive.lightType === 'ambient') return new THREE.AmbientLight(color, intensity)
    if (primitive.lightType === 'directional') { const light = new THREE.DirectionalLight(color, intensity); light.castShadow = primitive.castShadow ?? false; return light }
    const light = new THREE.PointLight(color, intensity, primitive.range ?? 10, primitive.decay ?? 2)
    light.castShadow = primitive.castShadow ?? false
    return light
  }

  private getMaterial(name: string | undefined, primitive: CompiledPrimitive): any {
    const definition = name ? this.document?.materials[name] : undefined
    const defaults = this.defaultMaterial(primitive)
    const effective = { ...defaults, ...definition }
    const key = this.createMaterialCacheKey(name, effective)
    const cached = this.materialCache.get(key)
    if (cached) return cached

    const material = this.createStandardMaterial(effective)
    this.materialCache.set(key, material)
    return material
  }

  private createMaterialCacheKey(name: string | undefined, definition: MaterialDefinition): string {
    return JSON.stringify({
      name: name ?? null,
      color: definition.color ?? null,
      opacity: definition.opacity ?? 1,
      transparent: definition.transparent ?? false,
      side: definition.side ?? 'front',
      emissive: definition.emissive ?? null,
      roughness: definition.roughness ?? null,
      metalness: definition.metalness ?? null,
      wireframe: definition.wireframe ?? false,
    })
  }

  private defaultMaterial(primitive: CompiledPrimitive): MaterialDefinition {
    if (primitive.tags?.includes('floor')) return { color: '#d7d2c8', roughness: 0.78 }
    if (primitive.tags?.includes('ceiling')) return { color: '#fafafa', roughness: 0.95 }
    if (primitive.tags?.includes('wall')) return { color: '#f1f0ec', roughness: 0.9 }
    if (primitive.tags?.includes('window')) return { color: '#b9dce8', roughness: 0.15, opacity: 0.35, transparent: true, side: 'double' }
    if (primitive.tags?.includes('stair')) return { color: '#b9b2a6', roughness: 0.75 }
    return { color: primitive.color ?? '#a8a29e', roughness: 0.7 }
  }

  private createStandardMaterial(definition: MaterialDefinition): any {
    const side = definition.side === 'double'
      ? THREE.DoubleSide
      : definition.side === 'back'
        ? THREE.BackSide
        : THREE.FrontSide
    return new THREE.MeshStandardMaterial({
      color: definition.color ?? '#d4d4d4',
      emissive: definition.emissive ?? '#000000',
      roughness: definition.roughness ?? 0.8,
      metalness: definition.metalness ?? 0,
      opacity: definition.opacity ?? 1,
      transparent: definition.transparent ?? (definition.opacity ?? 1) < 1,
      wireframe: definition.wireframe ?? false,
      side,
      emissiveIntensity: definition.emissiveIntensity ?? 1,
      normalScale: new THREE.Vector2(definition.normalScale ?? 1, definition.normalScale ?? 1),
      aoMapIntensity: definition.occlusionStrength ?? 1,
      transmission: definition.transmission ?? 0,
      ior: definition.ior ?? 1.5,
      thickness: definition.thickness ?? 0,
    })
  }

  private installEnvironment(document: NormalizedWorldDocument): void {
    const ambient = document.environment.ambientLight
    const sun = document.environment.sun
    const ambientLight = new THREE.AmbientLight(ambient.color, ambient.intensity)
    ambientLight.userData.anyoEnvironment = true
    this.root.add(ambientLight)

    const sunLight = new THREE.DirectionalLight(sun.color, sun.intensity)
    sunLight.position.set(...sun.position)
    sunLight.castShadow = this.options.shadows ?? (sun.castShadow && sun.shadow.enabled)
    sunLight.userData.anyoEnvironment = true
    this.root.add(sunLight)
  }

  private clearMaterialCache(): void {
    for (const material of this.materialCache.values()) this.disposeMaterial(material)
    this.materialCache.clear()
  }

  private clearWorld(): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child)
      this.disposeObject(child, true)
    }
    this.objects.clear()
    this.roomGroups.clear()
    this.compiled = null
    this.document = null
    this.scene.background = null
  }

  private disposeObject(object: any, disposeOwnedMaterials: boolean): void {
    object.traverse?.((child: any) => {
      child.geometry?.dispose?.()
      if (!disposeOwnedMaterials && !child.userData?.anyoOwnedMaterial) return
      const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : []
      for (const material of materials) {
        if (this.materialCacheHas(material)) continue
        this.disposeMaterial(material)
      }
    })
  }

  private materialCacheHas(material: any): boolean {
    for (const cached of this.materialCache.values()) if (cached === material) return true
    return false
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('This ThreeRenderer has already been disposed.')
  }

  private disposeMaterial(material: any): void {
    material.map?.dispose?.()
    material.normalMap?.dispose?.()
    material.roughnessMap?.dispose?.()
    material.metalnessMap?.dispose?.()
    material.dispose?.()
  }
}
