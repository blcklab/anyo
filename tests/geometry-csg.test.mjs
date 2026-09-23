import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  CSG_OPERATIONS,
  GeometryValidationError,
  booleanGeometryMeshes,
  compileGeometry,
  createGeometryCompiler,
} from '../dist/esm/geometry/index.js'

const box = { kind:'box', size:[2,2,2] }
const shiftedBox = (x,y=0,z=0) => ({ kind:'transform', source:box, position:[x,y,z] })

function near(a,b,eps=1e-5){ return Math.abs(a-b)<=eps }
function volume(mesh){
  let sum=0
  for(let o=0;o<mesh.indices.length;o+=3){
    const ia=mesh.indices[o]*3, ib=mesh.indices[o+1]*3, ic=mesh.indices[o+2]*3
    const a=[mesh.positions[ia],mesh.positions[ia+1],mesh.positions[ia+2]]
    const b=[mesh.positions[ib],mesh.positions[ib+1],mesh.positions[ib+2]]
    const c=[mesh.positions[ic],mesh.positions[ic+1],mesh.positions[ic+2]]
    const cross=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]]
    sum += a[0]*cross[0]+a[1]*cross[1]+a[2]*cross[2]
  }
  return Math.abs(sum/6)
}
function healthy(mesh){
  assert.ok(mesh.positions instanceof Float32Array)
  assert.ok(mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array)
  assert.ok(mesh.positions.length>0 && mesh.indices.length>0)
  assert.equal(mesh.positions.length%3,0)
  assert.equal(mesh.indices.length%3,0)
  const vertices=mesh.positions.length/3
  for(const value of mesh.positions) assert.ok(Number.isFinite(value))
  for(const index of mesh.indices) assert.ok(index<vertices)
  for(let o=0;o<mesh.indices.length;o+=3){
    const ia=mesh.indices[o]*3,ib=mesh.indices[o+1]*3,ic=mesh.indices[o+2]*3
    const ax=mesh.positions[ia],ay=mesh.positions[ia+1],az=mesh.positions[ia+2]
    const abx=mesh.positions[ib]-ax,aby=mesh.positions[ib+1]-ay,abz=mesh.positions[ib+2]-az
    const acx=mesh.positions[ic]-ax,acy=mesh.positions[ic+1]-ay,acz=mesh.positions[ic+2]-az
    assert.ok(Math.hypot(aby*acz-abz*acy,abz*acx-abx*acz,abx*acy-aby*acx)>1e-8)
  }
}

 test('S8 registers safe union subtract intersect geometry expressions', () => {
  assert.deepEqual(CSG_OPERATIONS,['union','subtract','intersect'])
  for(const kind of CSG_OPERATIONS) assert.ok(BUILTIN_GEOMETRY_KIND_NAMES.includes(kind))
})

 test('S8 union combines overlapping closed solids with correct bounds and volume', () => {
  const mesh=compileGeometry({kind:'union',left:box,right:shiftedBox(1)})
  healthy(mesh)
  assert.deepEqual(mesh.bounds.min,[-1,-1,-1])
  assert.deepEqual(mesh.bounds.max,[2,1,1])
  assert.ok(near(volume(mesh),12))
  assert.ok(mesh.groups.some(group=>group.name?.startsWith('left:')))
  assert.ok(mesh.groups.some(group=>group.name?.startsWith('right:')))
})

 test('S8 subtract creates deterministic cut surfaces without changing outer bounds', () => {
  const mesh=compileGeometry({kind:'subtract',left:box,right:shiftedBox(1)})
  healthy(mesh)
  assert.deepEqual(mesh.bounds.min,[-1,-1,-1])
  assert.deepEqual(mesh.bounds.max,[0,1,1])
  assert.ok(near(volume(mesh),4))
  assert.ok(mesh.groups.some(group=>group.name?.startsWith('cut:')))
})

 test('S8 intersect returns only positive-volume overlap', () => {
  const mesh=compileGeometry({kind:'intersect',left:box,right:shiftedBox(1)})
  healthy(mesh)
  assert.deepEqual(mesh.bounds.min,[0,-1,-1])
  assert.deepEqual(mesh.bounds.max,[1,1,1])
  assert.ok(near(volume(mesh),4))
})

 test('S8 Boolean results are deterministic across cache-disabled recompilation', () => {
  const definition={kind:'subtract',left:{kind:'sphere',radius:1,segments:16,rings:8},right:shiftedBox(.65)}
  const compiler=createGeometryCompiler({cache:false})
  const a=compiler.compile(definition), b=compiler.compile(definition)
  assert.deepEqual([...a.positions],[...b.positions])
  assert.deepEqual([...a.indices],[...b.indices])
  assert.deepEqual(a.groups,b.groups)
})

 test('S8 normalized child defaults participate in stable Boolean geometry identity', () => {
  const compiler=createGeometryCompiler()
  const a={kind:'union',left:{kind:'box'},right:{kind:'transform',source:{kind:'box'},position:[1,0,0]}}
  const b={kind:'union',left:{kind:'box',size:[1,1,1]},right:{kind:'transform',source:{kind:'box',size:[1,1,1]},position:[1,0,0],rotation:[0,0,0],scale:[1,1,1]}}
  assert.equal(compiler.keyFor(a),compiler.keyFor(b))
})

 test('S8 rejects open or zero-volume operands before BSP work', () => {
  assert.throws(
    ()=>compileGeometry({kind:'union',left:{kind:'plane',size:[2,2]},right:box}),
    error=>error instanceof GeometryValidationError && error.issues[0].code==='CSG_SOLID_INVALID' && !!error.issues[0].suggestion,
  )
})

 test('S8 disjoint intersection fails closed with an explicit empty-result error', () => {
  assert.throws(
    ()=>compileGeometry({kind:'intersect',left:box,right:shiftedBox(5)}),
    error=>error instanceof GeometryValidationError && error.issues[0].code==='CSG_EMPTY_RESULT' && !!error.issues[0].suggestion,
  )
})

 test('S8 maxBooleanDepth bounds recursive AI-authored Boolean expressions independently of modifier depth', () => {
  const compiler=createGeometryCompiler({limits:{maxBooleanDepth:1,maxModifierDepth:20}})
  const nested={kind:'union',left:{kind:'subtract',left:box,right:shiftedBox(.5)},right:shiftedBox(2)}
  assert.throws(
    ()=>compiler.compile(nested),
    error=>error instanceof GeometryValidationError && error.issues.some(issue=>issue.code==='CSG_DEPTH_LIMIT'),
  )
})

 test('S8 surface policy can regenerate flat normals box UVs and tangents after a Boolean', () => {
  const mesh=compileGeometry({
    kind:'subtract',left:{kind:'box',size:[3,3,3]},right:{kind:'box',size:[1,1,1]},
    normals:{mode:'flat'},uv:{mode:'box',metersPerTile:1},tangents:true,
  })
  healthy(mesh)
  assert.equal(mesh.normals.length,mesh.positions.length)
  assert.equal(mesh.uvs.length,(mesh.positions.length/3)*2)
  assert.equal(mesh.tangents.length,(mesh.positions.length/3)*4)
  for(let i=0;i<mesh.tangents.length;i+=4) assert.ok(near(Math.hypot(mesh.tangents[i],mesh.tangents[i+1],mesh.tangents[i+2]),1,1e-4))
  assert.ok(near(volume(mesh),26))
})

 test('S8 direct mesh Boolean API uses the same validated solid contract', () => {
  const left=compileGeometry(box), right=compileGeometry(shiftedBox(1))
  const mesh=booleanGeometryMeshes(left,right,'intersect')
  healthy(mesh)
  assert.ok(near(volume(mesh),4))
})

 test('S8 union handles exactly touching coplanar box faces without retaining an internal wall', () => {
  const mesh=compileGeometry({kind:'union',left:box,right:shiftedBox(2)})
  healthy(mesh)
  assert.deepEqual(mesh.bounds.min,[-1,-1,-1])
  assert.deepEqual(mesh.bounds.max,[3,1,1])
  assert.ok(near(volume(mesh),16))
})

 test('S8 identical-solid union/intersection are stable while identical subtraction is empty', () => {
  const union=compileGeometry({kind:'union',left:box,right:box})
  const intersect=compileGeometry({kind:'intersect',left:box,right:box})
  assert.ok(near(volume(union),8))
  assert.ok(near(volume(intersect),8))
  assert.throws(()=>compileGeometry({kind:'subtract',left:box,right:box}),error=>error instanceof GeometryValidationError && error.issues[0].code==='CSG_EMPTY_RESULT')
})

 test('S8 subtraction supports enclosed cavities and preserves a watertight multi-surface solid', () => {
  const mesh=compileGeometry({kind:'subtract',left:{kind:'box',size:[2,2,2]},right:{kind:'box',size:[1,1,1]}})
  healthy(mesh)
  assert.deepEqual(mesh.bounds.min,[-1,-1,-1])
  assert.deepEqual(mesh.bounds.max,[1,1,1])
  assert.ok(near(volume(mesh),7))
  assert.ok(mesh.groups.some(group=>group.name?.startsWith('cut:')))
})
