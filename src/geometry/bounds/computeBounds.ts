import type { GeometryBounds } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'

export function computeGeometryBounds(positions: Float32Array): GeometryBounds {
  if (positions.length < 3 || positions.length % 3 !== 0) {
    throw new GeometryValidationError([{ code: 'GEOMETRY_MESH_INVALID', path: '/positions', message: 'Positions must contain one or more xyz vertices.' }])
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!
    const y = positions[index + 1]!
    const z = positions[index + 2]!
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new GeometryValidationError([{ code: 'GEOMETRY_MESH_INVALID', path: `/positions/${index}`, message: 'Mesh positions must be finite.' }])
    }
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z)
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
  let radiusSquared = 0
  for (let index = 0; index < positions.length; index += 3) {
    const dx = positions[index]! - center[0]
    const dy = positions[index + 1]! - center[1]
    const dz = positions[index + 2]! - center[2]
    radiusSquared = Math.max(radiusSquared, dx * dx + dy * dy + dz * dz)
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    sphere: { center, radius: Math.sqrt(radiusSquared) },
  }
}
