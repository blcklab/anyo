import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ResourceGraph,
  ResourceGraphError,
  createResourceGraphBuilder,
} from '../dist/esm/resources/index.js'

const basicMaterial = { baseColor:'#ffffff', roughness:.8, metalness:0 }

function issue(error, code) {
  return error instanceof ResourceGraphError && error.issues.some(item => item.code === code)
}

 test('S9 geometry resources are content-addressed and normalized before deduplication', () => {
  const builder=createResourceGraphBuilder()
  const a=builder.addGeometry({kind:'box'})
  const b=builder.addGeometry({kind:'box',size:[1,1,1]})
  assert.equal(a,b)
  const graph=builder.build()
  assert.equal(graph.list('geometry').length,1)
  assert.match(a,/^geometry:g1-/)
})

 test('S9 nested transform/CSG expressions form explicit geometry dependency edges', () => {
  const builder=createResourceGraphBuilder()
  const root=builder.addGeometry({
    kind:'subtract',
    left:{kind:'transform',source:{kind:'box',size:[3,3,3]},position:[1,0,0]},
    right:{kind:'sphere',radius:.5,segments:12,rings:6},
  })
  const graph=builder.build()
  assert.equal(graph.list('geometry').length,4)
  const direct=graph.dependenciesOf(root)
  assert.equal(direct.length,2)
  const all=graph.dependenciesOf(root,{transitive:true})
  assert.equal(all.length,3)
  assert.equal(graph.snapshot().topologicalOrder.at(-1),root)
})

 test('S9 material resources normalize visual defaults and deduplicate equivalent definitions', () => {
  const builder=createResourceGraphBuilder()
  const a=builder.addMaterial({baseColor:'#ffffff'})
  const b=builder.addMaterial({baseColor:'#ffffff',roughness:.8,metalness:0,normalScale:1,occlusionStrength:1,opacity:1,alphaMode:'opaque',alphaCutoff:.5,transparent:false,side:'front',doubleSided:false,castShadow:true,receiveShadow:true,emissive:'#000000',emissiveIntensity:0})
  assert.equal(a,b)
  assert.match(a,/^material:m1-/)
})

 test('S9 assets are content-addressed and material asset dependencies remain explicit', () => {
  const builder=createResourceGraphBuilder()
  const asset=builder.addAsset({src:'./textures/wall.png',type:'texture',colorSpace:'srgb'})
  const asset2=builder.addAsset({colorSpace:'srgb',type:'texture',src:'./textures/wall.png'})
  assert.equal(asset,asset2)
  const material=builder.addMaterial({baseColorTexture:'wall'}, {assets:[asset]})
  const instanceSource=builder.addGeometry({kind:'plane',size:[2,2]})
  const instance=builder.addInstance({id:'wall-panel',source:instanceSource,materials:[material]})
  const graph=builder.build()
  assert.deepEqual(graph.dependenciesOf(material),[asset])
  assert.deepEqual(graph.dependenciesOf(instance),[instanceSource,material].sort())
})

 test('S9 instance identity stays semantic even when instance content is identical', () => {
  const builder=createResourceGraphBuilder()
  const source=builder.addGeometry({kind:'box'})
  const a=builder.addInstance({id:'chair/a',source,transform:{position:[1,0,0]}})
  const b=builder.addInstance({id:'chair/b',source,transform:{position:[1,0,0]}})
  assert.notEqual(a,b)
  const graph=builder.build()
  const na=graph.get(a), nb=graph.get(b)
  assert.equal(na.kind,'instance')
  assert.equal(nb.kind,'instance')
  assert.equal(na.key,nb.key)
})

 test('S9 missing resource references fail at graph finalization with repair guidance', () => {
  const builder=createResourceGraphBuilder()
  builder.addInstance({id:'broken',source:'geometry:g1-missing'})
  assert.throws(()=>builder.build(),error=>issue(error,'RESOURCE_REFERENCE_MISSING') && !!error.issues[0].suggestion)
})

 test('S9 resource reference kinds are validated independently from existence', () => {
  const builder=createResourceGraphBuilder()
  const material=builder.addMaterial(basicMaterial)
  builder.addInstance({id:'wrong-source',source:material})
  assert.throws(()=>builder.build(),error=>issue(error,'RESOURCE_REFERENCE_INVALID'))
})

 test('S9 graph rejects explicit dependency cycles', () => {
  const a=Object.freeze({id:'asset:a',kind:'asset',key:'a1-a',dependencies:Object.freeze(['asset:b']),assetDependencies:Object.freeze(['asset:b']),definition:{src:'a'}})
  const b=Object.freeze({id:'asset:b',kind:'asset',key:'a1-b',dependencies:Object.freeze(['asset:a']),assetDependencies:Object.freeze(['asset:a']),definition:{src:'b'}})
  assert.throws(()=>new ResourceGraph([a,b]),error=>issue(error,'RESOURCE_CYCLE'))
})

 test('S9 targeted invalidation follows reverse dependencies without invalidating unrelated geometry', () => {
  const builder=createResourceGraphBuilder()
  const texture=builder.addAsset({src:'wall.png'})
  const material=builder.addMaterial({baseColorTexture:'wall'}, {assets:[texture]})
  const wallGeometry=builder.addGeometry({kind:'box',size:[4,3,.2]})
  const wall=builder.addInstance({id:'wall',source:wallGeometry,materials:[material]})
  const unrelatedGeometry=builder.addGeometry({kind:'sphere',radius:1})
  const unrelated=builder.addInstance({id:'orb',source:unrelatedGeometry})
  const graph=builder.build()
  const invalidated=graph.invalidationSet([texture])
  assert.ok(invalidated.includes(texture))
  assert.ok(invalidated.includes(material))
  assert.ok(invalidated.includes(wall))
  assert.ok(!invalidated.includes(wallGeometry))
  assert.ok(!invalidated.includes(unrelatedGeometry))
  assert.ok(!invalidated.includes(unrelated))
})

 test('S9 architecture assemblies lower into shared geometry resources plus semantic instances', () => {
  const builder=createResourceGraphBuilder()
  const result=builder.addArchitecture({type:'stairs',id:'hq-stairs',width:1.8,height:3,steps:12,depth:4.2,landingDepth:1},{
    materialsByRole:{'stairs:tread':{baseColor:'#333333'},'stairs:riser':{baseColor:'#222222'}},
  })
  const graph=builder.build()
  assert.equal(result.assembly.type,'stairs')
  assert.ok(result.instances.length >= 25)
  assert.ok(graph.list('geometry').length < result.instances.length)
  assert.ok(graph.list('instance').every(node=>node.instanceId.startsWith('architecture/hq-stairs/')))
  assert.ok(graph.list('material').length >= 2)
})

 test('S9 linear arrays reuse one geometry resource instead of baking repeated meshes', () => {
  const builder=createResourceGraphBuilder()
  const ids=builder.addGeometryArray({source:{kind:'roundedBox',size:[.1,1,.1],radius:.01},count:20,offset:[.5,0,0]},{idPrefix:'fence/posts'})
  const graph=builder.build()
  assert.equal(ids.length,20)
  assert.equal(graph.list('geometry').length,1)
  assert.equal(graph.list('instance').length,20)
  assert.equal(new Set(graph.list('instance').map(node=>node.source)).size,1)
})

 test('S9 path arrays reuse one source geometry and retain deterministic placement metadata', () => {
  const builder=createResourceGraphBuilder()
  const ids=builder.addPathArray(
    {kind:'cylinder',radius:.04,height:1,segments:12},
    {path:{kind:'line',points:[[0,0,0],[4,0,0]],segments:4},spacing:1},
    {idPrefix:'rail/posts'},
  )
  const graph=builder.build()
  assert.equal(ids.length,5)
  assert.equal(graph.list('geometry').length,1)
  assert.deepEqual(graph.list('instance').map(node=>node.metadata.pathDistance),[0,1,2,3,4])
  assert.ok(graph.list('instance').every(node=>node.frame?.tangent && node.frame?.normal && node.frame?.binormal))
})

 test('S9 graph snapshots and graph identity are deterministic across insertion order', () => {
  const make=(reverse=false)=>{
    const builder=createResourceGraphBuilder()
    const entries=reverse ? [{kind:'sphere',radius:1},{kind:'box'}] : [{kind:'box'},{kind:'sphere',radius:1}]
    for(const definition of entries) builder.addGeometry(definition)
    return builder.build()
  }
  const a=make(false), b=make(true)
  assert.equal(a.key,b.key)
  assert.deepEqual(a.snapshot().topologicalOrder,b.snapshot().topologicalOrder)
  assert.deepEqual(a.snapshot().edges,b.snapshot().edges)
})

 test('S9 resource safety limits bound AI-authored graph growth', () => {
  const builder=createResourceGraphBuilder({limits:{maxResources:3,maxInstances:2,maxEdges:4}})
  const source=builder.addGeometry({kind:'box'})
  builder.addInstance({id:'a',source})
  builder.addInstance({id:'b',source})
  assert.throws(()=>builder.addInstance({id:'c',source}),error=>issue(error,'RESOURCE_LIMIT'))
})


test('S13 semantic material bindings are explicit instance dependencies and content identity', () => {
  const builder = createResourceGraphBuilder()
  const source = builder.addGeometry({ kind: 'box' })
  const base = builder.addMaterial({ baseColor: '#222222' })
  const front = builder.addMaterial({ baseColor: '#ff0000' })
  const instance = builder.addInstance({ id: 'panel', source, materials: [base], materialBindings: { front } })
  const graph = builder.build()
  const node = graph.get(instance)
  assert.deepEqual(node.materialBindings, { front })
  assert.ok(node.dependencies.includes(front))
  assert.ok(node.dependencies.includes(base))

  const changed = createResourceGraphBuilder()
  const source2 = changed.addGeometry({ kind: 'box' })
  const base2 = changed.addMaterial({ baseColor: '#222222' })
  const front2 = changed.addMaterial({ baseColor: '#00ff00' })
  const changedInstance = changed.addInstance({ id: 'panel', source: source2, materials: [base2], materialBindings: { front: front2 } })
  assert.notEqual(graph.get(instance).key, changed.build().get(changedInstance).key)
})
