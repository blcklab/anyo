import type {
  CompiledPrimitive,
  CompiledWebSurface,
  PluginRuntimeContext,
  RendererAdapter,
  WebSurfaceAnimationDefinition,
  WebSurfaceUrlSource,
} from '../core/types.js'
import { projectWebSurface } from './projection.js'
import { resolveWebSurfaceTarget } from './target.js'
import type {
  WebSurfaceAppContext,
  WebSurfaceAppInstance,
  WebSurfaceAppRegistry,
} from './registry.js'

export interface WebSurfaceDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  entityId?: string
  primitiveId?: string
  details?: Readonly<Record<string, unknown>>
}

export interface WebSurfaceExternalUrlPolicy {
  allowedOrigins: readonly string[]
  sandbox?: readonly string[]
  allow?: string
  referrerPolicy?: ReferrerPolicy
}

export interface WebSurfaceRuntimeOptions {
  registry: WebSurfaceAppRegistry
  root?: HTMLElement
  zIndex?: number
  externalUrls?: WebSurfaceExternalUrlPolicy
  onDiagnostic?: (diagnostic: WebSurfaceDiagnostic) => void
  /** Generic host-controlled presentation filter used by optional presentation packages. */
  shouldPresent?: (primitive: CompiledPrimitive & { webSurface: CompiledWebSurface }, context: PluginRuntimeContext) => boolean
  /** Hides the renderer snapshot/plane while a live DOM presentation owns the surface. Defaults to true. */
  hideFallbackWhileActive?: boolean
}

interface MountedSurface {
  primitive: CompiledPrimitive
  definition: CompiledWebSurface
  element: HTMLElement
  content: HTMLElement
  controller: AbortController
  app?: WebSurfaceAppInstance
  active: boolean
  presentationReady: boolean
  appId?: string
  propsJson?: string
  layoutKey?: string
  diagnostics: Set<string>
  renderer: RendererAdapter
  fallbackHidden: boolean
}

function normalizeInstance(value: WebSurfaceAppInstance | (() => void) | void): WebSurfaceAppInstance {
  if (typeof value === 'function') return { dispose: value }
  return value ?? { dispose() {} }
}

function animationFrames(preset: WebSurfaceAnimationDefinition['preset']): Keyframe[] {
  switch (preset) {
    case 'fade': return [{ opacity: 0 }, { opacity: 1 }]
    case 'fade-slide-up': return [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }]
    case 'scale-in': return [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }]
    case 'pulse': return [{ transform: 'scale(1)' }, { transform: 'scale(1.025)' }, { transform: 'scale(1)' }]
  }
}

function safeOrigin(url: string): string | null {
  try { return new URL(url, globalThis.location?.href).origin }
  catch { return null }
}

function makeRoot(zIndex: number): HTMLElement {
  const root = globalThis.document.createElement('div')
  root.dataset.anyoWebSurfaces = ''
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: String(zIndex),
    overflow: 'hidden',
    contain: 'layout style paint',
  })
  globalThis.document.body.append(root)
  return root
}

function createSurfaceElement(definition: CompiledWebSurface, primitive: CompiledPrimitive): { element: HTMLElement; content: HTMLElement } {
  const element = globalThis.document.createElement('section')
  element.dataset.anyoWebSurface = primitive.entityId ?? primitive.id
  element.setAttribute('aria-label', definition.title ?? primitive.entityId ?? 'Web surface')
  element.setAttribute('aria-hidden', 'true')
  element.inert = true
  if (definition.className) element.className = definition.className
  Object.assign(element.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    transformOrigin: 'center',
    overflow: definition.interaction.scroll ? 'auto' : 'hidden',
    pointerEvents: 'none',
    visibility: 'hidden',
    backfaceVisibility: 'hidden',
    willChange: 'transform,width,height,opacity',
    boxSizing: 'border-box',
  })
  const content = globalThis.document.createElement('div')
  content.dataset.anyoWebSurfaceContent = ''
  Object.assign(content.style, {
    width: '100%',
    height: '100%',
    minWidth: '0',
    minHeight: '0',
    overflow: 'inherit',
    boxSizing: 'border-box',
    containerType: 'size',
  })
  element.append(content)
  return { element, content }
}

function presentationIdentity(definition: CompiledWebSurface): string {
  const source = definition.source
  if (source.type === 'app') return `app:${definition.renderMode}:${source.app}`
  if (source.type === 'url') return `url:${definition.renderMode}:${source.url}:${source.title ?? ''}`
  return `snapshot:${definition.renderMode}:${source.image}`
}

