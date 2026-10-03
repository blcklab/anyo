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
- `anyo.pointField`

The animation and billboard definitions are preserved as compiled component data for optional systems. They do not add a heavy animation or billboard engine to Anyo core.

### `anyo.pointField`

`anyo.pointField` describes a compact generic set of visual points without implying stars, particles, or any provider package. `world` space uses normal world positions; `directional` space treats each position as a direction and is suitable for camera-translation-invariant fields. Point sizes are renderer-facing pixel sizes.

```json
{
  "type": "anyo.pointField",
  "space": "directional",
  "defaultColor": "#ffffff",
  "defaultSize": 0.8,
  "defaultIntensity": 1,
  "points": [
    { "position": [0.2, 0.9, -0.3], "size": 1.2, "intensity": 1.4 },
    { "position": [-0.4, 0.7, 0.5], "color": "#dce8ff" }
  ]
}
```

The built-in validator bounds a field to 100,000 points. External packages may generate this JSON, but Anyo does not depend on or identify the package that produced it. Rendering requires a renderer adapter that exposes point-field capability; older Sekai64 releases skip the component with a diagnostic.

Runtime hosts can update an already-mounted field without rewriting the authored document:

```ts
world.setPointFieldPoints('sky', nextPoints, 'stars')
```

`setPointFieldPoints()` is a provider-neutral hot path intended for time sliders, live datasets, telemetry, and other dynamic point sources. `resetPointFieldPoints()` restores the authored point payload. Runtime point updates are transient application state and are not serialized into `world.anyo.json`.

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
