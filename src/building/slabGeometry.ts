import type { Size2, Vec2 } from '../core/types.js'

export interface SlabCutout {
  center: Vec2
  size: Size2
}

export interface SlabCell {
  center: Vec2
  size: Size2
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b)
}

function insideCutout(x: number, z: number, cutout: SlabCutout): boolean {
  return (
    x > cutout.center[0] - cutout.size[0] / 2 &&
    x < cutout.center[0] + cutout.size[0] / 2 &&
    z > cutout.center[1] - cutout.size[1] / 2 &&
    z < cutout.center[1] + cutout.size[1] / 2
  )
}

export function decomposeSlab(
  roomCenter: Vec2,
  roomSize: Size2,
  cutouts: readonly SlabCutout[],
): SlabCell[] {
  const minX = roomCenter[0] - roomSize[0] / 2
  const maxX = roomCenter[0] + roomSize[0] / 2
  const minZ = roomCenter[1] - roomSize[1] / 2
  const maxZ = roomCenter[1] + roomSize[1] / 2
  const relevant = cutouts.filter((cutout) => (
    cutout.center[0] + cutout.size[0] / 2 > minX &&
    cutout.center[0] - cutout.size[0] / 2 < maxX &&
    cutout.center[1] + cutout.size[1] / 2 > minZ &&
    cutout.center[1] - cutout.size[1] / 2 < maxZ
  ))

  const xCuts = uniqueSorted([
    minX,
    maxX,
    ...relevant.flatMap((cutout) => [
      Math.max(minX, cutout.center[0] - cutout.size[0] / 2),
      Math.min(maxX, cutout.center[0] + cutout.size[0] / 2),
    ]),
  ])
  const zCuts = uniqueSorted([
    minZ,
    maxZ,
    ...relevant.flatMap((cutout) => [
      Math.max(minZ, cutout.center[1] - cutout.size[1] / 2),
      Math.min(maxZ, cutout.center[1] + cutout.size[1] / 2),
    ]),
  ])

  const cells: SlabCell[] = []
  for (let xIndex = 0; xIndex < xCuts.length - 1; xIndex += 1) {
    const left = xCuts[xIndex]
    const right = xCuts[xIndex + 1]
    if (left === undefined || right === undefined || right - left <= 1e-6) continue
    for (let zIndex = 0; zIndex < zCuts.length - 1; zIndex += 1) {
      const near = zCuts[zIndex]
      const far = zCuts[zIndex + 1]
      if (near === undefined || far === undefined || far - near <= 1e-6) continue
      const center: Vec2 = [(left + right) / 2, (near + far) / 2]
      if (relevant.some((cutout) => insideCutout(center[0], center[1], cutout))) continue
      cells.push({ center, size: [right - left, far - near] })
    }
  }
  return cells
}
