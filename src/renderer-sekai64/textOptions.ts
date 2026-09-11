import type { TextMeshOptions } from '@blcklab/sekai64'
import type { CompiledPrimitive } from '../core/types.js'
import { resolveTextLayout } from '../renderer/textLayout.js'

export function toSekaiTextOptions(primitive: CompiledPrimitive): TextMeshOptions {
  const layout = resolveTextLayout(primitive)
  return {
    worldWidth: layout.worldWidth,
    worldHeight: layout.worldHeight,
    width: layout.canvasWidth,
    height: layout.canvasHeight,
    fontFamily: primitive.style?.fontFamily,
    fontSize: layout.fontPixels,
    fontWeight: primitive.style?.fontWeight,
    lineHeight: layout.lineHeightPixels,
    color: primitive.style?.color ?? primitive.color,
    background: primitive.style?.background,
    padding: layout.paddingPixels,
    maxWidth: Math.max(1, layout.canvasWidth - layout.paddingPixels * 2),
    align: layout.align,
    label: primitive.id,
  }
}
