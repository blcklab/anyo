/** Stable geometry/world-space conventions inherited from Anyo's existing world contract. */
export const ANYO_GEOMETRY_CONVENTIONS = Object.freeze({
  handedness: 'right' as const,
  upAxis: '+Y' as const,
  eastAxis: '+X' as const,
  northAxis: '-Z' as const,
  unit: 'meter' as const,
  eulerUnit: 'radian' as const,
  frontFace: 'counter-clockwise' as const,
  topology: 'triangles' as const,
  uvOrigin: 'lower-left' as const,
})
