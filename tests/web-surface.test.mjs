import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../dist/esm/core/index.js'
import { buildingPlugin } from '../dist/esm/building/index.js'
import { entitiesPlugin } from '../dist/esm/entities/index.js'
import { inspectWorldDocument, normalizeWorldDocument } from '../dist/esm/schema/index.js'
import { compileBuilding } from '../dist/esm/building/index.js'
import { compileEntities } from '../dist/esm/entities/index.js'
import { createWebSurfaceAppRegistry, getWebSurfaceHostSlot, projectWebSurface, resolveWebSurfaceTarget } from '../dist/esm/web-surface/index.js'

function output() {
  return { entities: [], primitives: [], materials: [], colliders: [], portals: [], rooms: [], triggers: [] }
}

const base = {
  version: '0.6',
  building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'room', size: [8, 8] }] }] },
}

test('web-surface app compiles to a renderer-neutral plane with trusted app metadata', () => {
  const document = normalizeWorldDocument({
    ...base,
    entities: [{
      id: 'dashboard',
      type: 'web-surface',
      size: [4, 2],
      surface: { room: 'room', wall: 'north' },
      webSurface: {
        source: { type: 'app', app: 'inventory', props: { count: 12 } },
        animations: [{ trigger: 'mount', preset: 'fade-slide-up', duration: 320 }],
      },
    }],
  })
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  const primitive = compiled.primitives.find(candidate => candidate.entityId === 'dashboard')
  assert.ok(primitive)
  assert.equal(primitive.kind, 'plane')
  assert.equal(primitive.static, false)
  assert.equal(primitive.batchKey, undefined)
  assert.equal(primitive.webSurface.source.type, 'app')
  assert.equal(primitive.webSurface.source.app, 'inventory')
  assert.deepEqual(primitive.webSurface.source.props, { count: 12 })
  assert.deepEqual(primitive.webSurface.target, { type: 'plane', size: [4, 2] })
})

test('snapshot and fallback sources compile as image primitives', () => {
  const document = normalizeWorldDocument({
    ...base,
    entities: [
      { id: 'snapshot', type: 'web-surface', size: [3, 2], webSurface: { source: { type: 'snapshot', image: '/panel.webp' } } },
      { id: 'app', type: 'web-surface', size: [3, 2], webSurface: { source: { type: 'app', app: 'panel' }, fallback: { type: 'snapshot', image: '/fallback.webp' } } },
    ],
  }, { sourceContext: { baseUrl: 'https://example.com/worlds/' } })
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  const snapshot = compiled.primitives.find(candidate => candidate.entityId === 'snapshot')
  const app = compiled.primitives.find(candidate => candidate.entityId === 'app')
  assert.equal(snapshot.kind, 'image')
  assert.equal(snapshot.src, 'https://example.com/panel.webp')
  assert.equal(app.kind, 'image')
  assert.equal(app.src, 'https://example.com/fallback.webp')
})

test('web-surface validation rejects missing apps and unsafe frame rates', () => {
  const result = inspectWorldDocument({
    ...base,
    entities: [{
      id: 'bad', type: 'web-surface', size: [2, 1],
      webSurface: { source: { type: 'app', app: '' }, framePolicy: { mode: 'continuous', maxFps: 240 } },
    }],
  })
  const codes = new Set(result.errors.map(issue => issue.code))
  assert.ok(codes.has('WEB_SURFACE_APP_REQUIRED'))
  assert.ok(codes.has('WEB_SURFACE_MAX_FPS_INVALID'))
})

test('registered web apps are host-controlled and duplicate ids are rejected', () => {
  const registry = createWebSurfaceAppRegistry()
  const app = { mount() {} }
  const unregister = registry.register('product-card', app)
  assert.equal(registry.get('product-card'), app)
  assert.throws(() => registry.register('product-card', app), /already registered/)
  unregister()
  assert.equal(registry.has('product-card'), false)
})