function roundLayout(value: number): number {
  return Math.round(value * 1000) / 1000
}

export class WebSurfaceRuntime {
  readonly capabilities: {
    readonly registeredApps: true
    readonly snapshots: true
    readonly domOverlay: boolean
    readonly externalUrls: boolean
    readonly liveXRPresentation: false
  }

  private readonly mounted = new Map<string, MountedSurface>()
  private readonly ownsRoot: boolean
  private readonly root: HTMLElement | null
  private disposed = false
  private reducedMotion = false

  constructor(private readonly options: WebSurfaceRuntimeOptions) {
    this.capabilities = Object.freeze({
      registeredApps: true,
      snapshots: true,
      domOverlay: typeof document !== 'undefined',
      externalUrls: Boolean(options.externalUrls),
      liveXRPresentation: false,
    })
    if (typeof document === 'undefined') {
      this.root = null
      this.ownsRoot = false
      return
    }
    this.root = options.root ?? makeRoot(options.zIndex ?? 20)
    this.ownsRoot = !options.root
    this.reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const sandbox = new Set(options.externalUrls?.sandbox ?? [])
    if (sandbox.has('allow-scripts') && sandbox.has('allow-same-origin')) {
      throw new Error('Web-surface external URL policy must not combine allow-scripts with allow-same-origin.')
    }
  }

  async sync(context: PluginRuntimeContext): Promise<void> {
    if (!this.root || this.disposed) return
    const available = new Map(
      context.compiled.primitives
        .filter((primitive): primitive is CompiledPrimitive & { webSurface: CompiledWebSurface } => Boolean(primitive.webSurface))
        .map((primitive) => [primitive.id, primitive]),
    )
    const current = new Map(
      [...available.values()]
        .filter(primitive => this.options.shouldPresent?.(primitive, context) ?? true)
        .map((primitive) => [primitive.id, primitive]),
    )

    for (const id of this.mounted.keys()) {
      if (!current.has(id)) this.unmount(id, !available.has(id))
    }

    for (const primitive of current.values()) {
      const existing = this.mounted.get(primitive.id)
      if (!existing) await this.mount(primitive, context)
      else await this.updateMounted(existing, primitive, context)
    }
  }

  update(context: PluginRuntimeContext): void {
    if (!this.root || this.disposed) return
    const xrActive = context.world.xr.state === 'active' || context.world.xr.state === 'entering'
    for (const surface of this.mounted.values()) {
      if (!this.canProject(surface, context, xrActive)) {
        this.setActive(surface, false)
        continue
      }
      if (!context.renderer.camera.projectWorldPoint) {
        this.diagnosticOnce(surface, {
          severity: 'warning',
          code: 'WEB_SURFACE_PROJECTION_UNAVAILABLE',
          message: 'The active renderer does not expose camera projection for DOM web surfaces.',
        })
        this.setActive(surface, false)
        continue
      }

      const projection = projectWebSurface(context.renderer.camera, surface.primitive)
      if (!projection) {
        this.diagnosticOnce(surface, {
          severity: 'warning',
          code: 'WEB_SURFACE_PROJECTION_INVALID',
          message: 'The web surface produced an invalid or non-finite camera projection and was hidden safely.',
        })
        this.setActive(surface, false)
        continue
      }

      const visible = projection.visible
      this.setActive(surface, visible)
      if (!visible) continue
      this.applyLayout(surface, projection)
    }
  }

  dispose(): void {
    if (this.disposed) return
    for (const id of [...this.mounted.keys()]) this.unmount(id)
    if (this.ownsRoot) this.root?.remove()
    this.disposed = true
  }

  private async mount(primitive: CompiledPrimitive & { webSurface: CompiledWebSurface }, context: PluginRuntimeContext): Promise<void> {
    if (!this.root) return
    const { element, content } = createSurfaceElement(primitive.webSurface, primitive)
    const mounted: MountedSurface = {
      primitive,
      definition: primitive.webSurface,
      element,
      content,
      controller: new AbortController(),
      active: false,
      presentationReady: false,
      diagnostics: new Set(),
      renderer: context.renderer,
      fallbackHidden: false,
    }
    this.mounted.set(primitive.id, mounted)
    this.root.append(element)
    this.installAnimationEvents(mounted)
    this.diagnoseTargetFallback(mounted, context)
    await this.mountContent(mounted, context)
    if (mounted.presentationReady) this.play(mounted, 'mount')
  }

