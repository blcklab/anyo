import {
  createWorld,
  explorableBuildingPreset,
} from '../../dist/esm/index.js'
import { Sekai64Renderer } from '../../dist/esm/renderer-sekai64/index.js'

const canvas = document.querySelector('#world')
const status = document.querySelector('#status')
let animatedEntities = []

const floatingSystem = {
  name: 'example:floating-products',
  order: 200,

  setup(context) {
    animatedEntities = context.query
      .components('anyo.animation')
      .map(({ entity }) => entity)

    status.textContent = `${animatedEntities.length} transient animation target loaded.`
  },

  update(_deltaSeconds, context) {
    const time = context.frame.time / 1000

    for (const entity of animatedEntities) {
      context.setTransform(
        entity.id,
        {
          position: [0, Math.sin(time * 1.8) * 0.18, 0],
          rotation: [0, time * 0.7, 0],
        },
        {
          mode: 'additive',
          space: 'local',
        },
      )
    }
  },
}

const renderer = new Sekai64Renderer({
  canvas,
  backend: 'auto',
  antialias: true,
  pixelRatio: Math.min(devicePixelRatio, 2),
})

const world = createWorld({
  renderer,
  plugins: explorableBuildingPreset(),
  systems: [floatingSystem],
  systemOptions: {
    fixedDeltaSeconds: 1 / 60,
    maxSubSteps: 4,
  },
})

await world.load('./world.json')
world.start()

window.addEventListener('pagehide', () => world.dispose(), { once: true })