test('bound web-surface props update incrementally without remounting the world', async () => {
  class Camera {
    getPosition() { return [0, 1.7, 2] }
    setPosition() {}
    getRotation() { return [0, 0] }
    setRotation() {}
    getForward() { return [0, 0, -1] }
    getRight() { return [1, 0, 0] }
  }
  class Renderer {
    canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
    camera = new Camera()
    mountCount = 0
    changes = []
    mount() { this.mountCount += 1 }
    applyChanges(changes) { this.changes.push(...changes) }
    setRoomVisibility() {}
    render() {}
    resize() {}
    pick() { return null }
    dispose() {}
  }
  const renderer = new Renderer()
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin()], autoResize: false })
  await world.load({
    ...base,
    data: { stock: 12 },
    entities: [{
      id: 'inventory', type: 'web-surface', size: [4, 2],
      webSurface: { source: { type: 'app', app: 'inventory', props: { count: { $bind: 'stock' } } } },
    }],
  })
  await world.setData('stock', 11)
  assert.equal(renderer.mountCount, 1)
  const content = renderer.changes.find(change => change.type === 'primitive-content')
  assert.ok(content)
  assert.equal(content.primitive.webSurface.source.props.count, 11)
  world.dispose()
})

test('web-surface projection derives a viewport-aligned rectangle from world points', () => {
  const camera = {
    projectWorldPoint([x, y, z]) { return { x: 400 + x * 100, y: 300 - y * 100, depth: z, visible: true } },
  }
  const primitive = {
    size: [4, 2, 0.02],
    transform: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  }
  const result = projectWebSurface(camera, primitive)
  assert.ok(result)
  assert.equal(result.centerX, 400)
  assert.equal(result.centerY, 300)
  assert.equal(result.width, 400)
  assert.equal(result.height, 200)
  assert.equal(result.visible, true)
})

test('web-surface runtime mounts, updates, pauses, resumes, and disposes registered apps', async () => {
  class FakeElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase()
      this.dataset = {}
      this.style = {}
      this.children = []
      this.listeners = new Map()
      this.removed = false
    }
    setAttribute(name, value) { this[name] = String(value) }
    append(...children) { this.children.push(...children) }
    appendChild(child) { this.append(child); return child }
    replaceChildren(...children) { this.children = [...children] }
    addEventListener(name, listener) { this.listeners.set(name, listener) }
    animate() { return { cancel() {} } }
    remove() { this.removed = true }
  }
  const body = new FakeElement('body')
  const previousDocument = globalThis.document
  const previousMatchMedia = globalThis.matchMedia
  globalThis.document = { body, createElement: tag => new FakeElement(tag) }
  globalThis.matchMedia = () => ({ matches: false })
  try {
    const { WebSurfaceRuntime } = await import('../dist/esm/web-surface/index.js')
    const registry = createWebSurfaceAppRegistry()
    const calls = []
    registry.register('dashboard', {
      mount(_container, props) {
        calls.push(['mount', props.value])
        return {
          update(next) { calls.push(['update', next.value]) },
          pause() { calls.push(['pause']) },
          resume() { calls.push(['resume']) },
          dispose() { calls.push(['dispose']) },
        }
      },
    })
    const runtime = new WebSurfaceRuntime({ registry })
    const primitive = {
      id: 'entity:panel', entityId: 'panel', visible: true, size: [2, 1, 0.02],
      transform: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      webSurface: {
        source: { type: 'app', app: 'dashboard', props: { value: 1 } },
        renderMode: 'auto', framePolicy: { mode: 'on-change', maxFps: 30 }, animations: [],
        interaction: { pointer: true, keyboard: false, scroll: true },
      },
    }
    const context = {
      world: {
        xr: { state: 'idle' },
        runAction: async () => {}, selectPrimitive: async () => true,
      },
      renderer: {
        camera: { projectWorldPoint: ([x, y, z]) => ({ x: 300 + x * 100, y: 200 - y * 100, depth: z, visible: true }) },
      },
      compiled: { primitives: [primitive] },
      document: {},
    }
    await runtime.sync(context)
    runtime.update(context)
    context.compiled.primitives = [{ ...primitive, webSurface: { ...primitive.webSurface, source: { type: 'app', app: 'dashboard', props: { value: 2 } } } }]
    await runtime.sync(context)
    context.world.xr.state = 'active'
    runtime.update(context)
    runtime.dispose()
    assert.deepEqual(calls, [['mount', 1], ['resume'], ['update', 2], ['pause'], ['dispose']])
    assert.equal(body.children[0].removed, true)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousMatchMedia === undefined) delete globalThis.matchMedia
    else globalThis.matchMedia = previousMatchMedia
  }
})

