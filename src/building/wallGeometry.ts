import type { NormalizedOpening } from '../core/types.js'

export interface WallCell {
  tangentCenter: number
  verticalCenter: number
  length: number
  height: number
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b)
}

function isInsideOpening(tangent: number, vertical: number, opening: NormalizedOpening): boolean {
  const left = opening.offset - opening.width / 2
  const right = opening.offset + opening.width / 2
  const bottom = opening.elevation
  const top = opening.elevation + opening.height
  return tangent > left && tangent < right && vertical > bottom && vertical < top
}

export function decomposeWall(length: number, height: number, openings: NormalizedOpening[]): WallCell[] {
  const validOpenings = openings.filter((opening) => {
    const left = opening.offset - opening.width / 2
    const right = opening.offset + opening.width / 2
    return right > -length / 2 && left < length / 2 && opening.elevation < height
  })

  const tangentCuts = uniqueSorted([
    -length / 2,
    length / 2,
    ...validOpenings.flatMap((opening) => [
      Math.max(-length / 2, opening.offset - opening.width / 2),
      Math.min(length / 2, opening.offset + opening.width / 2),
    ]),
  ])
  const verticalCuts = uniqueSorted([
    0,
    height,
    ...validOpenings.flatMap((opening) => [
      Math.max(0, opening.elevation),
      Math.min(height, opening.elevation + opening.height),
    ]),
  ])

  const cells: WallCell[] = []
  for (let tangentIndex = 0; tangentIndex < tangentCuts.length - 1; tangentIndex += 1) {
    const left = tangentCuts[tangentIndex]
    const right = tangentCuts[tangentIndex + 1]
    if (left === undefined || right === undefined || right - left <= 1e-6) continue

    for (let verticalIndex = 0; verticalIndex < verticalCuts.length - 1; verticalIndex += 1) {
      const bottom = verticalCuts[verticalIndex]
      const top = verticalCuts[verticalIndex + 1]
      if (bottom === undefined || top === undefined || top - bottom <= 1e-6) continue

      const tangentCenter = (left + right) / 2
      const verticalCenter = (bottom + top) / 2
      if (validOpenings.some((opening) => isInsideOpening(tangentCenter, verticalCenter, opening))) continue

      cells.push({
        tangentCenter,
        verticalCenter,
        length: right - left,
        height: top - bottom,
      })
    }
  }

  return cells
}
