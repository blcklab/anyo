import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('rc20 renderer-neutral cloud contract includes bounded horizon-underlap controls', async()=>{
  const types=await readFile(new URL('../src/core/types.ts',import.meta.url),'utf8')
  const world=await readFile(new URL('../src/core/World.ts',import.meta.url),'utf8')
  for(const field of ['horizonExtension','horizonCompression','horizonAtmosphericFade']){
    assert.match(types,new RegExp(field))
    assert.match(world,new RegExp(field))
  }
})

test('rc20 Sekai64 adapter stays generic and forwards runtime state without cloud-domain packages', async()=>{
  const adapter=await readFile(new URL('../src/renderer-sekai64/Sekai64Renderer.ts',import.meta.url),'utf8')
  assert.match(adapter,/setProceduralClouds\(\{\s*\.\.\.state,/s)
  assert.doesNotMatch(adapter,/CloudSystem|WeatherSystem|SiriusX|Helios|Luna/)
})