class WS1FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
    this.dataset = {}
    this.style = {}
    this.children = []
    this.listeners = new Map()
    this.attributes = new Map()
    this.removed = false
    this.inert = false
    this.parent = null
    this.className = ''
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); this[name] = String(value) }
  append(...children) {
    for (const child of children) {
      child.parent = this
      this.children.push(child)
    }
  }
  appendChild(child) { this.append(child); return child }
  replaceChildren(...children) {
    for (const child of this.children) child.parent = null
    this.children = []
    this.append(...children)
  }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }
  dispatch(name) {
    for (const listener of this.listeners.get(name) ?? []) listener({ type: name, target: this })
  }
  contains(candidate) {
    if (candidate === this) return true
    return this.children.some(child => typeof child.contains === 'function' && child.contains(candidate))
  }
  animate() { return { cancel() {} } }
  blur() { this.blurred = true }
  remove() { this.removed = true; this.parent = null }
}

async function withWS1FakeDom(callback) {
  const body = new WS1FakeElement('body')
  const previousDocument = globalThis.document
  const previousMatchMedia = globalThis.matchMedia
  globalThis.document = { body, activeElement: null, createElement: tag => new WS1FakeElement(tag) }
  globalThis.matchMedia = () => ({ matches: false })
  try { return await callback(body) }
  finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousMatchMedia === undefined) delete globalThis.matchMedia
    else globalThis.matchMedia = previousMatchMedia
  }
}

function ws1Primitive(overrides = {}) {
  return {
    id: 'entity:panel',
    entityId: 'panel',
    visible: true,
    size: [2, 1, 0.02],
    transform: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    webSurface: {
      source: { type: 'app', app: 'dashboard', props: {} },
      renderMode: 'auto',
      framePolicy: { mode: 'on-change', maxFps: 30 },
      animations: [],
      interaction: { pointer: true, keyboard: false, scroll: true },
    },
    ...overrides,
  }
}

function ws1Context(primitive, { roomById = new Map(), entityById = new Map(), projectWorldPoint, xrState = 'idle', visibilityChanges } = {}) {
  return {
    world: {
      xr: { state: xrState },
      runAction: async () => {},
      selectPrimitive: async () => true,
    },
    renderer: {
      camera: {
        projectWorldPoint: projectWorldPoint ?? (([x, y, z]) => ({ x: 300 + x * 100, y: 200 - y * 100, depth: z, visible: true })),
      },
      ...(visibilityChanges ? { setPrimitiveVisibility(id, visible) { visibilityChanges.push([id, visible]) } } : {}),
    },
    compiled: { primitives: [primitive], roomById, entityById },
    document: {},
  }
}

test('web-surface projection fails closed for invalid values and incomplete visibility', () => {
  const primitive = ws1Primitive()
  assert.equal(projectWebSurface({ projectWorldPoint: () => ({ x: Number.NaN, y: 0, depth: 0, visible: true }) }, primitive), null)
  assert.equal(projectWebSurface({ projectWorldPoint: () => { throw new Error('bad projection') } }, primitive), null)

  const clipped = projectWebSurface({
    projectWorldPoint: ([x, y, z]) => ({ x: x * 100, y: y * 100, depth: z, visible: y <= 0 }),
  }, primitive)
  assert.ok(clipped)
  assert.equal(clipped.visible, false)

  const behind = projectWebSurface({
    projectWorldPoint: ([x, y, z]) => ({ x, y, depth: z, visible: false }),
  }, primitive)
  assert.ok(behind)
  assert.equal(behind.visible, false)

  const tiny = projectWebSurface({
    projectWorldPoint: ([x, y, z]) => ({ x, y, depth: z, visible: true }),
  }, { ...primitive, size: [0.01, 0.01, 0.02] })
  assert.ok(tiny)
  assert.equal(tiny.visible, false)
})



