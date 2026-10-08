# Anyo Track C Optimization Contract

Anyo stores renderer-neutral optimization intent. Sekai64 or another renderer decides how that intent is implemented, reduced, or rejected according to host policy and runtime capabilities.

```json
{
  "environment": {
    "optimization": {
      "frustumCulling": true,
      "cachedBounds": true,
      "pipelineSorting": true,
      "shadowCasterCulling": true,
      "lodHysteresis": 0.1,
      "hizOcclusion": true,
      "hizResolution": 128,
      "occlusionHistoryFrames": 2,
      "occlusionMinimumPixels": 3,
      "clusteredLighting": true,
      "clusterDimensions": [16, 9, 24],
      "maxLightsPerCluster": 24,
      "maxClusteredLights": 1024,
      "staticBatching": true,
      "staticBatchMinInstances": 3,
      "textureMemoryBudgetMB": 512,
      "textureEvictionFrames": 300,
      "geometryMemoryBudgetMB": 768,
      "geometryEvictionFrames": 360,
      "regionStreaming": true,
      "streamingLoadDistance": 180,
      "streamingUnloadDistance": 260,
      "streamingConcurrency": 6,
      "worldOriginRebasing": false,
      "worldOriginThreshold": 10000,
      "worldOriginGridSize": 1000
    }
  }
}
```

## Ownership

Anyo owns:

- JSON types, defaults, validation, migration, and deterministic normalization.
- Portable optimization requests and diagnostics.

The host and renderer own:

- Actual memory limits and device policy.
- Spatial structures, culling, batching, clustering, streaming, rebasing, cache lifetime, and GPU resource management.
- Whether a requested optimization is supported or downgraded.

Track C adds no renderer dependency to Anyo core and does not move runtime algorithms into JSON.
