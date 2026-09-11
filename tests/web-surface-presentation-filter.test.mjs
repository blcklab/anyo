import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebSurfaceAppRegistry, WebSurfaceRuntime } from '../dist/esm/web-surface/index.js'

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
    this.dataset = {}
    this.style = {}
    this.children = []
    this.listeners = new Map()
    this.inert = false
  }
  setAttribute(name, value) { this[name] = String(value) }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = [...children] }
  addEventListener(name, listener) { this.listeners.set(name, listener) }
  animate() { return { cancel() {} } }
  remove() { this.removed = true }
}

function primitive() {
  return {
    id: 'entity:panel', entityId: 'panel', visible: true, size: [2, 1, 0.02],
    transform: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    webSurface: {
      source: { type: 'app', app: 'panel', props: {} },
      target: { type: 'plane', size: [2, 1] },
      renderMode: 'auto', framePolicy: { mode: 'on-change', maxFps: 30 }, animations: [],
      interaction: { pointer: false, keyboard: false, scroll: false },
    },
  }
}

test('generic Web Surface presentation filter mounts and unmounts host-selected presentations without duplication', async () => {
  const previousDocument = globalThis.document
  const previousMatchMedia = globalThis.matchMedia
  const body = new FakeElement('body')
  globalThis.document = { body, createElement: tag => new FakeElement(tag) }
  globalThis.matchMedia = () => ({ matches: false })
  try {
    let allowed = false
    let mounts = 0
    let disposals = 0
    const registry = createWebSurfaceAppRegistry()
    registry.register('panel', {
      mount() { mounts += 1; return { dispose() { disposals += 1 } } },
    })
    const value = primitive()
    const context = {
      world: { xr: { state: 'idle' }, runAction: async () => {}, selectPrimitive: async () => true },
      renderer: {}, document: {},
      compiled: { primitives: [value] },
    }
    const runtime = new WebSurfaceRuntime({ registry, shouldPresent: () => allowed })
    await runtime.sync(context)
    assert.equal(mounts, 0)
    allowed = true
    await runtime.sync(context)
    assert.equal(mounts, 1)
    allowed = false
    await runtime.sync(context)
    assert.equal(disposals, 1)
    runtime.dispose()
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousMatchMedia === undefined) delete globalThis.matchMedia
    else globalThis.matchMedia = previousMatchMedia
  }
})
