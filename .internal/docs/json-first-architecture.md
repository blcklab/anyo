# JSON-First Architecture

Anyo world JSON is the persistent source of truth. Runtime objects, renderer nodes, GPU resources, editor selections, and previews are projections that may be destroyed and recreated.

```text
WorldDocument -> migrate -> validate -> normalize -> compile -> RendererAdapter
```

## Complete example

```ts
import { createWorld, ExtensionRegistry } from '@blcklab/anyo'
import { entitiesPlugin } from '@blcklab/anyo/entities'
import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'

const extensions = new ExtensionRegistry()
extensions.register({
  id: 'shop.product',
  version: '1.0.0',
  capabilities: ['catalog'],
  componentTypes: ['shop.product'],
  actions: ['shop.openProduct'],
})

const worldDocument = await fetch('/worlds/store.anyo.json').then((response) => response.json())
const canvas = globalThis.document.querySelector('canvas')
if (!canvas) throw new Error('Missing canvas')
const renderer = new Sekai64Renderer({ canvas })
const world = createWorld({
  renderer,
  plugins: [entitiesPlugin()],
  validation: { extensionRegistry: extensions },
})

world.registerAction('shop.openProduct', async ({ productId }) => {
  // Application code owns commerce and DOM behavior.
  console.log(productId)
})

await world.load(worldDocument)
world.start()
```

The editor is optional. The same document can be validated, migrated, patched, packaged, and compiled in headless Node.js without creating a DOM or GPU device.

## Document versus snapshot

- `world.serializeDocument()` returns authored JSON.
- `world.createSnapshot()` captures mutable runtime state.
- `world.restoreSnapshot()` restores runtime state without rewriting authored JSON.
- `world.commitSnapshot()` explicitly writes supported snapshot values into the document.

## Renderer intent

World JSON may request portable visual intent. The host resolves it against policy and runtime capabilities. Device selection, canvas ownership, memory limits, accessibility policy, and forced backend decisions remain code-controlled.