test('live DOM web surfaces suppress the renderer fallback and restore it for XR and disposal', async () => {
  await withWS1FakeDom(async () => {
    const { WebSurfaceRuntime } = await import('../dist/esm/web-surface/index.js')
    const registry = createWebSurfaceAppRegistry()
    registry.register('dashboard', { mount() { return { dispose() {} } } })
    const visibilityChanges = []
    const primitive = ws1Primitive()
    const context = ws1Context(primitive, { visibilityChanges })
    const runtime = new WebSurfaceRuntime({ registry })

    await runtime.sync(context)
    runtime.update(context)
    assert.deepEqual(visibilityChanges, [['entity:panel', false]])

    context.world.xr.state = 'active'
    runtime.update(context)
    assert.deepEqual(visibilityChanges, [['entity:panel', false], ['entity:panel', true]])

    context.world.xr.state = 'idle'
    runtime.update(context)
    assert.deepEqual(visibilityChanges, [['entity:panel', false], ['entity:panel', true], ['entity:panel', false]])

    runtime.dispose()
    assert.deepEqual(visibilityChanges, [
      ['entity:panel', false],
      ['entity:panel', true],
      ['entity:panel', false],
      ['entity:panel', true],
    ])
  })
})

test('web-surface projection keeps a reversed projected basis readable instead of rotating content by 180 degrees', () => {
  const primitive = ws1Primitive()
  const projection = projectWebSurface({
    projectWorldPoint: ([x, y, z]) => ({ x: 400 - x * 100, y: 300 - y * 100, depth: z, visible: true }),
  }, primitive)
  assert.ok(projection)
  assert.ok(Math.abs(projection.angle) <= 1e-12)
})

test('hidden-room web surfaces pause once, skip projection, and release input', async () => {
  await withWS1FakeDom(async body => {
    const { WebSurfaceRuntime } = await import('../dist/esm/web-surface/index.js')
    const registry = createWebSurfaceAppRegistry()
    const calls = []
    registry.register('dashboard', {
      mount() {
        calls.push(['mount'])
        return {
          setActive(active) { calls.push(['active', active]) },
          pause() { calls.push(['pause']) },
          resume() { calls.push(['resume']) },
          dispose() { calls.push(['dispose']) },
        }
      },
    })
    let projectionCalls = 0
    const room = { roomId: 'room-b', visible: false }
    const primitive = ws1Primitive({ roomId: room.roomId })
    const context = ws1Context(primitive, {
      roomById: new Map([[room.roomId, room]]),
      projectWorldPoint: ([x, y, z]) => {
        projectionCalls += 1
        return { x: 300 + x * 100, y: 200 - y * 100, depth: z, visible: true }
      },
    })
    const runtime = new WebSurfaceRuntime({ registry })
    await runtime.sync(context)
    runtime.update(context)
    assert.equal(projectionCalls, 0)

    const root = body.children[0]
    const element = root.children[0]
    const content = element.children[0]
    assert.equal(element.style.visibility, 'hidden')
    assert.equal(element.style.pointerEvents, 'none')
    assert.equal(element.inert, true)
    assert.equal(content.style.containerType, 'size')

    room.visible = true
    runtime.update(context)
    assert.equal(element.style.visibility, 'visible')
    assert.equal(element.style.pointerEvents, 'auto')
    assert.equal(element.inert, false)
    runtime.update(context)
    const projectedWhileVisible = projectionCalls
    assert.ok(projectedWhileVisible > 0)

    room.visible = false
    runtime.update(context)
    assert.equal(projectionCalls, projectedWhileVisible)
    runtime.update(context)
    assert.equal(projectionCalls, projectedWhileVisible)
    assert.equal(element.style.visibility, 'hidden')
    assert.equal(element.style.pointerEvents, 'none')

    runtime.dispose()
    runtime.dispose()
    assert.deepEqual(calls, [
      ['mount'],
      ['active', true],
      ['resume'],
      ['active', false],
      ['pause'],
      ['dispose'],
    ])
  })
})

