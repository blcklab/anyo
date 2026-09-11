import { createWorld, explorableBuildingPreset } from '../../dist/esm/index.js'
import { Sekai64Renderer } from '../../dist/esm/renderer-sekai64/index.js'

export async function bootstrapPortfolio(options = {}) {
  const documentRef = options.documentRef ?? document
  const windowRef = options.windowRef ?? window
  const createWorldFn = options.createWorldFn ?? createWorld
  const Renderer = options.Renderer ?? Sekai64Renderer

  const canvas = documentRef.querySelector('#world')
  const message = documentRef.querySelector('#message')
  const renderer = new Renderer({ canvas, antialias: true })
  const world = createWorldFn({
    renderer,
    plugins: explorableBuildingPreset(),
  })

  world.registerAction('open-project', ({ name, packageName }) => {
    message.textContent = `${name} — ${packageName}`
  })
  world.on('portfolio:about', () => {
    message.textContent = 'You entered the About room.'
  })

  await world.load('./world.json')
  world.start()
  documentRef.documentElement.dataset.anyoReady = renderer.info.capabilities.backend ?? 'ready'
  windowRef.addEventListener('beforeunload', () => world.dispose())
  return { world, renderer }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  await bootstrapPortfolio()
}