  private async updateMounted(surface: MountedSurface, primitive: CompiledPrimitive & { webSurface: CompiledWebSurface }, context: PluginRuntimeContext): Promise<void> {
    const previousDefinition = surface.definition
    surface.primitive = primitive
    surface.definition = primitive.webSurface
    surface.renderer = context.renderer
    surface.element.className = primitive.webSurface.className ?? ''
    surface.element.setAttribute('aria-label', primitive.webSurface.title ?? primitive.entityId ?? 'Web surface')
    surface.element.style.overflow = primitive.webSurface.interaction.scroll ? 'auto' : 'hidden'
    this.applyInteractionState(surface)
    this.diagnoseTargetFallback(surface, context)

    const contentChanged = presentationIdentity(previousDefinition) !== presentationIdentity(primitive.webSurface)
      || JSON.stringify(previousDefinition.interaction) !== JSON.stringify(primitive.webSurface.interaction)
    if (contentChanged) {
      await this.remountContent(surface, context)
      return
    }

    const nextSource = primitive.webSurface.source
    if (nextSource.type === 'app' && surface.app?.update) {
      const props = nextSource.props ?? {}
      const json = JSON.stringify(props)
      if (json !== surface.propsJson) {
        await surface.app.update(Object.freeze(structuredClone(props)))
        surface.propsJson = json
      }
    }
  }

  private async remountContent(surface: MountedSurface, context: PluginRuntimeContext): Promise<void> {
    this.setActive(surface, false)
    surface.controller.abort()
    this.disposeApp(surface)
    surface.presentationReady = false
    surface.appId = undefined
    surface.propsJson = undefined
    surface.layoutKey = undefined
    surface.controller = new AbortController()
    surface.content.replaceChildren()
    this.installAnimationEvents(surface)
    await this.mountContent(surface, context)
    if (surface.presentationReady) this.play(surface, 'mount')
  }

  private async mountContent(surface: MountedSurface, context: PluginRuntimeContext): Promise<void> {
    const source = surface.definition.source
    surface.presentationReady = false
    if (source.type === 'snapshot' || surface.definition.renderMode === 'snapshot') return
    if (source.type === 'url') {
      if (surface.definition.renderMode === 'external') this.mountExternalLink(surface, source)
      else this.mountExternalUrl(surface, source)
      return
    }
    if (surface.definition.renderMode === 'external') {
      this.diagnosticOnce(surface, { severity: 'warning', code: 'WEB_SURFACE_EXTERNAL_APP_UNSUPPORTED', message: 'Registered app sources cannot use renderMode "external". Use a URL source or snapshot fallback.' })
      return
    }
    const registration = this.options.registry.get(source.app)
    if (!registration) {
      this.diagnosticOnce(surface, { severity: 'warning', code: 'WEB_SURFACE_APP_NOT_REGISTERED', message: `Web-surface app "${source.app}" is not registered. The snapshot fallback remains available.` })
      return
    }
    const appContext: WebSurfaceAppContext = {
      world: context.world,
      entityId: surface.primitive.entityId ?? surface.primitive.id,
      primitiveId: surface.primitive.id,
      signal: surface.controller.signal,
      interaction: surface.definition.interaction,
      runAction: (name, params = {}) => context.world.runAction(name, params, 'web-surface'),
      select: selection => context.world.selectPrimitive({
        primitiveId: surface.primitive.id,
        entityId: surface.primitive.entityId,
        source: 'web-surface',
        ...selection,
      }),
    }
    const props = Object.freeze(structuredClone(source.props ?? {}))
    const result = await registration.mount(surface.content, props, appContext)
    const instance = normalizeInstance(result)
    if (surface.controller.signal.aborted) {
      this.invoke(surface, 'dispose', () => instance.dispose())
      return
    }
    surface.app = instance
    surface.appId = source.app
    surface.propsJson = JSON.stringify(props)
    surface.presentationReady = true
  }

  private mountExternalLink(surface: MountedSurface, source: WebSurfaceUrlSource): void {
    const policy = this.options.externalUrls
    const origin = safeOrigin(source.url)
    if (!policy || !origin || !policy.allowedOrigins.includes(origin)) {
      this.diagnosticOnce(surface, { severity: 'warning', code: 'WEB_SURFACE_URL_BLOCKED', message: `External web surface URL is not allowed: ${source.url}` })
      return
    }
    const link = globalThis.document.createElement('a')
    link.href = source.url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = source.title ?? surface.definition.title ?? 'Open web content'
    Object.assign(link.style, { width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'inherit', background: 'rgba(15,23,42,.92)', font: '600 1rem system-ui,sans-serif' })
    surface.content.append(link)
    surface.presentationReady = true
  }