test('active web surfaces deactivate and dispose exactly once', async () => {
  await withWS1FakeDom(async () => {
    const { WebSurfaceRuntime } = await import('../dist/esm/web-surface/index.js')
    const registry = createWebSurfaceAppRegistry()
    const calls = []
    registry.register('dashboard', {
      mount() {
        return {
          setActive(active) { calls.push(['active', active]) },
          pause() { calls.push(['pause']) },
          resume() { calls.push(['resume']) },
          dispose() { calls.push(['dispose']) },
        }
      },
    })
    const primitive = ws1Primitive()
    const context = ws1Context(primitive)
    const runtime = new WebSurfaceRuntime({ registry })
    await runtime.sync(context)
    runtime.update(context)
    runtime.dispose()
    runtime.dispose()
    assert.deepEqual(calls, [
      ['active', true],
      ['resume'],
      ['active', false],
      ['pause'],
      ['dispose'],
    ])
  })
})

test('snapshot and denied URL surfaces never create an input-blocking live overlay', async () => {
  await withWS1FakeDom(async body => {
    const { WebSurfaceRuntime } = await import('../dist/esm/web-surface/index.js')
    const registry = createWebSurfaceAppRegistry()
    let projectionCalls = 0
    const diagnostics = []
    const snapshot = ws1Primitive({
      webSurface: {
        ...ws1Primitive().webSurface,
        source: { type: 'snapshot', image: '/fallback.webp' },
        renderMode: 'snapshot',
      },
    })
    const snapshotContext = ws1Context(snapshot, {
      projectWorldPoint: point => {
        projectionCalls += 1
        return { x: point[0], y: point[1], depth: point[2], visible: true }
      },
    })
    const runtime = new WebSurfaceRuntime({ registry, onDiagnostic: diagnostic => diagnostics.push(diagnostic) })
    await runtime.sync(snapshotContext)
    runtime.update(snapshotContext)
    assert.equal(projectionCalls, 0)
    assert.equal(body.children[0].children[0].style.pointerEvents, 'none')
    runtime.dispose()

    const blocked = ws1Primitive({
      id: 'entity:blocked',
      entityId: 'blocked',
      webSurface: {
        ...ws1Primitive().webSurface,
        source: { type: 'url', url: 'https://blocked.example/app' },
        fallback: { type: 'snapshot', image: '/fallback.webp' },
      },
    })
    const blockedContext = ws1Context(blocked)
    const blockedRuntime = new WebSurfaceRuntime({
      registry,
      externalUrls: { allowedOrigins: ['https://allowed.example'] },
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    await blockedRuntime.sync(blockedContext)
    blockedRuntime.update(blockedContext)
    assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'WEB_SURFACE_URL_BLOCKED'))
    const blockedElement = body.children[1].children[0]
    assert.equal(blockedElement.style.visibility, 'hidden')
    assert.equal(blockedElement.style.pointerEvents, 'none')
    assert.equal(blockedElement.children[0].children.length, 0)
    blockedRuntime.dispose()
  })
})

