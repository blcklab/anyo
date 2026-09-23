# Plugin architecture

A plugin may participate in compile time, setup, frame updates, and disposal.

```ts
import type { WorldPlugin } from '@blcklab/anyo'

export function analyticsPlugin(): WorldPlugin {
  let off: (() => void) | undefined

  return {
    name: 'example:analytics',

    setup({ world }) {
      off = world.on('room:enter', ({ roomId }) => {
        console.log('Entered', roomId)
      })
    },

    dispose() {
      off?.()
    },
  }
}
```

## Compile plugin

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

Compilation runs in array order. The standard preset uses:

1. building
2. entities
3. visibility
4. zones
5. exploration
6. interactions

Building must compile before entities because room chunks need to exist before entity IDs are attached to them.

Duplicate plugin names are rejected.

## Runtime systems versus plugins

Plugins remain the correct extension point for compilation, interactions, DOM integration, exploration, and lower-frequency runtime behavior.

Use a `WorldSystem` for high-frequency simulation that needs deterministic phases or transient transforms:

```ts
const system = {
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

Systems do not replace plugins. A package may expose both: a plugin for compile/setup behavior and a system for its hot runtime loop.

See `runtime-systems.md`.
