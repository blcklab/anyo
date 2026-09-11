import type { EnvironmentDefinition, VisualStyleProfile, WorldDocument } from '../core/types.js'

export type AnyoVisualPresetName = VisualStyleProfile

export interface ApplyVisualPresetOptions {
  environment?: EnvironmentDefinition
  preserveAtmosphere?: boolean
}

const PRESETS: Readonly<Record<AnyoVisualPresetName, Readonly<EnvironmentDefinition>>> = Object.freeze({
  standard: Object.freeze({
    visualStyle: Object.freeze({ profile: 'standard' }),
    colorManagement: Object.freeze({ toneMapping: 'aces', exposure: 1, outputColorSpace: 'srgb' }),
    postProcessing: Object.freeze({ colorGrading: Object.freeze({ enabled: false }) }),
  }),
  'anime-soft': Object.freeze({
    visualStyle: Object.freeze({
      profile: 'anime-soft', shadeSteps: 4, shadowStrength: 0.42,
      highlightStrength: 0.12, rimStrength: 0.12, outlineStrength: 0.44,
    }),
    colorManagement: Object.freeze({ toneMapping: 'aces', exposure: 0.98, outputColorSpace: 'srgb' }),
    postProcessing: Object.freeze({ colorGrading: Object.freeze({
      enabled: true, saturation: 1.04, contrast: 1.03, temperature: 0.025,
      vignette: 0.035, vignetteSoftness: 0.58, highlightGlow: 0.04, highlightThreshold: 0.8,
    }) }),
  }),
  anime: Object.freeze({
    visualStyle: Object.freeze({
      profile: 'anime', shadeSteps: 3, shadowStrength: 0.58,
      highlightStrength: 0.2, rimStrength: 0.18, outlineStrength: 0.68,
    }),
    colorManagement: Object.freeze({ toneMapping: 'aces', exposure: 0.96, outputColorSpace: 'srgb' }),
    postProcessing: Object.freeze({ colorGrading: Object.freeze({
      enabled: true, saturation: 1.08, contrast: 1.07, temperature: 0.045, tint: 0.01,
      vignette: 0.075, vignetteSoftness: 0.58, highlightGlow: 0.08, highlightThreshold: 0.78,
    }) }),
  }),
  'anime-rpg': Object.freeze({
    visualStyle: Object.freeze({
      profile: 'anime-rpg', defaultMaterialRole: 'environment', shadeSteps: 4,
      shadowStrength: 0.46, highlightStrength: 0.12, rimStrength: 0.08,
      outlineStrength: 0.34, outlinePower: 6,
    }),
    colorManagement: Object.freeze({ toneMapping: 'aces', exposure: 1, outputColorSpace: 'srgb' }),
    shadows: Object.freeze({ enabled: true, mapSize: 2048, cascades: 3, maxDistance: 150, splitLambda: 0.68, stabilize: true, casterDistance: 180, softness: 1.25 }),
    imageQuality: Object.freeze({ dithering: true, maxAnisotropy: 8, renderScale: 1, msaaSamples: 4, mipmaps: true, antialiasing: 'fxaa', sharpen: 0.1 }),
    atmosphere: Object.freeze({ enabled: true, mode: 'linear', color: '#9bcbe6', near: 55, far: 230, maxOpacity: 0.46, baseHeight: 0, heightFalloff: 0.002 }),
    postProcessing: Object.freeze({
      enabled: true,
      colorGrading: Object.freeze({ enabled: true, saturation: 1.06, contrast: 1.08, brightness: -0.005, temperature: 0.025, tint: 0.006, vignette: 0.08, vignetteSoftness: 0.7, highlightGlow: 0.08, highlightThreshold: 0.82 }),
      ssao: Object.freeze({ enabled: true, mode: 'gtao', radius: 0.72, intensity: 0.9, bias: 0.018, samples: 12, halfResolution: true, denoise: true, denoiseRadius: 2, directions: 4 }),
      bloom: Object.freeze({ enabled: true, strength: 0.1, threshold: 0.84, radius: 0.65, levels: 4, scatter: 0.72, clamp: 8 }),
      outlines: Object.freeze({ enabled: true, mode: 'hybrid', color: '#201a2a', thickness: 0.9, depthThreshold: 0.0035, normalThreshold: 0.28, charactersOnly: true }),
    }),
    optimization: Object.freeze({ frustumCulling: true, cachedBounds: true, pipelineSorting: true, shadowCasterCulling: true, lodHysteresis: 0.1, hizOcclusion: true, hizResolution: 128, occlusionHistoryFrames: 2, occlusionMinimumPixels: 3, clusteredLighting: true, clusterDimensions: [16, 9, 24] as [number, number, number], maxLightsPerCluster: 24, maxClusteredLights: 1024, staticBatching: true, staticBatchMinInstances: 3, textureMemoryBudgetMB: 512, textureEvictionFrames: 300, geometryMemoryBudgetMB: 768, geometryEvictionFrames: 360, regionStreaming: true, streamingLoadDistance: 180, streamingUnloadDistance: 260, streamingConcurrency: 6, worldOriginRebasing: false, worldOriginThreshold: 10000, worldOriginGridSize: 1000 }),
  }),
  'anime-cinematic': Object.freeze({
    visualStyle: Object.freeze({
      profile: 'anime-cinematic', shadeSteps: 3, shadowStrength: 0.68,
      highlightStrength: 0.24, rimStrength: 0.24, rimPower: 2.2,
      outlineStrength: 0.78, outlinePower: 4.5,
    }),
    colorManagement: Object.freeze({ toneMapping: 'aces', exposure: 0.94, outputColorSpace: 'srgb' }),
    postProcessing: Object.freeze({ colorGrading: Object.freeze({
      enabled: true, saturation: 1.1, contrast: 1.11, brightness: -0.01,
      temperature: 0.055, tint: 0.012, vignette: 0.14, vignetteSoftness: 0.62,
      highlightGlow: 0.14, highlightThreshold: 0.76,
    }) }),
  }),
})

