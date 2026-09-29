import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Scene, Mesh } from '@blcklab/sekai64'
import { compileGeometry, createGeometryCompiler, GeometryValidationError } from '../dist/esm/geometry/index.js'
import { inspectWorldDocument } from '../dist/esm/schema/index.js'
import { createResourceGraphBuilder } from '../dist/esm/resources/index.js'
import { createSekai64ResourceAdapter } from '../dist/esm/renderer-sekai64/index.js'

const schema = JSON.parse(readFileSync(new URL('../schemas/world-0.9.schema.json', import.meta.url), 'utf8'))

function approx(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
}

function channelRange(mesh, channel = 0) {
  const values = []
  for (let i = channel; i < mesh.colors.length; i += 4) values.push(mesh.colors[i])
  return [Math.min(...values), Math.max(...values)]
}

function colorAt(mesh, index) {
  const offset = index * 4
  return Array.from(mesh.colors.slice(offset, offset + 4))
}

function assertConstantColor(mesh, expected) {
  assert.ok(mesh.colors)
  for (let index = 0; index < mesh.positions.length / 3; index += 1) {
    const actual = colorAt(mesh, index)
    actual.forEach((value, channel) => approx(value, expected[channel], 1e-5))
  }
}

function compile(definition) {
  return compileGeometry(definition, { cache: false })
}

test('Q2 World 0.9 schema exposes strict constant, gradient, and noise vertex-color authoring on all built-in geometry kinds', () => {
  const vertexColor = schema.$defs.geometryVertexColor
  assert.equal(vertexColor.oneOf.length, 3)
  assert.deepEqual(vertexColor.oneOf.map((entry) => entry.$ref), [
    '#/$defs/geometryVertexColorConstant',
    '#/$defs/geometryVertexColorGradient',
    '#/$defs/geometryVertexColorNoise',
  ])
  for (const entry of schema.$defs.geometryDefinition.oneOf) {
    const name = entry.$ref.slice('#/$defs/'.length)
    assert.deepEqual(schema.$defs[name].properties.vertexColor, { $ref: '#/$defs/geometryVertexColor' }, name)
  }
  assert.equal(schema.$defs.geometryVertexColorConstant.additionalProperties, false)
  assert.equal(schema.$defs.geometryVertexColorGradient.additionalProperties, false)
  assert.equal(schema.$defs.geometryVertexColorNoise.additionalProperties, false)
})

test('Q2 constant authoring generates linear RGBA values from authored hexadecimal sRGB colors', () => {
  const mesh = compile({ kind: 'box', vertexColor: { mode: 'constant', color: '#80808080' } })
  approx(mesh.colors[0], 0.2158605, 1e-6)
  approx(mesh.colors[1], 0.2158605, 1e-6)
  approx(mesh.colors[2], 0.2158605, 1e-6)
  approx(mesh.colors[3], 128 / 255, 1e-6)
  assertConstantColor(mesh, [0.2158605, 0.2158605, 0.2158605, 128 / 255])
})

test('Q2 gradients normalize independently against local x, y, and z geometry bounds', () => {
  for (const [axis, component] of [['x', 0], ['y', 1], ['z', 2]]) {
    const mesh = compile({ kind: 'box', size: [2, 4, 6], vertexColor: { mode: 'gradient', axis, stops: [[0, '#000'], [1, '#fff']] } })
    const [min, max] = channelRange(mesh)
    approx(min, 0)
    approx(max, 1)
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
      const p = mesh.positions[vertex * 3 + component]
      const expected = axis === 'x' ? (p + 1) / 2 : axis === 'y' ? (p + 2) / 4 : (p + 3) / 6
      approx(mesh.colors[vertex * 4], expected, 1e-6)
    }
  }
})

test('Q2 gradient supports multiple strictly ordered stops and semantic validation rejects malformed policies', () => {
  const mesh = compile({
    kind: 'sphere', radius: 1, segments: 12, rings: 6,
    vertexColor: { mode: 'gradient', axis: 'y', stops: [[0, '#ff0000'], [0.5, '#00ff00'], [1, '#0000ff']] },
  })
  let closest = 0
  let distance = Infinity
  for (let i = 0; i < mesh.positions.length / 3; i += 1) {
    const d = Math.abs(mesh.positions[i * 3 + 1])
    if (d < distance) { distance = d; closest = i }
  }
  const mid = colorAt(mesh, closest)
  assert.ok(mid[1] > 0.95 && mid[0] < 0.05 && mid[2] < 0.05, mid)

  const invalid = [
    { kind: 'box', vertexColor: { mode: 'constant', color: 'red' } },
    { kind: 'box', vertexColor: { mode: 'gradient', axis: 'w', stops: [[0, '#000'], [1, '#fff']] } },
    { kind: 'box', vertexColor: { mode: 'gradient', axis: 'y', stops: [[0.8, '#000'], [0.2, '#fff']] } },
    { kind: 'box', vertexColor: { mode: 'noise', frequency: 0, colors: ['#000', '#fff'] } },
    { kind: 'box', vertexColor: { mode: 'noise', strength: 1.1, colors: ['#000', '#fff'] } },
  ]
  for (const definition of invalid) assert.throws(() => createGeometryCompiler({ cache: false }).normalize(definition), GeometryValidationError)

  const world = inspectWorldDocument({ version: '0.9', geometries: { bad: invalid[2] } }, { mode: 'generator' })
  assert.equal(world.valid, false)
  assert.equal(world.errors.some((entry) => entry.path.startsWith('/geometries/bad/vertexColor')), true)
})

