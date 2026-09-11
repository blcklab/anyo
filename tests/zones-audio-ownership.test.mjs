import test from 'node:test'
import assert from 'node:assert/strict'
import { zonesPlugin } from '../dist/esm/zones/index.js'

const audioPrimitive = {
  id: 'audio-primitive',
  entityId: 'ambient',
  kind: 'audio',
  transform: { position: [0, 0, 0] },
  audio: { src: '/ambient.ogg', autoplay: true, loop: true, volume: 0.5, radius: 8 },
}

function createContext() {
  return {
    compiled: { primitives: [audioPrimitive] },
    renderer: { camera: { getPosition: () => [0, 0, 0] } },
    world: { emit() {} },
  }
}

test('zones plugin does not create legacy audio playback by default', () => {
  const OriginalAudio = globalThis.Audio
  let created = 0
  globalThis.Audio = class {
    constructor(src) { this.src = src; this.loop = false; this.preload = ''; created += 1 }
    pause() {}
    play() { return Promise.resolve() }
  }
  try {
    const plugin = zonesPlugin({ triggers: false, lod: false })
    plugin.setup(createContext())
    assert.equal(created, 0)
    plugin.dispose()
  } finally {
    if (OriginalAudio === undefined) delete globalThis.Audio
    else globalThis.Audio = OriginalAudio
  }
})

test('legacy audio remains available only through explicit opt-in', () => {
  const OriginalAudio = globalThis.Audio
  let created = 0
  globalThis.Audio = class {
    constructor(src) { this.src = src; this.loop = false; this.preload = ''; created += 1 }
    pause() {}
    play() { return Promise.resolve() }
  }
  try {
    const plugin = zonesPlugin({ triggers: false, lod: false, audio: true })
    plugin.setup(createContext())
    assert.equal(created, 1)
    plugin.dispose()
  } finally {
    if (OriginalAudio === undefined) delete globalThis.Audio
    else globalThis.Audio = OriginalAudio
  }
})