  private mountExternalUrl(surface: MountedSurface, source: WebSurfaceUrlSource): void {
    const policy = this.options.externalUrls
    const origin = safeOrigin(source.url)
    if (!policy || !origin || !policy.allowedOrigins.includes(origin)) {
      this.diagnosticOnce(surface, { severity: 'warning', code: 'WEB_SURFACE_URL_BLOCKED', message: `External web surface URL is not allowed: ${source.url}` })
      return
    }
    const frame = globalThis.document.createElement('iframe')
    frame.src = source.url
    frame.title = source.title ?? surface.definition.title ?? 'Embedded web surface'
    frame.referrerPolicy = policy.referrerPolicy ?? 'no-referrer'
    frame.setAttribute('sandbox', (policy.sandbox ?? []).join(' '))
    if (policy.allow) frame.setAttribute('allow', policy.allow)
    Object.assign(frame.style, { width: '100%', height: '100%', border: '0', display: 'block' })
    frame.addEventListener('error', () => {
      if (surface.controller.signal.aborted) return
      surface.presentationReady = false
      this.setActive(surface, false)
      surface.content.replaceChildren()
      this.diagnosticOnce(surface, {
        severity: 'warning',
        code: 'WEB_SURFACE_EMBED_FAILED',
        message: `The browser failed to load the embedded web surface. The renderer snapshot fallback remains available: ${source.url}`,
      })
    }, { once: true, signal: surface.controller.signal })
    surface.content.append(frame)
    surface.presentationReady = true
  }

  private canProject(surface: MountedSurface, context: PluginRuntimeContext, xrActive: boolean): boolean {
    if (!surface.presentationReady || xrActive || !surface.primitive.visible) return false
    const roomId = surface.primitive.roomId
    if (!roomId) return true
    const room = context.compiled.roomById.get(roomId)
    if (!room) {
      this.diagnosticOnce(surface, {
        severity: 'warning',
        code: 'WEB_SURFACE_ROOM_UNRESOLVED',
        message: `The web surface references a room that is not present in the compiled world: ${roomId}`,
        details: { roomId },
      })
      return false
    }
    return room.visible
  }

  private applyLayout(surface: MountedSurface, projection: NonNullable<ReturnType<typeof projectWebSurface>>): void {
    const width = Math.max(1, roundLayout(projection.width))
    const height = Math.max(1, roundLayout(projection.height))
    const left = roundLayout(projection.centerX - width / 2)
    const top = roundLayout(projection.centerY - height / 2)
    const angle = roundLayout(projection.angle)
    const zIndex = Math.max(0, Math.round((1 - projection.depth) * 100000))
    const key = `${left}|${top}|${width}|${height}|${angle}|${zIndex}`
    if (surface.layoutKey === key) return
    surface.layoutKey = key
    surface.element.style.width = `${width}px`
    surface.element.style.height = `${height}px`
    surface.element.style.zIndex = String(zIndex)
    surface.element.style.transform = `translate3d(${left}px,${top}px,0) rotate(${angle}rad)`
  }

  private setActive(surface: MountedSurface, active: boolean, manageFallback = true): void {
    const next = active && surface.presentationReady
    if (manageFallback) this.setFallbackHidden(surface, next)
    if (surface.active === next) {
      this.applyInteractionState(surface)
      return
    }
    surface.active = next
    surface.element.style.visibility = next ? 'visible' : 'hidden'
    surface.element.setAttribute('aria-hidden', next ? 'false' : 'true')
    surface.element.inert = !next
    this.applyInteractionState(surface)
    if (!next) this.releaseFocus(surface)
    this.invoke(surface, 'setActive', () => surface.app?.setActive?.(next))
    if (next) this.invoke(surface, 'resume', () => surface.app?.resume?.())
    else this.invoke(surface, 'pause', () => surface.app?.pause?.())
    this.play(surface, next ? 'visible' : 'hidden')
  }

