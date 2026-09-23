import type { DoorOpeningArchitectureDefinition, WallOpeningDefinition, WindowOpeningArchitectureDefinition } from './types.js'
import { architectureError, finiteNonNegative, finitePositive } from './utils.js'

export interface NormalizedWallOpening {
  kind: 'door' | 'window'
  id?: string
  x0: number
  x1: number
  y0: number
  y1: number
}

export function normalizeWallOpenings(input: readonly WallOpeningDefinition[] | undefined, wallLength: number, wallHeight: number): readonly NormalizedWallOpening[] {
  const openings = (input ?? []).map((opening, index) => normalizeWallOpening(opening, index, wallLength, wallHeight))
  openings.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0 || a.x1 - b.x1 || a.y1 - b.y1 || a.kind.localeCompare(b.kind))
  for (let a = 0; a < openings.length; a += 1) {
    for (let b = a + 1; b < openings.length; b += 1) {
      if (rectanglesOverlap(openings[a]!, openings[b]!)) {
        architectureError('ARCHITECTURE_OPENING_OVERLAP', `/openings/${b}`, 'Wall openings must not overlap.', 'Move or resize the overlapping opening so each void has a distinct wall region.')
      }
    }
  }
  return Object.freeze(openings.map(opening => Object.freeze(opening)))
}

export function normalizeStandaloneDoorOpening(input: DoorOpeningArchitectureDefinition): Readonly<{ type: 'doorOpening'; id?: string; width: number; height: number }> {
  return Object.freeze({ type: 'doorOpening', ...(input.id ? { id: input.id } : {}), width: finitePositive(input.width, '/width', 'width'), height: finitePositive(input.height, '/height', 'height') })
}

export function normalizeStandaloneWindowOpening(input: WindowOpeningArchitectureDefinition): Readonly<{ type: 'windowOpening'; id?: string; width: number; height: number; sillHeight: number }> {
  return Object.freeze({
    type: 'windowOpening', ...(input.id ? { id: input.id } : {}),
    width: finitePositive(input.width, '/width', 'width'),
    height: finitePositive(input.height, '/height', 'height'),
    sillHeight: finiteNonNegative(input.sillHeight ?? 0, '/sillHeight', 'sillHeight'),
  })
}

function normalizeWallOpening(opening: WallOpeningDefinition, index: number, wallLength: number, wallHeight: number): NormalizedWallOpening {
  if (!opening || typeof opening !== 'object') architectureError('ARCHITECTURE_INVALID', `/openings/${index}`, 'Wall opening must be an object.')
  const offset = finiteNonNegative(opening.offset, `/openings/${index}/offset`, 'opening.offset')
  const width = finitePositive(opening.width, `/openings/${index}/width`, 'opening.width')
  const height = finitePositive(opening.height, `/openings/${index}/height`, 'opening.height')
  const x1 = offset + width
  if (x1 > wallLength + 1e-8) architectureError('ARCHITECTURE_INVALID', `/openings/${index}`, 'Opening extends beyond the wall length.')
  const y0 = opening.kind === 'window' ? finiteNonNegative(opening.sillHeight, `/openings/${index}/sillHeight`, 'window.sillHeight') : 0
  const y1 = y0 + height
  if (y1 > wallHeight + 1e-8) architectureError('ARCHITECTURE_INVALID', `/openings/${index}`, 'Opening extends above the wall height.')
  return { kind: opening.kind, ...(opening.id ? { id: opening.id } : {}), x0: offset, x1, y0, y1 }
}

function rectanglesOverlap(a: NormalizedWallOpening, b: NormalizedWallOpening): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-8 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-8
}
