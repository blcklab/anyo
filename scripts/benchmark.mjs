import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createWorld } from '../dist/esm/core/index.js'
import { buildingPlugin } from '../dist/esm/building/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { createEditorSession } from '../dist/esm/editor/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

class Camera {
  position = [0, 1.65, 0]
  rotation = [0, 0]
  getPosition() { return [...this.position] }
  setPosition(value) { this.position = [...value] }
  getRotation() { return [...this.rotation] }
  setRotation(yaw, pitch) { this.rotation = [yaw, pitch] }
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class BenchmarkRenderer {
  canvas = { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }
  camera = new Camera()
  mountCalls = 0
  incrementalCalls = 0
  changeCount = 0
  roomVisibilityCalls = 0
  runtimeTransformCalls = 0
  runtimeTransformCount = 0
  async mount() { this.mountCalls += 1 }
  async applyChanges(changes) { this.incrementalCalls += 1; this.changeCount += changes.length }
  applyRuntimeTransforms(updates) { this.runtimeTransformCalls += 1; this.runtimeTransformCount += updates.length }
  setRoomVisibility() { this.roomVisibilityCalls += 1 }
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

function rooms(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `room-${index}`,
    position: [(index % 10) * 9, Math.floor(index / 10) * 9],
    size: [8, 8],
  }))
}

function boxes(count, roomCount = 20) {
  return Array.from({ length: count }, (_, index) => ({
    id: `box-${index}`,
    type: 'box',
    room: `room-${index % roomCount}`,
    position: [(index % 20) * 0.25 - 2.5, 0.5, Math.floor(index / 20) * 0.02 - 2],
    size: [0.2, 1, 0.2],
    material: `material-${index % 10}`,
    visible: true,
  }))
}

function makeDocument({ roomCount = 20, entityCount = 0, binding = false } = {}) {
  return {
    version: '0.6',
    data: { label: 'Before' },
    materials: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`material-${index}`, { color: `hsl(${index * 36} 45% 65%)`, roughness: 0.75 }])),
    building: { floors: [{ id: 'ground', elevation: 0, rooms: rooms(roomCount) }] },
    entities: [
      ...boxes(entityCount, roomCount),
      ...(binding ? [{ id: 'bound-label', type: 'text', room: 'room-0', position: [0, 2, 0], content: { $bind: 'label' }, size: [3, 0.8] }] : []),
    ],
  }
}

async function measure(label, operation) {
  global.gc?.()
  const heapBefore = process.memoryUsage().heapUsed
  const start = performance.now()
  const value = await operation()
  const durationMs = performance.now() - start
  const heapAfter = process.memoryUsage().heapUsed
  return { label, durationMs, heapDeltaBytes: heapAfter - heapBefore, value }
}

async function createBenchmarkWorld(document, options = {}) {
  const renderer = new BenchmarkRenderer()
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false, historyLimit: 500, ...options })
  await world.load(document)
  return { world, renderer }
}

const results = []
for (const [label, document] of [
  ['100 rooms', makeDocument({ roomCount: 100 })],
  ['1,000 primitives', makeDocument({ roomCount: 20, entityCount: 1000 })],
  ['10,000 primitives', makeDocument({ roomCount: 20, entityCount: 10000 })],
]) {
  const result = await measure(`Initial load: ${label}`, async () => {
    const { world, renderer } = await createBenchmarkWorld(document)
    const value = { primitives: world.compiled.primitives.length, rendererMounts: renderer.mountCalls }
    world.dispose()
    return value
  })
  results.push(result)
}

{
  const { world, renderer } = await createBenchmarkWorld(makeDocument({ roomCount: 20, entityCount: 10000 }))
  results.push(await measure('10,000 transient transform writes + one renderer batch', async () => {
    const beforeCalls = renderer.runtimeTransformCalls
    const beforeCount = renderer.runtimeTransformCount
    for (let index = 0; index < 10000; index += 1) {
      world.transforms.set(`box-${index}`, { position: [index * 0.001, 0.5, 0] }, { source: 'benchmark:physics' })
    }
    const flushed = await world.flushRuntimeTransforms()
    const value = {
      flushed,
      rendererBatches: renderer.runtimeTransformCalls - beforeCalls,
      rendererUpdates: renderer.runtimeTransformCount - beforeCount,
    }
    world.dispose()
    return value
  }))
}

{
  let animated = []
  const animationSystem = {
    name: 'benchmark:animation-system',
    setup(context) { animated = context.query.entities().filter((entity) => entity.id.startsWith('box-')) },
    update(_delta, context) {
      const offset = Math.sin(context.frame.frame / 10) * 0.05
      for (const entity of animated) {
        context.setTransform(entity.id, { position: [0, offset, 0] }, { mode: 'additive', space: 'local' })
      }
    },
  }
  const { world, renderer } = await createBenchmarkWorld(
    makeDocument({ roomCount: 20, entityCount: 1000 }),
    { systems: [animationSystem] },
  )
  results.push(await measure('60 system frames over 1,000 animated entities', async () => {
    const beforeCalls = renderer.runtimeTransformCalls
    const beforeCount = renderer.runtimeTransformCount
    for (let frame = 0; frame < 60; frame += 1) world.tick(1 / 60)
    const value = {
      frames: 60,
      entities: animated.length,
      rendererBatches: renderer.runtimeTransformCalls - beforeCalls,
      rendererUpdates: renderer.runtimeTransformCount - beforeCount,
    }
    world.dispose()
    return value
  }))
}