test('allowlisted iframes follow visibility and fail back safely on browser load errors', async () => {
  await withWS1FakeDom(async body => {
    const { WebSurfaceRuntime } = await import('../dist/esm/web-surface/index.js')
    const registry = createWebSurfaceAppRegistry()
    const diagnostics = []
    const room = { roomId: 'room-a', visible: true }
    const primitive = ws1Primitive({
      roomId: room.roomId,
      webSurface: {
        ...ws1Primitive().webSurface,
        source: { type: 'url', url: 'https://allowed.example/app', title: 'Allowed app' },
        fallback: { type: 'snapshot', image: '/fallback.webp' },
      },
    })
    const context = ws1Context(primitive, { roomById: new Map([[room.roomId, room]]) })
    const runtime = new WebSurfaceRuntime({
      registry,
      externalUrls: { allowedOrigins: ['https://allowed.example'], sandbox: ['allow-forms'] },
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    await runtime.sync(context)
    runtime.update(context)
    const element = body.children[0].children[0]
    const content = element.children[0]
    const iframe = content.children[0]
    assert.equal(iframe.tagName, 'IFRAME')
    assert.equal(iframe.sandbox, 'allow-forms')
    assert.equal(element.style.pointerEvents, 'auto')

    room.visible = false
    runtime.update(context)
    assert.equal(element.style.pointerEvents, 'none')
    room.visible = true
    runtime.update(context)
    assert.equal(element.style.pointerEvents, 'auto')

    iframe.dispatch('error')
    assert.equal(element.style.visibility, 'hidden')
    assert.equal(element.style.pointerEvents, 'none')
    assert.equal(content.children.length, 0)
    assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'WEB_SURFACE_EMBED_FAILED'))
    runtime.dispose()
  })
})

test('unsafe iframe sandbox combinations remain rejected', async () => {
  await withWS1FakeDom(async () => {
    const { WebSurfaceRuntime } = await import('../dist/esm/web-surface/index.js')
    assert.throws(() => new WebSurfaceRuntime({
      registry: createWebSurfaceAppRegistry(),
      externalUrls: { allowedOrigins: ['https://allowed.example'], sandbox: ['allow-scripts', 'allow-same-origin'] },
    }), /must not combine allow-scripts with allow-same-origin/)
  })
})


test('explicit plane targets override the legacy surface size without changing transform behavior', () => {
  const document = normalizeWorldDocument({
    ...base,
    entities: [{
      id: 'panel', type: 'web-surface', size: [2, 1], position: [1, 2, 3],
      webSurface: {
        source: { type: 'snapshot', image: '/panel.webp' },
        target: { type: 'plane', size: [5, 3] },
      },
    }],
  })
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  const primitive = compiled.primitives.find(candidate => candidate.entityId === 'panel')
  assert.deepEqual(primitive.size, [5, 3, 0.02])
  assert.deepEqual(primitive.webSurface.target, { type: 'plane', size: [5, 3] })
  assert.deepEqual(primitive.transform.position, [1, 2, 3])
})

test('wall targets compile as semantic intent and reuse the current wall-plane fallback', () => {
  const document = normalizeWorldDocument({
    ...base,
    entities: [{
      id: 'wall-display', type: 'web-surface', size: [3, 2],
      webSurface: {
        source: { type: 'snapshot', image: '/wall.webp' },
        target: { type: 'wall', room: 'room', wall: 'north', offset: [1, 1.5] },
      },
    }],
  })
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  const primitive = compiled.primitives.find(candidate => candidate.entityId === 'wall-display')
  assert.equal(primitive.roomId, 'room')
  assert.deepEqual(primitive.webSurface.target, { type: 'wall', room: 'room', wall: 'north', offset: [1, 1.5] })
  assert.ok(Number.isFinite(primitive.transform.position[0]))
  assert.ok(Number.isFinite(primitive.transform.position[1]))
  assert.ok(Number.isFinite(primitive.transform.position[2]))
})

