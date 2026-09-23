import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GeometryValidationError,
  compileGeometry,
  computeCurveFrames,
  createGeometryCompiler,
  layoutPathArray,
  normalizeCurve,
  sampleCurve,
} from '../dist/esm/geometry/index.js'

const LIMITS = {
  maxGeometryVertices: 500_000,
  maxGeometryIndices: 1_500_000,
  maxCurveSegments: 4_096,
  maxProfilePoints: 16_384,
  maxModifierDepth: 32,
  maxBooleanDepth: 12,
  maxGeneratedInstances: 100_000,
  maxDefinitionDepth: 64,
  maxDefinitionNodes: 100_000,
}

function healthy(mesh) {
  assert.ok(mesh.positions instanceof Float32Array)
  assert.ok(mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array)
  assert.equal(mesh.positions.length % 3, 0)
  assert.equal(mesh.indices.length % 3, 0)
  const vertices = mesh.positions.length / 3
  for (const value of mesh.positions) assert.ok(Number.isFinite(value))
  for (const index of mesh.indices) assert.ok(index < vertices)
  assert.equal(mesh.normals?.length, mesh.positions.length)
  assert.equal(mesh.uvs?.length, vertices * 2)
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset] * 3, b = mesh.indices[offset + 1] * 3, c = mesh.indices[offset + 2] * 3
    const ab = [mesh.positions[b]-mesh.positions[a], mesh.positions[b+1]-mesh.positions[a+1], mesh.positions[b+2]-mesh.positions[a+2]]
    const ac = [mesh.positions[c]-mesh.positions[a], mesh.positions[c+1]-mesh.positions[a+1], mesh.positions[c+2]-mesh.positions[a+2]]
    const cross = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]]
    assert.ok(Math.hypot(...cross) > 1e-9, `triangle ${offset / 3} is degenerate`)
  }
}
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2] }
function len(v){ return Math.hypot(...v) }
function near(a,b,eps=1e-6){ return Math.abs(a-b)<=eps }
function group(mesh,name){ return mesh.groups.find(entry=>entry.name===name) }

 test('S5 line and bezier curves sample deterministically with exact endpoints', () => {
  const line = sampleCurve({ kind:'line', points:[[0,0,0],[0,0,5]] }, { limits: LIMITS })
  assert.equal(line.points.length, 2)
  assert.deepEqual(line.points[0], [0,0,0])
  assert.deepEqual(line.points.at(-1), [0,0,5])
  assert.ok(near(line.totalLength,5))

  const cubic = { kind:'cubicBezier', points:[[0,0,0],[2,0,1],[3,1,4],[5,0,6]], segments:24 }
  const a = sampleCurve(cubic, { limits: LIMITS }), b = sampleCurve(cubic, { limits: LIMITS })
  assert.deepEqual(a.points,b.points)
  assert.deepEqual(a.tangents,b.tangents)
  assert.deepEqual(a.distances,b.distances)
  assert.equal(a.points.length,25)
  assert.deepEqual(a.points[0],[0,0,0])
  assert.deepEqual(a.points.at(-1),[5,0,6])
})

 test('S5 polyline normalization preserves every authored corner', () => {
  const normalized = normalizeCurve({ kind:'polyline', points:[[0,0,0],[2,0,0],[2,0,3]], segments:4 }, { limits: LIMITS })
  const sampled = sampleCurve(normalized, { limits: LIMITS })
  assert.deepEqual(sampled.points[2],[2,0,0])
  assert.throws(
    () => normalizeCurve({ kind:'polyline', points:[[0,0,0],[2,0,0],[2,0,3]], segments:3 }, { limits: LIMITS }),
    error => error instanceof GeometryValidationError && error.issues[0].code === 'CURVE_INVALID',
  )
})

 test('S5 catmullRom supports open and closed deterministic paths', () => {
  const open = sampleCurve({ kind:'catmullRom', points:[[0,0,0],[2,1,1],[4,0,4],[7,2,6]], segments:32 }, { limits: LIMITS })
  assert.equal(open.points.length,33)
  assert.deepEqual(open.points[0],[0,0,0])
  assert.deepEqual(open.points.at(-1),[7,2,6])
  for (const tangent of open.tangents) assert.ok(near(len(tangent),1,1e-5))

  const closed = sampleCurve({ kind:'catmullRom', points:[[0,0,0],[4,0,0],[4,0,4],[0,0,4]], closed:true, segments:64 }, { limits: LIMITS })
  assert.deepEqual(closed.points[0],closed.points.at(-1))
  assert.deepEqual(closed.tangents[0],closed.tangents.at(-1))
})

 test('S5 parallel-transport frames stay orthonormal on vertical and curved paths', () => {
  const sampled = sampleCurve({ kind:'cubicBezier', points:[[0,0,0],[0,4,0],[3,8,2],[6,10,5]], segments:64 }, { limits: LIMITS })
  const frames = computeCurveFrames(sampled,[0,1,0])
  for (const frame of frames) {
    assert.ok(near(len(frame.tangent),1,1e-5))
    assert.ok(near(len(frame.normal),1,1e-5))
    assert.ok(near(len(frame.binormal),1,1e-5))
    assert.ok(Math.abs(dot(frame.tangent,frame.normal)) < 1e-5)
    assert.ok(Math.abs(dot(frame.tangent,frame.binormal)) < 1e-5)
    assert.ok(Math.abs(dot(frame.normal,frame.binormal)) < 1e-5)
  }
  for (let i=1;i<frames.length;i++) assert.ok(dot(frames[i-1].normal,frames[i].normal) > -0.25, `unexpected frame flip at ${i}`)
})

 test('S5 closed curve frame seam returns to the starting orientation', () => {
  const sampled = sampleCurve({ kind:'catmullRom', points:[[3,0,0],[0,1,3],[-3,0,0],[0,-1,-3]], closed:true, segments:96 }, { limits: LIMITS })
  const frames = computeCurveFrames(sampled,[0,1,0])
  assert.ok(dot(frames[0].normal,frames.at(-1).normal) > 0.9999)
  assert.ok(dot(frames[0].binormal,frames.at(-1).binormal) > 0.9999)
})

 test('S5 straight sweep produces capped geometry with expected regions and bounds', () => {
  const mesh = compileGeometry({
    kind:'sweep',
    profile:{ points:[[-1,-.5],[1,-.5],[1,.5],[-1,.5]] },
    path:{ kind:'line', points:[[0,0,0],[0,0,5]] },
    cap:true,
    up:[0,1,0],
  })
  healthy(mesh)
  assert.deepEqual(mesh.groups.map(entry=>entry.name),['startCap','endCap','outerSide'])
  assert.deepEqual(mesh.bounds.min,[-1,-.5,0])
  assert.deepEqual(mesh.bounds.max,[1,.5,5])
})

 test('S5 sweep supports holes and S3 tangent generation', () => {
  const mesh = compileGeometry({
    kind:'sweep',
    profile:{ points:[[-1,-1],[1,-1],[1,1],[-1,1]], holes:[[[-.4,-.4],[-.4,.4],[.4,.4],[.4,-.4]]] },
    path:{ kind:'quadraticBezier', points:[[0,0,0],[2,1,3],[5,0,6]], segments:32 },
    cap:true,
    uv:{ mode:'generated', metersPerTile:1 },
    tangents:true,
  })
  healthy(mesh)
  assert.ok(group(mesh,'holeSide:0'))
  assert.ok(mesh.tangents instanceof Float32Array)
  assert.equal(mesh.tangents.length,(mesh.positions.length/3)*4)
})

 test('S5 generated sweep UVs use profile perimeter and path distance in meters', () => {
  const mesh = compileGeometry({
    kind:'sweep', profile:{ points:[[0,0],[2,0],[2,1],[0,1]] },
    path:{ kind:'line', points:[[0,0,0],[0,0,6]], segments:3 },
    cap:false, uv:{ mode:'generated', metersPerTile:2 },
  })
  healthy(mesh)
  const vs=[]; for(let i=1;i<mesh.uvs.length;i+=2) vs.push(mesh.uvs[i])
  assert.ok(Math.max(...vs) >= 3 - 1e-6)
})

 test('S5 closed sweep has no caps and remains finite across the seam', () => {
  const profile=[]; for(let i=0;i<8;i++){ const a=i*Math.PI*2/8; profile.push([Math.cos(a)*.2,Math.sin(a)*.2]) }
  const mesh = compileGeometry({
    kind:'sweep', profile:{ points:profile },
    path:{ kind:'catmullRom', points:[[3,0,0],[0,0,3],[-3,0,0],[0,0,-3]], closed:true, segments:64 },
    cap:false,
  })
  healthy(mesh)
  assert.deepEqual(mesh.groups.map(entry=>entry.name),['outerSide'])
})

 test('S5 sweep quality resolves nested path segments before hashing', () => {
  const compiler=createGeometryCompiler()
  const base={ kind:'sweep', profile:{points:[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]]}, path:{kind:'cubicBezier',points:[[0,0,0],[1,0,1],[2,0,2],[3,0,3]]} }
  const a={...base,quality:'high'}
  const b={...base,path:{...base.path,segments:32}}
  assert.equal(compiler.keyFor(a),compiler.keyFor(b))
})

 test('S5 path arrays produce deterministic evenly spaced placements without baking geometry', () => {
  const layout=layoutPathArray({ path:{kind:'line',points:[[0,0,0],[0,0,10]]}, spacing:2.5, includeEnd:true })
  assert.equal(layout.placements.length,5)
  assert.deepEqual(layout.placements.map(item=>item.distance),[0,2.5,5,7.5,10])
  assert.deepEqual(layout.placements.map(item=>item.position[2]),[0,2.5,5,7.5,10])
  for(const placement of layout.placements){
    assert.ok(placement.tangent && placement.normal && placement.binormal)
    assert.ok(near(dot(placement.tangent,placement.normal),0,1e-5))
  }
})

 test('S5 path arrays can omit orientation frames', () => {
  const layout=layoutPathArray({ path:{kind:'line',points:[[0,0,0],[5,0,0]]}, spacing:2, alignToPath:false })
  assert.equal(layout.placements.length,3)
  assert.equal(layout.placements[0].tangent,undefined)
})

 test('S5 closed path arrays wrap offsets around the whole loop without duplicating the seam', () => {
  const layout=layoutPathArray({
    path:{kind:'polyline',points:[[0,0,0],[4,0,0],[4,0,4],[0,0,4]],closed:true,segments:4},
    spacing:4, offset:2,
  })
  assert.equal(layout.placements.length,4)
  assert.equal(new Set(layout.placements.map(item=>item.distance.toFixed(6))).size,4)
})

 test('S5 curve/path-array safety limits return structured errors', () => {
  assert.throws(
    () => normalizeCurve({kind:'cubicBezier',points:[[0,0,0],[1,0,0],[2,0,0],[3,0,0]],segments:5000},{limits:LIMITS}),
    error=>error instanceof GeometryValidationError && error.issues[0].code==='CURVE_INVALID',
  )
  assert.throws(
    () => layoutPathArray({path:{kind:'line',points:[[0,0,0],[0,0,100]]},spacing:.01},{limits:{maxGeneratedInstances:100}}),
    error=>error instanceof GeometryValidationError && error.issues[0].code==='PATH_ARRAY_LIMIT',
  )
})
