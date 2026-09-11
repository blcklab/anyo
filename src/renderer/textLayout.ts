import type { CompiledPrimitive } from '../core/types.js'

export interface ResolvedTextLayout {
  worldWidth: number
  worldHeight: number
  canvasWidth: number
  canvasHeight: number
  fontPixels: number
  paddingPixels: number
  lineHeightPixels?: number
  align: 'left' | 'center' | 'right'
}

const DEFAULT_RESOLUTION = 512
const MIN_RESOLUTION = 32
const DEFAULT_FONT_SIZE = 0.28
const DEFAULT_PADDING = 0.08
const MIN_WORLD_SIZE = 0.0001

export function resolveTextLayout(primitive: CompiledPrimitive): ResolvedTextLayout {
  const style = primitive.style ?? {}
  const worldWidth = Math.max(MIN_WORLD_SIZE, primitive.size?.[0] ?? 3)
  const worldHeight = Math.max(MIN_WORLD_SIZE, primitive.size?.[1] ?? 1)
  const resolution = Math.max(MIN_RESOLUTION, Math.round(style.resolution ?? DEFAULT_RESOLUTION))
  const aspect = worldWidth / worldHeight
  const canvasHeight = resolution
  const canvasWidth = Math.max(1, Math.round(resolution * aspect))
  const fontPixels = Math.max(1, Math.round((style.fontSize ?? DEFAULT_FONT_SIZE) * resolution))
  const paddingPixels = Math.max(0, Math.round((style.padding ?? DEFAULT_PADDING) * resolution))
  const lineHeight = style.lineHeight
  const lineHeightPixels = lineHeight === undefined
    ? undefined
    : Math.max(fontPixels, Math.round(lineHeight * resolution))
  const align = style.align === 'start' || style.align === 'left'
    ? 'left'
    : style.align === 'end' || style.align === 'right'
      ? 'right'
      : 'center'
  return { worldWidth, worldHeight, canvasWidth, canvasHeight, fontPixels, paddingPixels, lineHeightPixels, align }
}