test('surface-host slots resolve local prefab targets independently for every instance', () => {
  const document = normalizeWorldDocument({
    ...base,
    prefabs: {
      monitor: {
        type: 'group',
        children: [
          {
            id: 'body', type: 'model',
            components: [{
              type: 'anyo.surface-host',
              slots: { screen: { mesh: 'DisplayPanel', materialSlot: 1, uvSet: 0 } },
            }],
          },
          {
            id: 'screen', type: 'web-surface', size: [2, 1],
            webSurface: {
              source: { type: 'snapshot', image: '/screen.webp' },
              target: { type: 'entity-slot', entity: '$parent/body', slot: 'screen' },
            },
          },
        ],
      },
    },
    entities: [
      { id: 'monitor-a', use: 'monitor', position: [-2, 0, 0] },
      { id: 'monitor-b', use: 'monitor', position: [2, 0, 0] },
    ],
  })
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  const entityById = new Map(compiled.entities.map(entity => [entity.id, entity]))
  const roomById = new Map(compiled.rooms.map(room => [room.roomId, room]))
  const a = compiled.primitives.find(candidate => candidate.entityId === 'monitor-a/screen')
  const b = compiled.primitives.find(candidate => candidate.entityId === 'monitor-b/screen')
  assert.equal(a.webSurface.target.entity, 'monitor-a/body')
  assert.equal(b.webSurface.target.entity, 'monitor-b/body')
  assert.deepEqual(getWebSurfaceHostSlot({ entityById }, 'monitor-a/body', 'screen'), {
    entityId: 'monitor-a/body', slot: 'screen', mesh: 'DisplayPanel', materialSlot: 1, uvSet: 0,
  })
  const resolved = resolveWebSurfaceTarget({ entityById, roomById }, a)
  assert.equal(resolved.resolved, true)
  assert.equal(resolved.kind, 'entity-slot')
  assert.equal(resolved.slot.mesh, 'DisplayPanel')
})

test('mesh targets stay renderer-neutral and resolve only the referenced entity', () => {
  const document = normalizeWorldDocument({
    ...base,
    entities: [
      { id: 'arcade', type: 'model' },
      {
        id: 'game', type: 'web-surface', size: [2, 1],
        webSurface: {
          source: { type: 'snapshot', image: '/game.webp' },
          target: { type: 'mesh', entity: 'arcade', mesh: 'Screen', materialSlot: 2, uvSet: 1 },
        },
      },
    ],
  })
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  const entityById = new Map(compiled.entities.map(entity => [entity.id, entity]))
  const roomById = new Map(compiled.rooms.map(room => [room.roomId, room]))
  const primitive = compiled.primitives.find(candidate => candidate.entityId === 'game')
  const resolved = resolveWebSurfaceTarget({ entityById, roomById }, primitive)
  assert.deepEqual(primitive.webSurface.target, { type: 'mesh', entity: 'arcade', mesh: 'Screen', materialSlot: 2, uvSet: 1 })
  assert.equal(resolved.resolved, true)
  assert.equal(resolved.kind, 'mesh')
  assert.equal(resolved.entity.id, 'arcade')
})

test('unresolved target references remain recoverable and emit focused compile diagnostics', () => {
  const document = normalizeWorldDocument({
    ...base,
    entities: [{
      id: 'broken-screen', type: 'web-surface', size: [2, 1],
      webSurface: {
        source: { type: 'snapshot', image: '/fallback.webp' },
        target: { type: 'entity-slot', entity: 'missing-monitor', slot: 'screen' },
      },
    }],
  })
  const compiled = output()
  const warnings = []
  compileBuilding(document, compiled)
  compileEntities(document, compiled, { warn: warning => warnings.push(warning) })
  assert.equal(compiled.primitives.length > 0, true)
  assert.equal(warnings.some(warning => warning.includes('WEB_SURFACE_TARGET_ENTITY_NOT_FOUND')), true)
})

test('target and surface-host validation rejects invalid indices and malformed sizes', () => {
  const result = inspectWorldDocument({
    ...base,
    entities: [
      {
        id: 'host', type: 'model',
        components: [{ type: 'anyo.surface-host', slots: { screen: { mesh: '', materialSlot: -1, uvSet: -1 } } }],
      },
      {
        id: 'panel', type: 'web-surface',
        webSurface: {
          source: { type: 'snapshot', image: '/panel.webp' },
          target: { type: 'plane', size: [0, 1] },
        },
      },
    ],
  })
  const codes = new Set(result.errors.map(issue => issue.code))
  assert.ok(codes.has('SURFACE_HOST_SLOT_MESH_REQUIRED'))
  assert.ok(codes.has('SURFACE_HOST_MATERIAL_SLOT_INVALID'))
  assert.ok(codes.has('SURFACE_HOST_UV_SET_INVALID'))
  assert.ok(codes.has('WEB_SURFACE_TARGET_SIZE_INVALID'))
})