  private setFallbackHidden(surface: MountedSurface, hidden: boolean): void {
    if (this.options.hideFallbackWhileActive === false || !surface.renderer.setPrimitiveVisibility) return
    if (surface.fallbackHidden === hidden) return
    surface.renderer.setPrimitiveVisibility(surface.primitive.id, hidden ? false : surface.primitive.visible)
    surface.fallbackHidden = hidden
    if (hidden) {
      this.diagnosticOnce(surface, {
        severity: 'info',
        code: 'WEB_SURFACE_FALLBACK_SUPPRESSED',
        message: 'The renderer snapshot/plane was hidden while the live DOM Web Surface is active to prevent duplicate, mirrored, or flickering presentation.',
      })
    }
  }

  private applyInteractionState(surface: MountedSurface): void {
    surface.element.style.pointerEvents = surface.active && surface.definition.interaction.pointer ? 'auto' : 'none'
  }

  private releaseFocus(surface: MountedSurface): void {
    const activeElement = globalThis.document.activeElement as (Element & { blur?: () => void }) | null
    if (!activeElement || typeof surface.element.contains !== 'function' || !surface.element.contains(activeElement)) return
    activeElement.blur?.()
  }

  private installAnimationEvents(surface: MountedSurface): void {
    surface.element.addEventListener('pointerenter', () => this.play(surface, 'focus'), { signal: surface.controller.signal })
    surface.element.addEventListener('pointerleave', () => this.play(surface, 'blur'), { signal: surface.controller.signal })
    surface.element.addEventListener('pointerdown', () => this.play(surface, 'select'), { signal: surface.controller.signal })
  }

  private play(surface: MountedSurface, trigger: WebSurfaceAnimationDefinition['trigger']): void {
    if (this.reducedMotion || typeof surface.content.animate !== 'function') return
    for (const animation of surface.definition.animations.filter(candidate => candidate.trigger === trigger)) {
      surface.content.animate(animationFrames(animation.preset), {
        duration: animation.duration ?? 280,
        delay: animation.delay ?? 0,
        easing: animation.easing ?? 'ease-out',
        iterations: animation.iterations === 'infinite' ? Infinity : animation.iterations ?? 1,
        fill: 'both',
      })
    }
  }

  private unmount(id: string, restoreFallback = true): void {
    const surface = this.mounted.get(id)
    if (!surface) return
    this.setActive(surface, false, restoreFallback)
    surface.controller.abort()
    this.disposeApp(surface)
    surface.presentationReady = false
    surface.content.replaceChildren()
    surface.element.remove()
    this.mounted.delete(id)
  }

  private disposeApp(surface: MountedSurface): void {
    const app = surface.app
    surface.app = undefined
    if (!app) return
    this.invoke(surface, 'dispose', () => app.dispose())
  }

  private invoke(surface: MountedSurface, operation: string, callback: () => void): void {
    try { callback() }
    catch (error) {
      this.diagnosticOnce(surface, {
        severity: 'warning',
        code: `WEB_SURFACE_LIFECYCLE_${operation.toUpperCase()}_FAILED`,
        message: `Web-surface lifecycle operation "${operation}" failed: ${String(error)}`,
        details: { operation },
      })
    }
  }

  private diagnoseTargetFallback(surface: MountedSurface, context: PluginRuntimeContext): void {
    const target = surface.definition.target
    if (!target || target.type === 'plane') return
    const resolution = resolveWebSurfaceTarget(context.compiled, surface.primitive as CompiledPrimitive & { webSurface: CompiledWebSurface })
    if (!resolution.resolved) {
      this.diagnosticOnce(surface, {
        severity: 'warning',
        code: resolution.code,
        message: `${resolution.message} The existing plane/overlay or snapshot fallback remains active.`,
        details: resolution.details,
      })
      return
    }
    this.diagnosticOnce(surface, {
      severity: 'info',
      code: 'WEB_SURFACE_TARGET_OVERLAY_FALLBACK',
      message: `The DOM Web Surface runtime does not render target type "${target.type}" natively yet. It is using the existing renderer-neutral plane overlay fallback.`,
      details: { targetType: target.type },
    })
  }

  private diagnosticOnce(surface: MountedSurface, diagnostic: Omit<WebSurfaceDiagnostic, 'entityId' | 'primitiveId'>): void {
    if (surface.diagnostics.has(diagnostic.code)) return
    surface.diagnostics.add(diagnostic.code)
    this.diagnostic({
      ...diagnostic,
      entityId: surface.primitive.entityId,
      primitiveId: surface.primitive.id,
    })
  }

  private diagnostic(diagnostic: WebSurfaceDiagnostic): void {
    this.options.onDiagnostic?.(diagnostic)
  }
}
