import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/renderer-sekai64/Sekai64Renderer.ts', import.meta.url), 'utf8')

test('rc21 keeps authored procedural clouds baked until runtime opt-in', () => {
  assert.match(source, /renderer\.setProceduralClouds\?\.\(undefined\)[\s\S]*cloudCoverage: environment\.sky\.cloudCoverage/)
  assert.doesNotMatch(source, /const dynamicClouds = typeof renderer\.setProceduralClouds/)
})

test('rc21 runtime opt-in removes baked clouds before enabling dynamic overlay', () => {
  assert.match(source, /if \(!this\.runtimeProceduralCloudsActive[\s\S]*runtimeProceduralCloudsActive = true[\s\S]*refreshRuntimeSkyMap[\s\S]*renderer\.setProceduralClouds\(/)
})

test('rc21 reset restores authored baked cloud presentation', () => {
  assert.match(source, /resetRuntimeProceduralCloudState\(\): void[\s\S]*setProceduralClouds\?\.\(undefined\)[\s\S]*cloudCoverage: environment\.sky\.cloudCoverage/)
})
