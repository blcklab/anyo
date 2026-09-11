import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inspectWorldDocument,
  normalizeWorldDocument,
} from '../dist/esm/index.js'
import {
  Sekai64Renderer,
  toSekaiTextOptions,
} from '../dist/esm/renderer-sekai64/index.js'
import { bootstrapPortfolio } from '../examples/portfolio/main.js'
import { SEKAI64_VERSION } from '@blcklab/sekai64'

function registry(names) {
  const values = new Set(names)
  return { has: name => values.has(name) }
}

function baseDocument() {
  return {
    version: '0.6',
    units: 'meters',
    data: { store: { price: 100 } },
    materials: { white: { color: '#fff' } },
    assets: { product: { type: 'model', format: 'glb', src: './product.glb' } },
    building: {
      floors: [{
        id: 'ground',
        elevation: 0,
        rooms: [{ id: 'room', size: [8, 8] }],
      }],
    },
    entities: [],
  }
}

test('portfolio bootstrap keeps a stable renderer variable through startup', async () => {
  const message = { textContent: '' }
  const canvas = { id: 'world' }
  const documentRef = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      return selector === '#world' ? canvas : message
    },
  }
  const listeners = []
  const windowRef = { addEventListener: (...args) => listeners.push(args) }
  const calls = []
  class Renderer {
    constructor(options) {
      assert.equal(options.canvas, canvas)
      this.info = { capabilities: { backend: 'webgl2' } }
    }
  }
  const world = {
    registerAction: () => {},
    on: () => {},
    load: async input => calls.push(['load', input]),
    start: () => calls.push(['start']),
    dispose: () => calls.push(['dispose']),
  }
  const result = await bootstrapPortfolio({
    documentRef,
    windowRef,
    Renderer,
    createWorldFn: options => {
      assert.ok(options.renderer instanceof Renderer)
      return world
    },
  })
  assert.equal(result.world, world)
  assert.equal(documentRef.documentElement.dataset.anyoReady, 'webgl2')
  assert.deepEqual(calls, [['load', './world.json'], ['start']])
  assert.equal(listeners[0][0], 'beforeunload')
})

test('Sekai64 renderer reports its actual package version', () => {
  const renderer = new Sekai64Renderer({ canvas: {} })
  assert.equal(renderer.info.version, SEKAI64_VERSION)
  renderer.dispose()
})

test('Sekai64 text options convert normalized style values consistently', () => {
  const primitive = {
    id: 'heading',
    kind: 'text',
    visible: true,
    text: 'Hello\nworld',
    size: [5, 1, 0.01],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    style: {
      resolution: 512,
      fontSize: 0.22,
      padding: 0.08,
      align: 'start',
      background: 'transparent',
    },
  }
  const options = toSekaiTextOptions(primitive)
  assert.equal(options.fontSize, 113)
  assert.equal(options.padding, 41)
  assert.equal(options.width, 2560)
  assert.equal(options.height, 512)
  assert.equal(options.align, 'left')
  assert.equal(options.background, 'transparent')
  assert.equal(options.worldWidth, 5)
  assert.equal(options.worldHeight, 1)
})

test('automatic door intent no longer forces the initial door open', () => {
  const document = baseDocument()
  document.building.floors[0].rooms[0].openings = [{
    id: 'door', type: 'door', wall: 'north', width: 1, height: 2, automatic: true,
  }]
  const normalized = normalizeWorldDocument(document)
  assert.equal(normalized.building.floors[0].rooms[0].openings[0].open, false)
  const result = inspectWorldDocument(document)
  assert.ok(result.warnings.some(issue => issue.code === 'ANYO_AUTOMATIC_DOOR_SYSTEM_REQUIRED'))
})

test('generator validation rejects unresolved references, actions, apps, custom types, and unknown fields', () => {
  const document = baseDocument()
  document.unknownFeature = true
  document.entities = [{
    id: 'bad',
    type: 'project.widget',
    room: 'missing-room',
    material: 'missing-material',
    asset: 'missing-asset',
    content: { $bind: 'store.missing' },
    interaction: { action: 'missing-action' },
    components: [{ type: 'project.component' }],
    webSurface: {
      source: { type: 'app', app: 'missing-app' },
    },
    fakeBehavior: 'fly',
  }]
  const result = inspectWorldDocument(document, { mode: 'generator' })
  const codes = new Set(result.errors.map(issue => issue.code))
  for (const code of [
    'ANYO_UNKNOWN_FIELD',
    'ANYO_ENTITY_ROOM_NOT_FOUND',
    'ANYO_MATERIAL_NOT_FOUND',
    'ANYO_ASSET_NOT_FOUND',
    'ANYO_BINDING_PATH_NOT_FOUND',
    'ANYO_ACTION_NOT_REGISTERED',
    'ANYO_COMPONENT_TYPE_NOT_REGISTERED',
    'ANYO_ENTITY_TYPE_NOT_REGISTERED',
  ]) assert.ok(codes.has(code), `missing diagnostic ${code}`)
})

test('generator validation accepts registered custom behavior and resolved references', () => {
  const document = baseDocument()
  document.entities = [{
    id: 'widget',
    type: 'project.widget',
    room: 'room',
    material: 'white',
    asset: 'product',
    content: { $bind: 'store.price' },
    interaction: { action: 'open-widget' },
    components: [{ type: 'project.component' }],
  }]
  const result = inspectWorldDocument(document, {
    mode: 'generator',
    actionRegistry: registry(['open-widget']),
    componentTypeRegistry: registry(['project.component']),
    entityTypeRegistry: registry(['project.widget']),
  })
  assert.equal(result.valid, true, result.errors.map(issue => `${issue.code}: ${issue.message}`).join('\n'))
})


test('generator validation requires registered web-surface applications', () => {
  const document = baseDocument()
  document.entities = [{
    id: 'dashboard',
    type: 'web-surface',
    size: [4, 2],
    webSurface: {
      source: { type: 'app', app: 'dashboard-app' },
      fallback: { type: 'snapshot', image: './dashboard.webp' },
    },
  }]
  const missing = inspectWorldDocument(document, { mode: 'generator' })
  assert.ok(missing.errors.some(issue => issue.code === 'ANYO_WEB_SURFACE_APP_NOT_REGISTERED'))
  const registered = inspectWorldDocument(document, {
    mode: 'generator',
    webSurfaceRegistry: registry(['dashboard-app']),
  })
  assert.equal(registered.valid, true, registered.errors.map(issue => issue.message).join('\n'))
})

test('marker components are preserved but warn when no handling system is declared', () => {
  const document = baseDocument()
  document.entities = [{
    id: 'label', type: 'text', content: 'Hello', components: [{ type: 'anyo.billboard' }],
  }]
  const missing = inspectWorldDocument(document, { mode: 'generator' })
  assert.ok(missing.warnings.some(issue => issue.code === 'ANYO_COMPONENT_SYSTEM_MISSING'))
  const handled = inspectWorldDocument(document, {
    mode: 'generator', handledComponents: new Set(['anyo.billboard']),
  })
  assert.ok(!handled.warnings.some(issue => issue.code === 'ANYO_COMPONENT_SYSTEM_MISSING'))
})