{
  const { world, renderer } = await createBenchmarkWorld(makeDocument({ roomCount: 20, entityCount: 1000, binding: true }))
  results.push(await measure('Bound text data update', async () => {
    const before = renderer.changeCount
    await world.setData('label', 'After')
    return { rendererChanges: renderer.changeCount - before, rendererMounts: renderer.mountCalls }
  }))
  results.push(await measure('Single transform update', async () => {
    const before = renderer.changeCount
    await world.updateEntity('box-10', { position: [1, 0.5, 1] })
    return { rendererChanges: renderer.changeCount - before, rendererMounts: renderer.mountCalls }
  }))
  results.push(await measure('Room visibility update', async () => {
    const before = renderer.roomVisibilityCalls
    world.setRoomVisibility('room-0', false)
    return { rendererCalls: renderer.roomVisibilityCalls - before }
  }))
  results.push(await measure('Structural room update', async () => {
    const before = renderer.mountCalls
    await world.transaction((document) => { document.building.floors[0].rooms[0].size = [9, 8] }, 'Resize room')
    return { rendererMounts: renderer.mountCalls - before }
  }))
  results.push(await measure('100 atomic patches with history', async () => {
    for (let index = 0; index < 100; index += 1) {
      await world.patch({ operation: 'replace', path: '/entities/0/visible', value: index % 2 === 0 }, `Patch ${index}`)
    }
    return { canUndo: world.canUndo, historyLimit: 500 }
  }))
  results.push(await measure('30 transform preview updates + one commit', async () => {
    const editor = createEditorSession(world)
    editor.beginTransformPreview('box-20', 'Drag box')
    for (let index = 0; index < 30; index += 1) {
      await editor.updateTransformPreview('box-20', { position: [index * 0.05, 0.5, 1] })
    }
    await editor.commitTransformPreview()
    const last = world.getHistory().undo.at(-1)
    return { historyEntriesAdded: 1, operationCount: last?.operationCount ?? 0 }
  }))
  results.push(await measure('1,000 transient transform writes + one renderer batch', async () => {
    const beforeCalls = renderer.runtimeTransformCalls
    const beforeCount = renderer.runtimeTransformCount
    for (let index = 0; index < 1000; index += 1) {
      world.transforms.set(`box-${index}`, { position: [index * 0.001, 0.5, 0] }, { source: 'benchmark:animation' })
    }
    const flushed = await world.flushRuntimeTransforms()
    return {
      flushed,
      rendererBatches: renderer.runtimeTransformCalls - beforeCalls,
      rendererUpdates: renderer.runtimeTransformCount - beforeCount,
    }
  }))
  results.push(await measure('World disposal', async () => { world.dispose(); return { disposed: true } }))
}

function formatMs(value) { return value.toFixed(3) }
function formatBytes(value) {
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  if (absolute < 1024) return `${value} B`
  if (absolute < 1024 ** 2) return `${sign}${(absolute / 1024).toFixed(1)} KiB`
  return `${sign}${(absolute / 1024 ** 2).toFixed(2)} MiB`
}

const lines = [
  '# Anyo 0.9.0-rc.3 Benchmark Report',
  '',
  'These measurements were produced in one Node.js process with a renderer-contract mock. They measure Anyo validation, normalization, compilation, runtime-system scheduling, transient-transform resolution, renderer-contract batching, history, and lifecycle overhead—not physical GPU rendering performance.',
  '',
  `- Node: ${process.version}`,
  `- Platform: ${process.platform} ${process.arch}`,
  `- CPU: ${os.cpus()[0]?.model ?? 'unknown'}`,
  `- Logical CPUs: ${os.cpus().length}`,
  '',
  '| Scenario | Duration | Heap delta | Details |',
  '|---|---:|---:|---|',
  ...results.map((result) => `| ${result.label} | ${formatMs(result.durationMs)} ms | ${formatBytes(result.heapDeltaBytes)} | ${JSON.stringify(result.value)} |`),
  '',
  '## Interpretation',
  '',
  '- Results vary by hardware, Node version, garbage collection, document shape, renderer, and asset complexity.',
  '- Transient-transform scenarios use the synchronous renderer hot path and include runtime-layer resolution plus batch construction, but not real GPU submission.',
  '- The Sekai64 integration tests separately verify shared unit geometry, instancing, picking, incremental updates, and disposal using its public 0.7.0-rc.4 APIs, including the renderer-neutral XR bridge and WebGL2 XR frame path.',
  '- Browser WebGPU/WebGL2 draw time and physical-headset WebXR performance must be measured in the target deployment environment.',
  '',
]

await writeFile(path.join(root, 'docs/reports/BENCHMARK_REPORT.md'), `${lines.join('\n')}\n`)
await writeFile(path.join(root, 'benchmark-results.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, results }, null, 2)}\n`)
console.log(lines.join('\n'))
