import test from 'node:test'
import assert from 'node:assert/strict'
import { compileWorld, inspectWorldDocument } from '../src/index.js'

test('map components preserve geographic and editable base data', () => {
  const world = { version:'0.6', units:'meters', entities:[{id:'cell',type:'group',components:[{type:'anyo.map',provider:'openstreetmap',origin:{latitude:14.6,longitude:120.98},cell:{zoom:17,x:109000,y:52000},attribution:'© OpenStreetMap contributors'}]},{id:'building',type:'group',components:[{type:'anyo.mapFeature',featureType:'building',source:'openstreetmap',sourceId:'way/1',footprint:[[0,0],[10,0],[10,8],[0,8]],height:9,minHeight:0,generated:true,layer:'base'}]}] } as const
  const result = compileWorld(world)
  assert.equal(result.entities[0]?.components[0]?.type, 'anyo.map')
  assert.equal(result.entities[1]?.components[0]?.data.sourceId, 'way/1')
})

test('map contracts reject unsafe geographic and geometry values', () => {
  const result=inspectWorldDocument({version:'0.6',entities:[{id:'cell',type:'group',components:[{type:'anyo.map',origin:{latitude:100,longitude:0}}]},{id:'bad',type:'group',components:[{type:'anyo.mapFeature',featureType:'building',footprint:[[0,0],[1,0]],height:-1}]}]} as never)
  assert.equal(result.valid,false)
  assert.ok(result.errors.some(issue=>issue.code==='MAP_LATITUDE_INVALID'))
  assert.ok(result.errors.some(issue=>issue.code==='MAP_FOOTPRINT_INVALID'))
  assert.ok(result.errors.some(issue=>issue.code==='MAP_HEIGHT_INVALID'))
})
