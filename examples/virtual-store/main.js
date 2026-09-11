import { createWorld, explorableBuildingPreset } from '../../dist/esm/index.js'
import { Sekai64Renderer } from '../../dist/esm/renderer-sekai64/index.js'

const canvas = document.querySelector('#world')
const status = document.querySelector('#status')
const saleButton = document.querySelector('#sale')

const renderer = new Sekai64Renderer({
  canvas,
  antialias: true,
  shadows: false,
  fieldOfView: 70,
})

const world = createWorld({
  renderer,
  plugins: explorableBuildingPreset({
    visibility: { maxDepth: 2 },
    interactions: { defaultDistance: 5 },
  }),
})

world.registerAction('inspect-product', ({ sku, name }) => {
  status.textContent = `Selected ${name ?? 'product'} (${sku ?? 'unknown SKU'}).`
})

world.on('room:enter', ({ roomId }) => {
  status.textContent = `Entered ${roomId}.`
})

await world.load('./world.json')
world.start()
document.documentElement.dataset.anyoReady = renderer.info.capabilities.backend ?? 'ready'

saleButton.addEventListener('click', async () => {
  const current = Number(world.getData('store.inventory'))
  await world.setData('store.inventory', Math.max(0, current - 1))
})

window.addEventListener('beforeunload', () => world.dispose())