function mergeEnvironment(base: EnvironmentDefinition = {}, patch: EnvironmentDefinition = {}): EnvironmentDefinition {
  return {
    ...base,
    ...patch,
    visualStyle: { ...base.visualStyle, ...patch.visualStyle },
    ambientLight: { ...base.ambientLight, ...patch.ambientLight },
    lighting: { ...base.lighting, ...patch.lighting },
    colorManagement: { ...base.colorManagement, ...patch.colorManagement },
    shadows: { ...base.shadows, ...patch.shadows },
    imageQuality: { ...base.imageQuality, ...patch.imageQuality },
    atmosphere: { ...base.atmosphere, ...patch.atmosphere },
    postProcessing: {
      ...base.postProcessing,
      ...patch.postProcessing,
      colorGrading: { ...base.postProcessing?.colorGrading, ...patch.postProcessing?.colorGrading },
      ssao: { ...base.postProcessing?.ssao, ...patch.postProcessing?.ssao },
      bloom: { ...base.postProcessing?.bloom, ...patch.postProcessing?.bloom },
      outlines: { ...base.postProcessing?.outlines, ...patch.postProcessing?.outlines },
    },
    optimization: { ...base.optimization, ...patch.optimization },
    sun: {
      ...base.sun,
      ...patch.sun,
      shadow: { ...base.sun?.shadow, ...patch.sun?.shadow },
    },
  }
}

export function getVisualPreset(name: AnyoVisualPresetName): EnvironmentDefinition {
  return structuredClone(PRESETS[name])
}

/** Returns a new document; the input document is never mutated. */
export function applyVisualPreset(
  document: WorldDocument,
  name: AnyoVisualPresetName,
  options: ApplyVisualPresetOptions = {},
): WorldDocument {
  const originalEnvironment = document.environment ?? {}
  const preset = getVisualPreset(name)
  const environment = mergeEnvironment(originalEnvironment, preset)
  const withOverrides = mergeEnvironment(environment, options.environment)
  if (options.preserveAtmosphere !== false && originalEnvironment.atmosphere) {
    withOverrides.atmosphere = { ...originalEnvironment.atmosphere, ...options.environment?.atmosphere }
  }
  return {
    ...structuredClone(document),
    environment: withOverrides,
  }
}

export const ANYO_VISUAL_PRESETS = PRESETS
