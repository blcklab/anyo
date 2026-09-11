import {
  createWorld,
  explorableBuildingPreset,
} from '../../dist/esm/index.js'
import { Sekai64Renderer } from '../../dist/esm/renderer-sekai64/index.js'
import { webSurfacePlugin } from '../../dist/esm/web-surface/index.js'

const canvas = document.querySelector('#world')
const status = document.querySelector('#status')

const renderer = new Sekai64Renderer({
  canvas,
  backend: 'auto',
  antialias: true,
  pixelRatio: Math.min(devicePixelRatio, 2),
})

const webSurfaces = webSurfacePlugin({
  zIndex: 10,
  onDiagnostic(diagnostic) {
    console.warn('[Web surface]', diagnostic)
  },
})

webSurfaces.registry.register('spatial-dashboard', {
  mount(container, props, context) {
    container.innerHTML = `
      <style>
        .spatial-app { width: 100%; height: 100%; padding: 8%; display: grid; align-content: center; gap: 6%; color: #f8fafc; background: radial-gradient(circle at 80% 15%, rgba(139,92,246,.32), transparent 34%), #111827; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .spatial-app__badge { width: max-content; padding: .5em .8em; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; background: rgba(255,255,255,.08); font-size: clamp(12px, 2.2vw, 28px); }
        .spatial-app h1 { margin: 0; max-width: 12ch; font-size: clamp(30px, 6vw, 82px); line-height: .98; letter-spacing: -.05em; }
        .spatial-app__row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
        .spatial-app__metric { font-size: clamp(20px, 4vw, 54px); font-weight: 750; font-variant-numeric: tabular-nums; }
        .spatial-app button { border: 0; border-radius: 1rem; padding: .8em 1.1em; color: #111827; background: #f8fafc; font: inherit; font-weight: 700; cursor: pointer; transition: transform 160ms ease, opacity 160ms ease; }
        .spatial-app button:hover { transform: translateY(-2px); }
        .spatial-app__metric.bump { animation: bump 300ms ease-out; }
        @keyframes bump { 0% { opacity: .25; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
      </style>
      <article class="spatial-app">
        <span class="spatial-app__badge"></span>
        <h1>Bring the web into 3D.</h1>
        <div class="spatial-app__row">
          <span class="spatial-app__metric"></span>
          <button type="button">Add visitor</button>
        </div>
      </article>
    `

    const badge = container.querySelector('.spatial-app__badge')
    const metric = container.querySelector('.spatial-app__metric')
    const button = container.querySelector('button')

    function render(next) {
      badge.textContent = next.status
      metric.textContent = `${next.visitors} visitors`
      metric.classList.remove('bump')
      requestAnimationFrame(() => metric.classList.add('bump'))
    }

    render(props)
    button.addEventListener('click', () => {
      void context.world.setData('visitors', Number(context.world.getData('visitors') ?? 0) + 1)
    })

    return {
      update: render,
      pause() { container.querySelector('.spatial-app')?.classList.add('is-paused') },
      resume() { container.querySelector('.spatial-app')?.classList.remove('is-paused') },
      dispose() { container.replaceChildren() },
    }
  },
})

const world = createWorld({
  renderer,
  plugins: [
    ...explorableBuildingPreset(),
    webSurfaces,
  ],
})

await world.load('./world.json')
world.start()
status.textContent = 'Move with WASD and mouse. The wall is a trusted live web app; its image plane is the VR fallback.'
window.addEventListener('pagehide', () => world.dispose(), { once: true })
