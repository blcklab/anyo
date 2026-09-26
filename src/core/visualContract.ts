import type {
  EnvironmentDefinition,
  MaterialDefinition,
  NormalizedEnvironmentDefinition,
  NormalizedMaterialDefinition,
} from './types.js'

/** Fixed renderer-neutral color-space semantics for standard PBR texture channels. */
export const ANYO_TEXTURE_COLOR_SPACES = Object.freeze({
  baseColor: 'srgb',
  emissive: 'srgb',
  normal: 'linear',
  roughness: 'linear',
  metalness: 'linear',
  metallicRoughness: 'linear',
  occlusion: 'linear',
} as const)

export const ANYO_VISUAL_DEFAULTS = Object.freeze({
  material: Object.freeze({
    baseColor: '#d4d4d4',
    emissive: '#000000',
    emissiveIntensity: 0,
    roughness: 0.8,
    metalness: 0,
    normalScale: 1,
    occlusionStrength: 1,
    opacity: 1,
    alphaMode: 'opaque' as const,
    alphaCutoff: 0.5,
    side: 'front' as const,
    doubleSided: false,
    castShadow: true,
    receiveShadow: true,
  }),
  environment: Object.freeze({
    background: '#dfe7ee',
    ambientColor: '#ffffff',
    ambientIntensity: 0.35,
    skyColor: '#75839b',
    groundColor: '#161b24',
    diffuseIntensity: 0.35,
    specularIntensity: 0.2,
    sunColor: '#fff7e6',
    sunIntensity: 1,
    sunPosition: [8, 14, 6] as const,
    toneMapping: 'aces' as const,
    exposure: 1,
    outputColorSpace: 'srgb' as const,
    shadowMapSize: 1024,
    shadowBias: 0.0008,
    shadowNormalBias: 0.015,
    shadowSoftness: 1,
    shadowCameraPadding: 2,
    shadowCascades: 1,
    shadowMaxDistance: 140,
    shadowSplitLambda: 0.65,
    shadowStabilize: true,
    shadowCasterDistance: 180,
    shadowFilter: 'pcf3' as const,
    shadowCascadeBlend: 0.12,
    shadowDistanceFade: 0.12,
    dithering: true,
    maxAnisotropy: 4,
    renderScale: 1,
    msaaSamples: 4 as const,
    mipmaps: true,
    antialiasing: 'fxaa' as const,
    sharpen: 0.08,
    atmosphere: Object.freeze({
      enabled: false,
      mode: 'none' as const,
      color: '#9fc3d8',
      near: 28,
      far: 180,
      density: 0.008,
      baseHeight: 0,
      heightFalloff: 0,
      maxOpacity: 0.72,
    }),
    ssao: Object.freeze({ enabled: false, mode: 'gtao' as const, radius: 0.65, intensity: 0.85, bias: 0.018, samples: 8, halfResolution: true, denoise: true, denoiseRadius: 2, directions: 4 }),
    bloom: Object.freeze({ enabled: false, strength: 0.12, threshold: 0.82, radius: 0.7, levels: 4, scatter: 0.72, clamp: 8 }),
    outlines: Object.freeze({ enabled: false, mode: 'hybrid' as const, color: '#201a2a', thickness: 1, depthThreshold: 0.0035, normalThreshold: 0.25, charactersOnly: true }),
    optimization: Object.freeze({ frustumCulling: true, cachedBounds: true, pipelineSorting: true, shadowCasterCulling: true, lodHysteresis: 0.08, hizOcclusion: true, hizResolution: 128, occlusionHistoryFrames: 2, occlusionMinimumPixels: 3, clusteredLighting: true, clusterDimensions: [16, 9, 24] as [number, number, number], maxLightsPerCluster: 24, maxClusteredLights: 1024, staticBatching: true, staticBatchMinInstances: 3, textureMemoryBudgetMB: 384, textureEvictionFrames: 240, geometryMemoryBudgetMB: 512, geometryEvictionFrames: 300, regionStreaming: false, streamingLoadDistance: 160, streamingUnloadDistance: 220, streamingConcurrency: 4, worldOriginRebasing: false, worldOriginThreshold: 10000, worldOriginGridSize: 1000 }),
    colorGrading: Object.freeze({
      enabled: false,
      saturation: 1,
      contrast: 1,
      brightness: 0,
      temperature: 0,
      tint: 0,
      vignette: 0,
      vignetteSoftness: 0.55,
      highlightGlow: 0,
      highlightThreshold: 0.78,
      lutIntensity: 1,
    }),
    visualStyle: Object.freeze({
      profile: 'standard' as const,
      shadeSteps: 3,
      shadowColor: '#66708f',
      shadowStrength: 0.58,
      highlightColor: '#fff4df',
      highlightStrength: 0.2,
      rimColor: '#ffd7e8',
      rimStrength: 0.18,
      rimPower: 2.5,
      outlineColor: '#201a2a',
      outlineStrength: 0.68,
      outlinePower: 5,
      defaultMaterialRole: 'environment' as const,
    }),
  }),
})

