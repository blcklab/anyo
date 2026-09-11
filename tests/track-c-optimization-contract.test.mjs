import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inspectWorldDocument, normalizeEnvironmentDefinition } from '../dist/esm/index.js'

test('Track C optimization intent normalizes large-world, lighting, and residency controls', () => {
  const environment = normalizeEnvironmentDefinition({
    optimization: {
      hizOcclusion: true,
      hizResolution: 128,
      occlusionHistoryFrames: 3,
      occlusionMinimumPixels: 4,
      clusteredLighting: true,
      clusterDimensions: [16, 9, 24],
      maxLightsPerCluster: 24,
      maxClusteredLights: 1536,
      textureMemoryBudgetMB: 512,
      textureEvictionFrames: 240,
      geometryMemoryBudgetMB: 768,
      geometryEvictionFrames: 360,
      regionStreaming: true,
      streamingLoadDistance: 180,
      streamingUnloadDistance: 260,
      streamingConcurrency: 6,
      worldOriginRebasing: true,
      worldOriginThreshold: 20_000,
      worldOriginGridSize: 2_000,
    },
  })
  assert.equal(environment.optimization.occlusionHistoryFrames, 3)
  assert.equal(environment.optimization.maxClusteredLights, 1536)
  assert.equal(environment.optimization.geometryMemoryBudgetMB, 768)
  assert.equal(environment.optimization.regionStreaming, true)
  assert.equal(environment.optimization.streamingUnloadDistance, 260)
  assert.equal(environment.optimization.worldOriginRebasing, true)
  assert.equal(environment.optimization.worldOriginGridSize, 2_000)
})

test('Track C optimization validation rejects unsafe ranges', () => {
  const result = inspectWorldDocument({
    version: '0.7',
    entities: [],
    environment: {
      optimization: {
        occlusionHistoryFrames: 0,
        occlusionMinimumPixels: 100,
        maxClusteredLights: 0,
        geometryMemoryBudgetMB: -1,
        streamingLoadDistance: 100,
        streamingUnloadDistance: 50,
        streamingConcurrency: 0,
        worldOriginThreshold: 0,
        worldOriginGridSize: -1,
      },
    },
  })
  const codes = new Set(result.errors.map(error => error.code))
  for (const code of [
    'OCCLUSION_HISTORY_INVALID',
    'OCCLUSION_MINIMUM_PIXELS_INVALID',
    'MAX_CLUSTERED_LIGHTS_INVALID',
    'GEOMETRY_BUDGET_INVALID',
    'STREAMING_UNLOAD_DISTANCE_INVALID',
    'STREAMING_CONCURRENCY_INVALID',
    'WORLD_ORIGIN_THRESHOLD_INVALID',
    'WORLD_ORIGIN_GRID_INVALID',
  ]) assert.ok(codes.has(code), `missing ${code}`)
})

test('Track C schema exposes renderer-neutral policies only', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/world-0.7.schema.json', import.meta.url), 'utf8'))
  const properties = schema.$defs.environment.properties.optimization.properties
  for (const name of [
    'occlusionHistoryFrames', 'occlusionMinimumPixels', 'maxClusteredLights',
    'geometryMemoryBudgetMB', 'geometryEvictionFrames', 'regionStreaming',
    'streamingLoadDistance', 'streamingUnloadDistance', 'streamingConcurrency',
    'worldOriginRebasing', 'worldOriginThreshold', 'worldOriginGridSize',
  ]) assert.ok(properties[name], `missing schema property ${name}`)
  const serialized = JSON.stringify(schema)
  assert.equal(serialized.includes('GPUBuffer'), false)
  assert.equal(serialized.includes('createRenderPipeline'), false)
})
