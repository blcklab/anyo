import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  GeometryValidationError,
  compileGeometry,
  lowerArchitecture,
  normalizeStandaloneDoorOpening,
  normalizeStandaloneWindowOpening,
} from '../dist/esm/geometry/index.js'

function compilePart(part) {
  return compileGeometry({
    kind: 'transform', source: part.geometry,
    position: part.transform.position,
    rotation: part.transform.rotation,
    scale: part.transform.scale,
  })
}
function healthy(mesh) {
  assert.ok(mesh.positions.length > 0)
  assert.ok(mesh.indices.length > 0)
  for (const value of mesh.positions) assert.ok(Number.isFinite(value))
  for (const index of mesh.indices) assert.ok(index < mesh.positions.length / 3)
}
function anchor(assembly, name) { return assembly.anchors.find(item => item.name === name) }

 test('S7 architecture stays a semantic lowering layer rather than new geometry kinds', () => {
  assert.deepEqual(BUILTIN_GEOMETRY_KIND_NAMES, ['box','roundedBox','plane','sphere','cylinder','cone','capsule','disc','torus','polygon','lathe','extrude','sweep','transform','mirror','noise','bend','twist','taper','union','subtract','intersect'])
  for (const semantic of ['wall','floor','ceiling','stairs','railing','column','beam','roof','panel','trim']) assert.ok(!BUILTIN_GEOMETRY_KIND_NAMES.includes(semantic))
})

 test('S7 wall lowers door/window openings into solid lower-level parts without CSG', () => {
  const assembly = lowerArchitecture({
    type:'wall', id:'main', from:[0,0,0], to:[8,0,0], height:3.2, thickness:.15, bevel:.01,
    openings:[
      {kind:'door',id:'door',offset:1,width:1,height:2.2},
      {kind:'window',id:'window',offset:4,width:1.8,height:1.4,sillHeight:.9},
    ],
  })
  assert.equal(assembly.type,'wall')
  assert.ok(assembly.parts.length >= 5)
  assert.ok(assembly.parts.every(part => ['box','roundedBox'].includes(part.geometry.kind)))
  assert.equal(assembly.instanceGroups.length,0)
  assert.ok(anchor(assembly,'opening:door:center'))
  assert.ok(anchor(assembly,'opening:window:center'))
  for (const part of assembly.parts) healthy(compilePart(part))
})

 test('S7 wall supports non-X horizontal orientation and preserves semantic anchors', () => {
  const assembly=lowerArchitecture({type:'wall',from:[2,0,3],to:[2,0,8],height:3,thickness:.2})
  assert.deepEqual(anchor(assembly,'left').position,[2,0,3])
  assert.deepEqual(anchor(assembly,'right').position,[2,0,8])
  const mesh=compilePart(assembly.parts[0])
  assert.ok(Math.abs(mesh.bounds.min[0]-1.9)<1e-5)
  assert.ok(Math.abs(mesh.bounds.max[0]-2.1)<1e-5)
  assert.ok(mesh.bounds.max[2]-mesh.bounds.min[2] > 4.99)
})

 test('S7 rejects overlapping wall openings with structured recovery errors', () => {
  assert.throws(()=>lowerArchitecture({
    type:'wall',from:[0,0,0],to:[6,0,0],height:3,thickness:.2,
    openings:[
      {kind:'window',offset:1,width:2,height:1.5,sillHeight:.7},
      {kind:'window',offset:2,width:2,height:1.2,sillHeight:1},
    ],
  }), error=>error instanceof GeometryValidationError && error.issues[0].code==='ARCHITECTURE_OPENING_OVERLAP' && !!error.issues[0].suggestion)
})

 test('S7 floor ceiling panel column and beam all lower into reusable S2-S6 geometry', () => {
  const defs=[
    {type:'floor',id:'floor',size:[6,8],thickness:.2,position:[0,-.1,0],bevel:.01},
    {type:'ceiling',id:'ceiling',size:[6,8],thickness:.15,position:[0,3,0]},
    {type:'panel',id:'panel',size:[2,1],thickness:.06,position:[0,1.5,-3.9],bevel:.01},
    {type:'column',id:'rect',position:[-2,0,-2],height:3,size:[.4,.4],bevel:.02},
    {type:'column',id:'round',position:[2,0,-2],height:3,shape:'round',radius:.2,segments:24},
    {type:'beam',id:'beam',from:[-2,2.8,-2],to:[2,2.8,-2],height:.25,depth:.3,bevel:.015},
  ]
  for(const def of defs){
    const assembly=lowerArchitecture(def)
    assert.equal(assembly.parts.length,1)
    healthy(compilePart(assembly.parts[0]))
  }
})

 test('S7 stairs reuse shared tread/riser geometry through instance groups', () => {
  const stairs=lowerArchitecture({type:'stairs',id:'stairs',width:1.8,height:3.2,steps:16,depth:4.8,position:[0,0,0],landingDepth:1})
  assert.equal(stairs.instanceGroups.length,2)
  const treads=stairs.instanceGroups.find(group=>group.role==='stairs:tread')
  const risers=stairs.instanceGroups.find(group=>group.role==='stairs:riser')
  assert.equal(treads.placements.length,16)
  assert.equal(risers.placements.length,16)
  assert.equal(stairs.parts.length,1)
  healthy(compileGeometry(treads.geometry))
  healthy(compileGeometry(risers.geometry))
  healthy(compilePart(stairs.parts[0]))
  assert.ok(anchor(stairs,'top').position[1] > 3.19)
})

 test('S7 stair placement safety limits bound AI-authored repetition', () => {
  assert.throws(
    ()=>lowerArchitecture({type:'stairs',width:1,height:3,steps:60,depth:6},{limits:{maxGeneratedInstances:100}}),
    error=>error instanceof GeometryValidationError && error.issues[0].code==='ARCHITECTURE_LIMIT',
  )
})

 test('S7 railing composes S5 sweep rail with non-baked post placements', () => {
  const railing=lowerArchitecture({
    type:'railing',id:'rail',height:1.05,postSpacing:.75,postWidth:.04,railRadius:.03,midRailHeight:.55,
    path:{kind:'polyline',points:[[0,0,0],[3,0,0],[5,0,2]],segments:20},
  })
  assert.equal(railing.parts.length,2)
  assert.equal(railing.parts[0].geometry.kind,'sweep')
  assert.equal(railing.instanceGroups.length,1)
  assert.ok(railing.instanceGroups[0].placements.length > 5)
  healthy(compileGeometry(railing.parts[0].geometry))
  healthy(compileGeometry(railing.parts[1].geometry))
  healthy(compileGeometry(railing.instanceGroups[0].geometry))
})

 test('S7 trim is a semantic sweep rather than a custom mesh generator', () => {
  const trim=lowerArchitecture({type:'trim',id:'trim',width:.08,depth:.025,path:{kind:'cubicBezier',points:[[0,0,0],[1,0,0],[2,1,0],[3,1,0]],segments:24}})
  assert.equal(trim.parts.length,1)
  assert.equal(trim.parts[0].geometry.kind,'sweep')
  healthy(compileGeometry(trim.parts[0].geometry))
})

 test('S7 roof lowers gable and shed forms into transformed rounded boxes', () => {
  const gable=lowerArchitecture({type:'roof',id:'roof',kind:'gable',size:[8,10],thickness:.12,pitch:.45,position:[0,3,0],bevel:.01})
  assert.equal(gable.parts.length,2)
  for(const part of gable.parts) healthy(compilePart(part))
  const shed=lowerArchitecture({type:'roof',kind:'shed',size:[6,8],thickness:.1,pitch:.25,position:[0,3,0]})
  assert.equal(shed.parts.length,1)
  healthy(compilePart(shed.parts[0]))
})

 test('S7 standalone opening semantics stay negative-space metadata, not fake meshes', () => {
  assert.deepEqual(normalizeStandaloneDoorOpening({type:'doorOpening',id:'d',width:1,height:2.2}),{type:'doorOpening',id:'d',width:1,height:2.2})
  assert.deepEqual(normalizeStandaloneWindowOpening({type:'windowOpening',width:1.8,height:1.4,sillHeight:.9}),{type:'windowOpening',width:1.8,height:1.4,sillHeight:.9})
  const opening=lowerArchitecture({type:'doorOpening',width:1,height:2})
  assert.equal(opening.parts.length,0)
  assert.equal(opening.instanceGroups.length,0)
  assert.ok(anchor(opening,'opening:center'))
})

 test('S7 lowering is deterministic and leaves renderer/material ownership outside architecture', () => {
  const definition={type:'wall',id:'det',from:[0,0,0],to:[5,0,0],height:3,thickness:.15,openings:[{kind:'window',offset:2,width:1,height:1,sillHeight:1}]}
  const a=lowerArchitecture(definition), b=lowerArchitecture(definition)
  assert.deepEqual(a,b)
  assert.ok(a.parts.every(part=>!('material' in part.geometry) && !('renderer' in part.geometry)))
})