export function normalizeMaterialDefinition(definition: MaterialDefinition = {}): NormalizedMaterialDefinition {
  const { detail: authoredDetail, ...definitionWithoutDetail } = definition
  const detail = authoredDetail ? {
    ...authoredDetail,
    scale: authoredDetail.scale ?? 1,
    strength: authoredDetail.strength ?? 1,
    roughnessStrength: authoredDetail.roughnessStrength ?? 1,
    heightScale: authoredDetail.heightScale ?? 0.02,
  } : undefined
  const opacity = definition.opacity ?? 1
  const transmission = definition.transmission ?? 0
  const alphaMode = definition.alphaMode ?? (definition.transparent || opacity < 1 || transmission > 0 ? 'blend' : 'opaque')
  const doubleSided = definition.doubleSided ?? definition.side === 'double'
  return {
    ...definitionWithoutDetail,
    ...(detail ? { detail } : {}),
    baseColor: definition.baseColor ?? definition.color ?? ANYO_VISUAL_DEFAULTS.material.baseColor,
    emissive: definition.emissive ?? ANYO_VISUAL_DEFAULTS.material.emissive,
    emissiveIntensity: definition.emissiveIntensity ?? (definition.emissive || definition.emissiveTexture ? 1 : 0),
    roughness: definition.roughness ?? ANYO_VISUAL_DEFAULTS.material.roughness,
    metalness: definition.metalness ?? ANYO_VISUAL_DEFAULTS.material.metalness,
    normalScale: definition.normalScale ?? ANYO_VISUAL_DEFAULTS.material.normalScale,
    occlusionStrength: definition.occlusionStrength ?? ANYO_VISUAL_DEFAULTS.material.occlusionStrength,
    opacity,
    alphaMode,
    alphaCutoff: definition.alphaCutoff ?? ANYO_VISUAL_DEFAULTS.material.alphaCutoff,
    transparent: alphaMode === 'blend',
    side: doubleSided ? 'double' : definition.side ?? ANYO_VISUAL_DEFAULTS.material.side,
    doubleSided,
    castShadow: definition.castShadow ?? alphaMode !== 'blend',
    receiveShadow: definition.receiveShadow ?? true,
  }
}


function visualProfileDefaults(profile: NonNullable<NonNullable<EnvironmentDefinition['visualStyle']>['profile']>) {
  const base = ANYO_VISUAL_DEFAULTS.environment.visualStyle
  if (profile === 'anime-soft') return { ...base, profile, shadowStrength: 0.4, highlightStrength: 0.12, rimStrength: 0.12, outlineStrength: 0.44, outlinePower: 6 }
  if (profile === 'anime-cinematic') return { ...base, profile, shadeSteps: 3, shadowStrength: 0.68, highlightStrength: 0.24, rimStrength: 0.24, rimPower: 2.2, outlineStrength: 0.78, outlinePower: 4.5 }
  if (profile === 'anime-rpg') return { ...base, profile, shadeSteps: 4, shadowStrength: 0.46, highlightStrength: 0.12, rimStrength: 0.08, rimPower: 3.2, outlineStrength: 0.34, outlinePower: 6, defaultMaterialRole: 'environment' as const }
  if (profile === 'anime') return { ...base, profile }
  return { ...base, profile: 'standard' as const }
}

function colorGradingProfileDefaults(profile: NonNullable<NonNullable<EnvironmentDefinition['visualStyle']>['profile']>) {
  const base = ANYO_VISUAL_DEFAULTS.environment.colorGrading
  if (profile === 'anime-soft') return { ...base, enabled: true, saturation: 1.04, contrast: 1.03, temperature: 0.025, vignette: 0.035, highlightGlow: 0.04 }
  if (profile === 'anime') return { ...base, enabled: true, saturation: 1.08, contrast: 1.07, temperature: 0.045, tint: 0.01, vignette: 0.075, highlightGlow: 0.08 }
  if (profile === 'anime-cinematic') return { ...base, enabled: true, saturation: 1.1, contrast: 1.11, brightness: -0.01, temperature: 0.055, tint: 0.012, vignette: 0.14, vignetteSoftness: 0.62, highlightGlow: 0.14, highlightThreshold: 0.76 }
  if (profile === 'anime-rpg') return { ...base, enabled: true, saturation: 1.06, contrast: 1.08, brightness: -0.005, temperature: 0.025, tint: 0.006, vignette: 0.08, vignetteSoftness: 0.7, highlightGlow: 0.08, highlightThreshold: 0.82 }
  return { ...base }
}