test('Q2 noise colors are deterministic by seed and vary for different seeds without global randomness', () => {
  const base = { kind: 'sphere', radius: 1, segments: 20, rings: 10, vertexColor: { mode: 'noise', seed: 12345, frequency: 2.25, strength: 0.7, colors: ['#24351f', '#91b36c'] } }
  const a = compile(base)
  const b = compile(structuredClone(base))
  assert.deepEqual(Array.from(a.colors), Array.from(b.colors))
  const c = compile({ ...base, vertexColor: { ...base.vertexColor, seed: 12346 } })
  assert.notDeepEqual(Array.from(a.colors), Array.from(c.colors))
})

test('Q2 vertex-color channels survive bend, taper, noise deformation, transform, and CSG when authored on sources', () => {
  const colored = { kind: 'box', size: [1, 2, 1], vertexColor: { mode: 'constant', color: '#ff0000' } }
  const definitions = [
    { kind: 'bend', source: colored, axis: 'y', direction: 'x', angle: 0.35 },
    { kind: 'taper', source: colored, axis: 'y', startScale: 0.7, endScale: 1.2 },
    { kind: 'noise', source: colored, seed: 7, strength: 0.05, frequency: 2 },
    { kind: 'transform', source: colored, position: [4, 2, -3], rotation: [0.1, 0.2, 0.3], scale: [2, 1, 0.5] },
    { kind: 'union', left: colored, right: { kind: 'transform', source: colored, position: [0.25, 0, 0] } },
  ]
  for (const definition of definitions) {
    const mesh = compile(definition)
    assert.ok(mesh.colors, definition.kind)
    assert.equal(mesh.colors.length, (mesh.positions.length / 3) * 4, definition.kind)
    assertConstantColor(mesh, [1, 0, 0, 1])
  }
})

test('Q2 outer vertexColor regenerates after a transform using the transformed local compiled bounds', () => {
  const mesh = compile({
    kind: 'transform',
    source: { kind: 'box', size: [1, 2, 1], vertexColor: { mode: 'constant', color: '#ff0000' } },
    rotation: [0, 0, Math.PI / 2],
    scale: [2, 1, 1],
    vertexColor: { mode: 'gradient', axis: 'x', stops: [[0, '#000000'], [1, '#ffffff']] },
  })
  const [min, max] = channelRange(mesh)
  approx(min, 0)
  approx(max, 1)
  assert.notEqual(mesh.colors.every?.((value) => value === 1), true)
})

test('Q2 Sekai64 resource realization preserves generated colors and upstream WebGL2/WebGPU shaders multiply material × vertexColor × texture', async () => {
  const scene = new Scene()
  const builder = createResourceGraphBuilder()
  const geometryId = builder.addGeometry({ kind: 'sphere', radius: 0.5, vertexColor: { mode: 'gradient', axis: 'y', stops: [[0, '#334422'], [1, '#99bb77']] } })
  const materialId = builder.addMaterial({ baseColor: '#808080', roughness: 0.8 })
  builder.addInstance({ id: 'colored', source: geometryId, materials: [materialId] })
  const adapter = createSekai64ResourceAdapter({ scene })
  await adapter.transition(builder.build())
  const mesh = scene.require('colored')
  assert.ok(mesh instanceof Mesh)
  assert.ok(mesh.geometry.colors)
  assert.equal(mesh.geometry.colors.length, (mesh.geometry.positions.length / 3) * 4)
  await adapter.dispose()

  const webgl = readFileSync(new URL('../node_modules/@blcklab/sekai64/dist/renderer-webgl2/WebGL2Renderer.js', import.meta.url), 'utf8')
  const webgpu = readFileSync(new URL('../node_modules/@blcklab/sekai64/dist/renderer-webgpu/WebGPURenderer.js', import.meta.url), 'utf8')
  assert.match(webgl, /srgbToLinear\(tint\.rgb\)\*v_color\.rgb\*sampled\.rgb/)
  assert.match(webgpu, /srgbToLinear\(tint\.rgb\).*color\.rgb.*sampled\.rgb|color\.rgb.*sampled\.rgb/s)
})

test('Q2 generated declarations expose the bounded vertex-color authoring contract', () => {
  const declarations = readFileSync(new URL('../dist/types/geometry/types/index.d.ts', import.meta.url), 'utf8')
  assert.match(declarations, /GeometryVertexColorConstantDefinition/)
  assert.match(declarations, /mode: 'gradient'/)
  assert.match(declarations, /axis: GeometryVertexColorAxis/)
  assert.match(declarations, /mode: 'noise'/)
  assert.match(declarations, /vertexColor\?: GeometryVertexColorDefinition/)
})
