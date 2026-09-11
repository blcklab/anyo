export { webSurfacePlugin } from './plugin.js'
export type { WebSurfacePlugin, WebSurfacePluginOptions } from './plugin.js'
export { WebSurfaceAppRegistry, createWebSurfaceAppRegistry } from './registry.js'
export type {
  RegisteredWebSurfaceApp,
  WebSurfaceAppContext,
  WebSurfaceAppInstance,
} from './registry.js'
export { WebSurfaceRuntime } from './WebSurfaceRuntime.js'
export type {
  WebSurfaceDiagnostic,
  WebSurfaceExternalUrlPolicy,
  WebSurfaceRuntimeOptions,
} from './WebSurfaceRuntime.js'
export { projectWebSurface } from './projection.js'
export type { ProjectedSurfaceRect } from './projection.js'

export {
  compileWebSurfaceTarget,
  getWebSurfaceHostSlot,
  resolveWebSurfaceTarget,
  resolveWebSurfaceTargetEntity,
} from './target.js'
export type {
  ResolvedWebSurfaceHostSlot,
  WebSurfaceTargetReference,
  WebSurfaceTargetResolution,
} from './target.js'
