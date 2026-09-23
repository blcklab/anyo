import type { GeometryDefinition, GeometryQualityPreset } from '../types/index.js'

export interface GeometryQualityDefaults {
  radialSegments: number
  sphereSegments: number
  sphereRings: number
  roundedBoxSegments: number
  capsuleSegments: number
  capsuleRings: number
  torusSegments: number
  torusTubeSegments: number
}

export const GEOMETRY_QUALITY_DEFAULTS: Readonly<Record<GeometryQualityPreset, Readonly<GeometryQualityDefaults>>> = Object.freeze({
  low: Object.freeze({ radialSegments: 12, sphereSegments: 16, sphereRings: 8, roundedBoxSegments: 2, capsuleSegments: 12, capsuleRings: 4, torusSegments: 16, torusTubeSegments: 8 }),
  medium: Object.freeze({ radialSegments: 24, sphereSegments: 24, sphereRings: 12, roundedBoxSegments: 3, capsuleSegments: 20, capsuleRings: 6, torusSegments: 24, torusTubeSegments: 12 }),
  high: Object.freeze({ radialSegments: 32, sphereSegments: 32, sphereRings: 16, roundedBoxSegments: 4, capsuleSegments: 32, capsuleRings: 8, torusSegments: 32, torusTubeSegments: 16 }),
  ultra: Object.freeze({ radialSegments: 64, sphereSegments: 64, sphereRings: 32, roundedBoxSegments: 8, capsuleSegments: 48, capsuleRings: 16, torusSegments: 64, torusTubeSegments: 24 }),
})

export function qualityDefaults(definition: GeometryDefinition): Readonly<GeometryQualityDefaults> {
  return GEOMETRY_QUALITY_DEFAULTS[(definition.quality ?? 'medium') as GeometryQualityPreset]
}
