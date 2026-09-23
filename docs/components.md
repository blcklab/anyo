# Declarative components

Anyo 0.5 introduces namespaced components as renderer-independent JSON data. Components describe optional capability or behavior attached to an entity; they never contain executable JavaScript.

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

## Built-in component contracts

- `anyo.interactable`
- `anyo.collider`
- `anyo.audio`
- `anyo.lod`
- `anyo.visibility`
- `anyo.trigger`
- `anyo.animation`
- `anyo.billboard`

The animation and billboard definitions are preserved as compiled component data for optional systems. They do not add a heavy animation or billboard engine to Anyo core.

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

An explicit component of the same type takes precedence over its legacy field. A disabled explicit component therefore provides a predictable way to turn off inherited or prefab behavior.

## Registering a component

```ts
import { createComponentTypeRegistry } from '@blcklab/anyo/components'
import { entitiesPlugin } from '@blcklab/anyo/entities'

const registry = createComponentTypeRegistry()

registry.register({
  type: 'community.health',
  validate(component) {
    if (typeof component.maximum !== 'number' || component.maximum <= 0) {
      throw new Error('maximum must be positive')
    }
  },
  compile(component) {
    return {
      current: component.current ?? component.maximum,
      maximum: component.maximum,
    }
  },
})

const world = createWorld({
  plugins: [entitiesPlugin({ componentRegistry: registry })],
})
```

A registration may validate JSON and return JSON-safe renderer-independent compiled data. It must not store DOM nodes, renderer objects, GPU resources, functions, or class instances in world state.

## Unknown components

```ts
entitiesPlugin({ unknownComponents: 'error' })
entitiesPlugin({ unknownComponents: 'warn' })
entitiesPlugin({ unknownComponents: 'preserve' })
```

`error` is the default. `preserve` is useful for editors that need to open a document even when an optional extension is unavailable.

## Host actions

Interactive component actions still resolve through the host registry:

```ts
world.registerAction('toggle-door', ({ doorId }) => {
  // Application-controlled behavior.
})
```

Anyo never evaluates JavaScript from JSON.

## Marker-system diagnostics

`anyo.animation` and `anyo.billboard` are marker contracts. They preserve JSON-safe component data but do not execute hidden renderer behavior. Strict generation or production tooling can declare installed handlers through `handledComponents`; otherwise Anyo reports `ANYO_COMPONENT_SYSTEM_MISSING` as a warning.
