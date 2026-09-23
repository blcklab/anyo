import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_GEOMETRY_KIND_NAMES,
  GeometryValidationError,
  compileGeometry,
  createGeometryCompiler,
  layoutGeometryArray,
} from '../dist/esm/geometry/index.js'

function near(a,b,eps=1e-6){ return Math.abs(a-b)<=eps }
function normal(mesh, offset=0){
  const ia=mesh.indices[offset]*3, ib=mesh.indices[offset+1]*3, ic=mesh.indices[offset+2]*3
  const a=[mesh.positions[ia],mesh.positions[ia+1],mesh.positions[ia+2]]
  const b=[mesh.positions[ib],mesh.positions[ib+1],mesh.positions[ib+2]]
  const c=[mesh.positions[ic],mesh.positions[ic+1],mesh.positions[ic+2]]
  const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]]
  return [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]
}
function len(v){ return Math.hypot(...v) }

 test('S6 registers transform and mirror as composable mesh modifiers without baking array into a geometry kind', () => {
  assert.deepEqual(BUILTIN_GEOMETRY_KIND_NAMES, ['box','roundedBox','plane','sphere','cylinder','cone','capsule','disc','torus','polygon','lathe','extrude','sweep','transform','mirror','noise','bend','twist','taper','union','subtract','intersect'])
  assert.ok(!BUILTIN_GEOMETRY_KIND_NAMES.includes('array'))
})

 test('S6 geometry-local transform applies translation rotation and scale with exact bounds', () => {
  const mesh=compileGeometry({
    kind:'transform', source:{kind:'box',size:[2,4,6]},
    position:[10,2,-3], rotation:[0,Math.PI/2,0], scale:[2,.5,1],
  })
  assert.deepEqual(mesh.bounds.min,[7,1,-5])
  assert.deepEqual(mesh.bounds.max,[13,3,-1])
})

 test('S6 transform preserves unit normals under non-uniform scale', () => {
  const mesh=compileGeometry({kind:'transform',source:{kind:'sphere',radius:1,segments:16,rings:8},scale:[2,.5,3]})
  assert.ok(mesh.normals)
  for(let i=0;i<mesh.normals.length;i+=3) assert.ok(near(Math.hypot(mesh.normals[i],mesh.normals[i+1],mesh.normals[i+2]),1,1e-5))
})

 test('S6 negative scale repairs triangle winding and tangent handedness', () => {
  const source=compileGeometry({kind:'plane',size:[2,2],tangents:true})
  const mirrored=compileGeometry({kind:'transform',source:{kind:'plane',size:[2,2],tangents:true},scale:[-1,1,1]})
  assert.ok(normal(source)[2] > 0)
  assert.ok(normal(mirrored)[2] > 0)
  assert.equal(Math.sign(mirrored.tangents[3]),-Math.sign(source.tangents[3]))
})

 test('S6 transform normalization resolves nested source defaults before hashing', () => {
  const compiler=createGeometryCompiler()
  const a={kind:'transform',source:{kind:'box'},position:[1,2,3]}
  const b={kind:'transform',source:{kind:'box',size:[1,1,1]},position:[1,2,3],rotation:[0,0,0],scale:[1,1,1]}
  assert.equal(compiler.keyFor(a),compiler.keyFor(b))
})

 test('S6 nested modifier compilation is deterministic and bounded', () => {
  const compiler=createGeometryCompiler({limits:{maxModifierDepth:2}})
  const valid={kind:'transform',source:{kind:'mirror',source:{kind:'box'},axis:'x',includeOriginal:false},position:[1,0,0]}
  assert.deepEqual(compiler.compile(valid).bounds,compiler.compile(valid).bounds)
  const tooDeep={kind:'transform',source:{kind:'mirror',source:{kind:'transform',source:{kind:'box'}}}}
  assert.throws(()=>compiler.compile(tooDeep),error=>error instanceof GeometryValidationError && error.issues.some(issue=>issue.code==='GEOMETRY_MODIFIER_LIMIT'))
})

 test('S6 mirror defaults to symmetry by keeping original plus reflected copy', () => {
  const mesh=compileGeometry({kind:'mirror',source:{kind:'box',size:[2,2,2],},axis:'x',offset:2})
  assert.deepEqual(mesh.bounds.min,[-1,-1,-1])
  assert.deepEqual(mesh.bounds.max,[5,1,1])
  assert.equal(mesh.indices.length,72)
  assert.equal(mesh.groups.length,12)
})

 test('S6 mirror can replace the source and reflect across an offset plane', () => {
  const mesh=compileGeometry({kind:'mirror',source:{kind:'box',size:[2,2,2]},axis:'x',offset:2,includeOriginal:false})
  assert.deepEqual(mesh.bounds.min,[3,-1,-1])
  assert.deepEqual(mesh.bounds.max,[5,1,1])
  for(let offset=0;offset<mesh.indices.length;offset+=3) assert.ok(len(normal(mesh,offset))>1e-9)
})

 test('S6 mirrored tangent geometry stays valid for S3 normal-map attributes', () => {
  const mesh=compileGeometry({kind:'mirror',source:{kind:'box',size:[2,2,2],tangents:true},axis:'z',includeOriginal:false})
  assert.equal(mesh.tangents.length,(mesh.positions.length/3)*4)
  for(let i=0;i<mesh.tangents.length;i+=4) assert.ok(near(Math.hypot(mesh.tangents[i],mesh.tangents[i+1],mesh.tangents[i+2]),1,1e-5))
})

 test('S6 linear array produces deterministic placement resources instead of merged geometry', () => {
  const layout=layoutGeometryArray({
    source:{kind:'roundedBox',size:[1,2,.2],radius:.03},count:4,offset:[.5,0,0],position:[1,2,3],rotation:[0,.1,0],rotationOffset:[0,.2,0],scale:[1,2,1],
  })
  assert.equal(layout.placements.length,4)
  assert.deepEqual(layout.placements.map(item=>item.position),[[1,2,3],[1.5,2,3],[2,2,3],[2.5,2,3]])
  assert.deepEqual(layout.placements.map(item=>item.rotation[1]),[.1,.30000000000000004,.5,.7000000000000001])
  assert.deepEqual(layout.placements[3].scale,[1,2,1])
  assert.equal(layout.source.kind,'roundedBox')
})

 test('S6 array placement changes do not alter source geometry identity', () => {
  const compiler=createGeometryCompiler()
  const source={kind:'cylinder',radius:.1,height:1,segments:16}
  const a=layoutGeometryArray({source,count:3,offset:[1,0,0]})
  const b=layoutGeometryArray({source,count:8,offset:[0,0,2]})
  assert.equal(compiler.keyFor(a.source),compiler.keyFor(b.source))
})

 test('S6 array safety limit rejects unreasonable AI-authored instance counts', () => {
  assert.throws(
    ()=>layoutGeometryArray({source:{kind:'box'},count:101,offset:[1,0,0]},{limits:{maxGeneratedInstances:100}}),
    error=>error instanceof GeometryValidationError && error.issues[0].code==='GEOMETRY_INSTANCE_LIMIT' && !!error.issues[0].suggestion,
  )
})
