# Plugins

Use a plugin to extend world compilation, set up behavior, listen for events, or clean up resources when a world is replaced.

```ts
import type { WorldPlugin } from '@blcklab/anyo'

export function analyticsPlugin(): WorldPlugin {
  let off: (() => void) | undefined

  return {
    name: 'example:analytics',

    setup({ world }) {
      off = world.on<{ roomId: string }>('room:enter', ({ roomId }) => {
        console.log('Entered', roomId)
      })
    },

    teardown() {
      off?.()
      off = undefined
    },
  }
}
```

## Extend compilation

```ts
export function customCompiler(): WorldPlugin {
  return {
    name: 'example:compiler',
    compile({ document, output, warn }) {
      // Add renderer-independent primitives, colliders, portals, or triggers.
    },
  }
}
```

## Plugin order

Plugins compile in the order you pass them. The standard preset runs:

1. building
2. entities
3. visibility
4. zones
5. exploration
6. interactions

Building must compile before entities because room chunks need to exist before entity IDs are attached to them.

Duplicate plugin names are rejected.

`teardown()` releases resources for the loaded document before the same plugin is set up for a replacement. Use `dispose()` for final cleanup when the world itself is disposed. Keep subscriptions and per-document state in the teardown path.

## Runtime systems versus plugins

Use plugins for compilation, interactions, DOM integration, and exploration.

Use a `WorldSystem` for simulation that needs fixed steps or temporary transforms:

```ts
import type { WorldSystem } from '@blcklab/anyo'

const system: WorldSystem = {
  name: 'example:motion',
  fixedUpdate(delta, context) {
    // Physics or deterministic simulation.
  },
  update(delta, context) {
    // Animation and interpolation.
  },
  lateUpdate(delta, context) {
    // Constraints and final corrections.
  },
}
```

A package can expose both: a plugin for setup and compilation, and a system for simulation. See [runtime systems](runtime-systems.md).