export function normalizeEnvironmentDefinition(definition: EnvironmentDefinition = {}): NormalizedEnvironmentDefinition {
  const legacySunShadows = definition.sun?.shadows
  const castShadow = definition.sun?.castShadow ?? legacySunShadows ?? false
  const sharedShadow = { ...definition.shadows, ...definition.sun?.shadow }
  const requestedProfile = definition.visualStyle?.profile ?? ANYO_VISUAL_DEFAULTS.environment.visualStyle.profile
  const profileDefaults = visualProfileDefaults(requestedProfile)
  const visualStyle = { ...profileDefaults, ...definition.visualStyle, profile: requestedProfile }
  const atmosphereDefaults = ANYO_VISUAL_DEFAULTS.environment.atmosphere
  const requestedAtmosphereMode = definition.atmosphere?.mode ?? atmosphereDefaults.mode
  const colorGradingDefaults = colorGradingProfileDefaults(requestedProfile)
  return {
    ...definition,
    background: definition.background ?? ANYO_VISUAL_DEFAULTS.environment.background,
    visualStyle,
    ambientLight: {
      color: definition.ambientLight?.color ?? ANYO_VISUAL_DEFAULTS.environment.ambientColor,
      intensity: definition.ambientLight?.intensity ?? ANYO_VISUAL_DEFAULTS.environment.ambientIntensity,
    },
    lighting: {
      enabled: definition.lighting?.enabled ?? true,
      skyColor: definition.lighting?.skyColor ?? ANYO_VISUAL_DEFAULTS.environment.skyColor,
      groundColor: definition.lighting?.groundColor ?? ANYO_VISUAL_DEFAULTS.environment.groundColor,
      diffuseIntensity: definition.lighting?.diffuseIntensity ?? ANYO_VISUAL_DEFAULTS.environment.diffuseIntensity,
      specularIntensity: definition.lighting?.specularIntensity ?? ANYO_VISUAL_DEFAULTS.environment.specularIntensity,
      environmentMap: definition.lighting?.environmentMap,
      environmentRotation: definition.lighting?.environmentRotation ?? 0,
    },
    colorManagement: {
      toneMapping: definition.colorManagement?.toneMapping ?? ANYO_VISUAL_DEFAULTS.environment.toneMapping,
      exposure: definition.colorManagement?.exposure ?? ANYO_VISUAL_DEFAULTS.environment.exposure,
      outputColorSpace: definition.colorManagement?.outputColorSpace ?? ANYO_VISUAL_DEFAULTS.environment.outputColorSpace,
    },
    shadows: {
      enabled: definition.shadows?.enabled ?? castShadow,
      mapSize: definition.shadows?.mapSize ?? ANYO_VISUAL_DEFAULTS.environment.shadowMapSize,
      bias: definition.shadows?.bias ?? ANYO_VISUAL_DEFAULTS.environment.shadowBias,
      normalBias: definition.shadows?.normalBias ?? ANYO_VISUAL_DEFAULTS.environment.shadowNormalBias,
      softness: definition.shadows?.softness ?? ANYO_VISUAL_DEFAULTS.environment.shadowSoftness,
      cameraPadding: definition.shadows?.cameraPadding ?? ANYO_VISUAL_DEFAULTS.environment.shadowCameraPadding,
      cascades: definition.shadows?.cascades ?? ANYO_VISUAL_DEFAULTS.environment.shadowCascades,
      maxDistance: definition.shadows?.maxDistance ?? ANYO_VISUAL_DEFAULTS.environment.shadowMaxDistance,
      splitLambda: definition.shadows?.splitLambda ?? ANYO_VISUAL_DEFAULTS.environment.shadowSplitLambda,
      stabilize: definition.shadows?.stabilize ?? ANYO_VISUAL_DEFAULTS.environment.shadowStabilize,
      casterDistance: definition.shadows?.casterDistance ?? ANYO_VISUAL_DEFAULTS.environment.shadowCasterDistance,
      filter: definition.shadows?.filter ?? ANYO_VISUAL_DEFAULTS.environment.shadowFilter,
      cascadeBlend: definition.shadows?.cascadeBlend ?? ANYO_VISUAL_DEFAULTS.environment.shadowCascadeBlend,
      distanceFade: definition.shadows?.distanceFade ?? ANYO_VISUAL_DEFAULTS.environment.shadowDistanceFade,
    },
    imageQuality: {
      dithering: definition.imageQuality?.dithering ?? ANYO_VISUAL_DEFAULTS.environment.dithering,
      maxAnisotropy: definition.imageQuality?.maxAnisotropy ?? ANYO_VISUAL_DEFAULTS.environment.maxAnisotropy,
      renderScale: definition.imageQuality?.renderScale ?? ANYO_VISUAL_DEFAULTS.environment.renderScale,
      msaaSamples: definition.imageQuality?.msaaSamples ?? ANYO_VISUAL_DEFAULTS.environment.msaaSamples,
      mipmaps: definition.imageQuality?.mipmaps ?? ANYO_VISUAL_DEFAULTS.environment.mipmaps,
      antialiasing: definition.imageQuality?.antialiasing ?? ANYO_VISUAL_DEFAULTS.environment.antialiasing,
      sharpen: definition.imageQuality?.sharpen ?? ANYO_VISUAL_DEFAULTS.environment.sharpen,
    },
    atmosphere: {
      enabled: definition.atmosphere?.enabled ?? requestedAtmosphereMode !== 'none',
      mode: requestedAtmosphereMode,
      color: definition.atmosphere?.color ?? atmosphereDefaults.color,
      near: definition.atmosphere?.near ?? atmosphereDefaults.near,
      far: definition.atmosphere?.far ?? atmosphereDefaults.far,
      density: definition.atmosphere?.density ?? atmosphereDefaults.density,
      baseHeight: definition.atmosphere?.baseHeight ?? atmosphereDefaults.baseHeight,
      heightFalloff: definition.atmosphere?.heightFalloff ?? atmosphereDefaults.heightFalloff,
      maxOpacity: definition.atmosphere?.maxOpacity ?? atmosphereDefaults.maxOpacity,
    },
    postProcessing: {
      enabled: definition.postProcessing?.enabled ?? (
        definition.postProcessing?.ssao?.enabled === true ||
        definition.postProcessing?.bloom?.enabled === true ||
        definition.postProcessing?.outlines?.enabled === true
      ),
      colorGrading: {
        ...colorGradingDefaults,
        ...definition.postProcessing?.colorGrading,
      },
      ssao: { ...ANYO_VISUAL_DEFAULTS.environment.ssao, ...definition.postProcessing?.ssao },
      bloom: { ...ANYO_VISUAL_DEFAULTS.environment.bloom, ...definition.postProcessing?.bloom },
      outlines: { ...ANYO_VISUAL_DEFAULTS.environment.outlines, ...definition.postProcessing?.outlines },
    },
    optimization: {
      ...ANYO_VISUAL_DEFAULTS.environment.optimization,
      ...definition.optimization,
    },
    sun: {
      color: definition.sun?.color ?? ANYO_VISUAL_DEFAULTS.environment.sunColor,
      intensity: definition.sun?.intensity ?? ANYO_VISUAL_DEFAULTS.environment.sunIntensity,
      position: definition.sun?.position ?? ANYO_VISUAL_DEFAULTS.environment.sunPosition,
      shadows: castShadow,
      castShadow,
      shadow: {
        enabled: sharedShadow.enabled ?? castShadow,
        mapSize: sharedShadow.mapSize ?? ANYO_VISUAL_DEFAULTS.environment.shadowMapSize,
        bias: sharedShadow.bias ?? ANYO_VISUAL_DEFAULTS.environment.shadowBias,
        normalBias: sharedShadow.normalBias ?? ANYO_VISUAL_DEFAULTS.environment.shadowNormalBias,
        softness: sharedShadow.softness ?? ANYO_VISUAL_DEFAULTS.environment.shadowSoftness,
        cameraPadding: sharedShadow.cameraPadding ?? ANYO_VISUAL_DEFAULTS.environment.shadowCameraPadding,
        cascades: sharedShadow.cascades ?? ANYO_VISUAL_DEFAULTS.environment.shadowCascades,
        maxDistance: sharedShadow.maxDistance ?? ANYO_VISUAL_DEFAULTS.environment.shadowMaxDistance,
        splitLambda: sharedShadow.splitLambda ?? ANYO_VISUAL_DEFAULTS.environment.shadowSplitLambda,
        stabilize: sharedShadow.stabilize ?? ANYO_VISUAL_DEFAULTS.environment.shadowStabilize,
        casterDistance: sharedShadow.casterDistance ?? ANYO_VISUAL_DEFAULTS.environment.shadowCasterDistance,
        filter: sharedShadow.filter ?? ANYO_VISUAL_DEFAULTS.environment.shadowFilter,
        cascadeBlend: sharedShadow.cascadeBlend ?? ANYO_VISUAL_DEFAULTS.environment.shadowCascadeBlend,
        distanceFade: sharedShadow.distanceFade ?? ANYO_VISUAL_DEFAULTS.environment.shadowDistanceFade,
      },
    },
  }
}
