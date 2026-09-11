import * as THREE from 'three'
import type { CompiledPrimitive } from '../core/types.js'
import { resolveTextLayout } from '../renderer/textLayout.js'

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split('\n')
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = words[0] ?? ''
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`
      if (context.measureText(candidate).width <= maxWidth) line = candidate
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

export function createTextTexture(primitive: CompiledPrimitive): any {
  const style = primitive.style ?? {}
  const layout = resolveTextLayout(primitive)
  const width = layout.canvasWidth
  const height = layout.canvasHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable; text entities cannot be rendered.')

  context.clearRect(0, 0, width, height)
  if (style.background) {
    context.fillStyle = style.background
    context.fillRect(0, 0, width, height)
  }

  const padding = layout.paddingPixels
  const fontPixels = layout.fontPixels
  context.font = `${style.fontWeight ?? 600} ${fontPixels}px ${style.fontFamily ?? 'system-ui, sans-serif'}`
  context.fillStyle = style.color ?? primitive.color ?? '#18181b'
  context.textAlign = layout.align
  context.textBaseline = 'middle'

  const lines = wrapText(context, primitive.text ?? '', width - padding * 2)
  const lineHeight = layout.lineHeightPixels ?? fontPixels * 1.2
  const totalHeight = lines.length * lineHeight
  const startY = height / 2 - totalHeight / 2 + lineHeight / 2
  const x = context.textAlign === 'left' ? padding : context.textAlign === 'right' ? width - padding : width / 2
  lines.forEach((line, index) => context.fillText(line, x, startY + index * lineHeight))

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
