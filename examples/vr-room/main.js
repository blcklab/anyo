import {
  createWorld,
  explorableBuildingPreset,
  xrExplorationPlugin,
} from '../../dist/esm/index.js'
import { Sekai64Renderer } from '../../dist/esm/renderer-sekai64/index.js'

const canvas = document.querySelector('#world')
const status = document.querySelector('#status')
const enterButton = document.querySelector('#enter-vr')
const exitButton = document.querySelector('#exit-vr')

const renderer = new Sekai64Renderer({
  canvas,
  backend: 'webgl2',
  antialias: true,
  pixelRatio: Math.min(devicePixelRatio, 2),
})

const world = createWorld({
  renderer,
  plugins: [
    ...explorableBuildingPreset({ interactions: { defaultDistance: 10 } }),
    xrExplorationPlugin({
      locomotion: 'teleport',
      turning: 'snap',
      snapAngle: 30,
    }),
  ],
})

world.registerAction('inspect-product', ({ name }) => {
  status.textContent = `Selected ${name ?? 'product'} using the normal Anyo action registry.`
})
world.on('xr:session-start', () => {
  status.textContent = 'VR active. Squeeze to teleport; use the select trigger to interact.'
  enterButton.hidden = true
  exitButton.hidden = false
})
world.on('xr:session-end', () => {
  status.textContent = 'VR ended. Desktop exploration remains active.'
  enterButton.hidden = false
  exitButton.hidden = true
})
world.on('xr:error', ({ error }) => {
  status.textContent = error instanceof Error ? error.message : String(error)
})

await world.load('./world.json')
world.start()

enterButton.disabled = !(await world.xr.isSupported('immersive-vr'))
if (enterButton.disabled) status.textContent = 'Immersive VR is unavailable here; desktop exploration still works.'

enterButton.addEventListener('click', () => {
  void world.xr.enter({ mode: 'immersive-vr', referenceSpace: 'local-floor' })
})
exitButton.addEventListener('click', () => void world.xr.exit())
window.addEventListener('pagehide', () => world.dispose(), { once: true })
