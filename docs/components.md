# Declarative components

Attach components to entities to describe behavior such as interaction or collision. Each component has a namespaced type and JSON data. Your app installs the code that handles it.

```json
{
  "id": "door",
  "type": "model",
  "asset": "door-model",
  "components": [
    { "type": "anyo.collider" },
    {
      "type": "anyo.interactable",
      "events": {
        "select": {
          "action": "toggle-door",
          "params": { "doorId": "door" }
        }
      }
    }
  ]
}
```

## Common built-in components

- `anyo.interactable`
- `anyo.collider`
- `anyo.audio`
- `anyo.lod`
- `anyo.visibility`
- `anyo.trigger`
- `anyo.animation`
- `anyo.billboard`

Animation and billboard components store settings for optional systems. Declaring them does not start an animation engine.

## Legacy compatibility

The existing fields remain supported:

```txt
interaction → anyo.interactable
collision   → anyo.collider
audio       → anyo.audio
lod         → anyo.lod
trigger     → anyo.trigger
visible     → anyo.visibility
```

An explicit component takes precedence over the matching legacy field. Disable an explicit component to turn off behavior inherited from a prefab.

## Registering a component

```ts
import { createWorld } from '@blcklab/anyo'
import { createComponentTypeRegistry } from '@blcklab/anyo/components'
import { entitiesPlugin } from '@blcklab/anyo/entities'

const registry = createComponentTypeRegistry()

registry.register({
  type: 'community.health',
  validate(component) {
    if (typeof component.maximum !== 'number' || !Number.isFinite(component.maximum) || component.maximum <= 0) {
      throw new Error('maximum must be positive')
    }
  },
  compile(component) {
    const maximum = component.maximum as number // Checked by validate().
    return {
      current: typeof component.current === 'number' ? component.current : maximum,
      maximum,
    }
  },
})

const world = createWorld({
  plugins: [entitiesPlugin({ componentRegistry: registry })],
})
```

A registration validates the component and returns compiled JSON data. Keep DOM nodes, renderer objects, GPU resources, functions, and class instances outside world state.

## Unknown components

```ts
entitiesPlugin({ unknownComponents: 'error' })
entitiesPlugin({ unknownComponents: 'warn' })
entitiesPlugin({ unknownComponents: 'preserve' })
```

`error` is the default. `preserve` is useful for editors that need to open a document even when an optional extension is unavailable.

## Host actions

Register the actions used by interactive components in your app:

```ts
world.registerAction('toggle-door', ({ doorId }) => {
  // Toggle the door in your application.
})
```

Anyo never evaluates JavaScript from JSON.

## Components that need a system

If your app handles `anyo.animation` or `anyo.billboard`, include those types in validation's `handledComponents`. Without a declared handler, Anyo reports `ANYO_COMPONENT_SYSTEM_MISSING`. See [validation modes](world-schema.md#validation-modes).