test('advanced targets keep the live plane overlay and emit one recoverable fallback diagnostic', async () => {
  await withWS1FakeDom(async () => {
    const { WebSurfaceRuntime } = await import('../dist/esm/web-surface/index.js')
    const registry = createWebSurfaceAppRegistry()
    registry.register('dashboard', { mount() { return { dispose() {} } } })
    const diagnostics = []
    const primitive = ws1Primitive({
      webSurface: {
        ...ws1Primitive().webSurface,
        target: { type: 'mesh', entity: 'monitor', mesh: 'DisplayPanel', materialSlot: 1, uvSet: 0 },
      },
    })
    const entityById = new Map([['monitor', {
      id: 'monitor', authoringId: 'monitor', type: 'model', childIds: [], primitiveIds: [],
      transform: primitive.transform, sourcePath: '/entities/0', authoring: { id: 'monitor', sourcePath: '/entities/0', editable: true },
    }]])
    const context = ws1Context(primitive, { entityById })
    const runtime = new WebSurfaceRuntime({ registry, onDiagnostic: diagnostic => diagnostics.push(diagnostic) })
    await runtime.sync(context)
    runtime.update(context)
    runtime.update(context)
    assert.equal(diagnostics.filter(diagnostic => diagnostic.code === 'WEB_SURFACE_TARGET_OVERLAY_FALLBACK').length, 1)
    runtime.dispose()
  })
})

test('advanced texture presentation remains optional JSON-safe compiled intent', () => {
  const document = normalizeWorldDocument({
    ...base,
    entities: [{
      id: 'curved-display', type: 'web-surface', size: [3, 1.5],
      webSurface: {
        source: { type: 'app', app: 'dashboard' },
        target: { type: 'mesh', entity: 'monitor', mesh: 'CurvedPanel', materialSlot: 0, uvSet: 1 },
        presentation: {
          type: 'texture', resolution: [640, 360], fit: 'contain', side: 'double', transparent: true, opacity: 0.85,
          transform: { offset: [0.05, -0.1], scale: [1.1, 0.9], rotation: 4 },
          emissive: { color: '#66ccff', intensity: 2.5, useTexture: true },
          glass: { mesh: 'ScreenGlass', materialSlot: 0, opacity: 0.2 },
        },
      },
    }],
  })
  const compiled = output()
  compileBuilding(document, compiled)
  compileEntities(document, compiled)
  const surface = compiled.primitives.find(candidate => candidate.entityId === 'curved-display')
  assert.deepEqual(surface.webSurface.presentation, document.entities[0].webSurface.presentation)
  assert.equal(JSON.stringify(surface.webSurface.presentation).includes('CurvedPanel'), false)
})

test('texture presentation validation rejects unsafe dimensions and material values', () => {
  const result = inspectWorldDocument({
    ...base,
    entities: [{
      id: 'bad-presentation', type: 'web-surface',
      webSurface: {
        source: { type: 'snapshot', image: '/fallback.webp' },
        presentation: {
          type: 'texture', resolution: [0, 360],
          transform: { offset: [Number.NaN, 0], scale: [-1, 1], rotation: Number.POSITIVE_INFINITY },
          emissive: { intensity: 101 }, opacity: -1,
          glass: { mesh: '', materialSlot: -1, opacity: 2 },
        },
      },
    }],
  })
  const codes = new Set(result.errors.map(issue => issue.code))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_RESOLUTION_INVALID'))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_OFFSET_INVALID'))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_SCALE_INVALID'))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_ROTATION_INVALID'))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_EMISSIVE_INVALID'))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_OPACITY_INVALID'))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_GLASS_MESH_REQUIRED'))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_GLASS_SLOT_INVALID'))
  assert.ok(codes.has('WEB_SURFACE_PRESENTATION_GLASS_OPACITY_INVALID'))
})
