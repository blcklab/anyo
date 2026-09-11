# Runtime systems and transient transforms

Use runtime systems for animation, physics, procedural motion, or networking that updates every frame. They schedule simulation and apply temporary transforms without rewriting the world document or creating history entries.

Anyo provides fixed steps, ordered update phases, transform layers, component queries, and renderer batching. Your animation or physics package supplies the simulation itself.

## State model

```text
Persistent Anyo JSON
        ↓
Compiled authored transforms
        +
Transient runtime layers
        ↓
Resolved renderer transforms
```

Layers stay private to the running world and are removed when their owning system is disposed. Commit a layer explicitly when its result should become saved world data.

## Create a system

```ts
import {
  createWorld,
  entitiesPlugin,
  type WorldSystem,
} from '@blcklab/anyo'

const floatingProducts: WorldSystem = {
  name: 'example:floating-products',
  order: 200,

  setup(context) {
    const products = context.query.tagged('floating')

    for (const product of products) {
      context.setTransform(
        product.id,
        { position: [0, 0, 0] },
        { mode: 'additive', space: 'local' },
      )
    }
  },

  update(_deltaSeconds, context) {
    const offset = Math.sin(context.frame.time / 500) * 0.15

    for (const product of context.query.tagged('floating')) {
      context.setTransform(
        product.id,
        { position: [0, offset, 0] },
        { mode: 'additive', space: 'local' },
      )
    }
  },
}

const world = createWorld({
  plugins: [entitiesPlugin()],
  systems: [floatingProducts],
})
```

`context.setTransform()` assigns the layer to the system's name. `context.clearTransform()` removes that system's layer, leaving other systems' layers alone.

## Frame order

```ts
interface WorldSystem {
  name: string
  order?: number

  setup?(context: SystemRuntimeContext): void | Promise<void>
  fixedUpdate?(deltaSeconds: number, context: SystemRuntimeContext): void
  update?(deltaSeconds: number, context: SystemRuntimeContext): void
  lateUpdate?(deltaSeconds: number, context: SystemRuntimeContext): void
  applyChanges?(changes: readonly WorldChange[], context: SystemRuntimeContext): void | Promise<void>
  teardown?(context: SystemRuntimeContext): void
  dispose?(context: SystemRuntimeContext): void
}
```

Each frame runs:

1. zero or more `fixedUpdate` steps
2. each system's `update`
3. legacy plugin `update`
4. each system's `lateUpdate`
5. one runtime-transform batch
6. renderer submission

Systems are sorted by `order`, then by `name`. Names must be unique.

## Fixed timestep

```ts
const world = createWorld({
  systems: [physicsSystem],
  systemOptions: {
    fixedDeltaSeconds: 1 / 60,
    maxSubSteps: 4,
    maxFrameDeltaSeconds: 0.1,
  },
})
```

- `fixedDeltaSeconds` is the simulation step.
- `maxSubSteps` caps catch-up work after a long frame.
- `maxFrameDeltaSeconds` limits time admitted into the systems scheduler.
- legacy plugin and renderer frame deltas remain uncapped for backward compatibility.

`context.frame.interpolationAlpha` exposes the remaining fixed-step fraction for optional visual interpolation.

## Manual and headless simulation

```ts
await world.load(document)
world.tick(1 / 60)
```

`tick()` advances one manual frame for tests, server simulation, or tools. Stop the desktop or XR loop before calling it.

## Runtime transform layers

```ts
world.transforms.set(
  'crate',
  {
    position: [4, 1, -2],
    quaternion: [0, 0, 0, 1],
  },
  {
    source: 'physics',
    priority: 300,
    mode: 'override',
    space: 'world',
  },
)
```

Options:

- `source`: stable owner identifier
- `priority`: higher values resolve after lower values
- `mode: 'override'`: supplied channels replace the current result
- `mode: 'additive'`: positions add, rotations compose, and scales multiply
- `space: 'world'`: values resolve in world coordinates
- `space: 'local'`: values resolve relative to the parent entity or room origin

Layers resolve by priority, then source name.

## Physics and animation together

```ts
context.transforms.set('avatar', physicsRoot, {
  source: 'physics',
  priority: 300,
  mode: 'override',
  space: 'world',
})

context.transforms.set('avatar', breathingOffset, {
  source: 'animation:breathing',
  priority: 400,
  mode: 'additive',
  space: 'local',
})
```

The physics layer sets the root pose; a later animation layer adds a local offset. Use your animation engine for skeletal joints and morph weights.

## Component queries

```ts
const bodies = context.query.components('anyo.rigid-body')
const animated = context.query.components('anyo.animation')
const interactables = context.query.tagged('interactive')
const entity = context.query.entity('crate')
const primitives = context.query.primitives('crate')
```

Queries read compiled entities and refresh when the compiled world changes. If a system caches query results, refresh that cache in `applyChanges()`.

## Send transforms to the renderer

While `world.start()` or XR is active, Anyo flushes dirty runtime transforms once per frame.

For a stopped or headless world, flush explicitly:

```ts
world.transforms.set('crate', transform, {
  source: 'simulation',
})

await world.flushRuntimeTransforms()
```

Adapters can implement the synchronous `applyRuntimeTransforms(updates)` method to receive the whole batch.

Renderers without that method fall back to their existing incremental primitive update contract.

## Commit a runtime transform

A drag, physics settle, or placement operation may need to become persistent JSON:

```ts
world.transforms.set('chair', finalPose, {
  source: 'placement',
})

await world.commitRuntimeTransform('chair', {
  source: 'placement',
  label: 'Place chair',
})
```

A commit converts the resolved pose into the entity's authored local or room coordinates, preserves asset scaling, and creates one history mutation. Transient layers clear after the authored update succeeds.

Surface-attached and generated entities reject direct commits because their placement comes from an attachment or generation rule. Edit that rule or detach the entity first.

Reset without committing:

```ts
await world.resetRuntimeTransform('chair', 'placement')
```

## Hierarchy and authoring identity

Parent transient transforms propagate to descendants. Local-space layers follow parent rotation and scale.

When reparenting changes an editable entity's compiled ID, Anyo uses its `authoringId` to preserve layers. Generated entities without an editable identity may lose temporary state after regeneration.

## Error and lifecycle rules

- Renderer synchronization failures restore dirty updates for retry.
- Failed world loads restore previous runtime layers.
- System setup failure disposes systems already initialized.
- Disposal runs in reverse system order.
- `teardown()` releases per-document resources before a system is set up for a replacement world; `dispose()` handles final world shutdown.
- Disposal automatically clears layers owned by each system name.
- System update errors are reported through `onWarning` and do not corrupt the world loop.
- Unsupported or structural document mutations still use Anyo's complete validation/compiler path.

## Where simulation code belongs

Keep scheduling in Anyo and simulation in optional packages. For example:

```text
@blcklab/anyo
  runtime systems, transient transforms, queries, renderer batching

@blcklab/anyo-animation
  keyframes, timelines, clips, state machines, blending, events

@blcklab/anyo-physics
  bodies, shapes, broad phase, narrow phase, solver, joints, events

@blcklab/sekai64
  rendering and visual resources
```

These are integration responsibilities, not dependencies installed by Anyo core.
