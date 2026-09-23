# Runtime systems and transient transforms

Anyo world JSON is persistent authoring state. Animation, physics, procedural motion, constraints, networking, and other high-frequency simulations should not rewrite that JSON every frame.

The runtime-systems foundation provides:

- deterministic `fixedUpdate`, `update`, and `lateUpdate` phases
- a fixed timestep with a bounded substep count
- world- and local-space transient transform layers
- override and additive composition
- stable source ownership, priorities, cleanup, and rollback
- one batched renderer synchronization per frame
- component and tag queries over renderer-independent compiled entities
- explicit commit/reset APIs when a transient result should become authored JSON

The systems foundation does not include an animation mixer or rigid-body solver. Those belong in optional packages built on this contract.

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

Transient layers:

- do not mutate the source document
- do not create history entries
- do not validate or recompile the world every frame
- remain private to the running world
- are removed when their owning system is disposed

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

`context.setTransform()` automatically owns the layer under the system name. `context.clearTransform()` removes only that system's layer.

## System phases

```ts
interface WorldSystem {
  name: string
  order?: number

  setup?(context: SystemRuntimeContext): void | Promise<void>
  fixedUpdate?(deltaSeconds: number, context: SystemRuntimeContext): void
  update?(deltaSeconds: number, context: SystemRuntimeContext): void
  lateUpdate?(deltaSeconds: number, context: SystemRuntimeContext): void
  applyChanges?(changes: readonly WorldChange[], context: SystemRuntimeContext): void | Promise<void>
  dispose?(context: SystemRuntimeContext): void
}
```

Execution order for each frame:

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
- `maxSubSteps` prevents a spiral of death after a long frame.
- `maxFrameDeltaSeconds` limits time admitted into the systems scheduler.
- legacy plugin and renderer frame deltas remain uncapped for backward compatibility.

`context.frame.interpolationAlpha` exposes the remaining fixed-step fraction for optional visual interpolation.

## Manual and headless simulation

```ts
await world.load(document)
world.tick(1 / 60)
```

`tick()` runs one deterministic manual frame and is useful for tests, server-side simulation, exports, and tools. It cannot be called while the normal or XR frame loop is running.

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

Layers are deterministic: priority first, then source name.

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

The physics layer can own the root pose while a later animation layer adds a local procedural offset. Skeletal joints and morph weights remain renderer/animation-engine responsibilities rather than Anyo entity transforms.

## Component queries

```ts
const bodies = context.query.components('anyo.rigid-body')
const animated = context.query.components('anyo.animation')
const interactables = context.query.tagged('interactive')
const entity = context.query.entity('crate')
const primitives = context.query.primitives('crate')
```

Queries read compiled, renderer-independent data and are rebuilt when the compiled world changes. Cache stable query results inside a system when appropriate, then refresh them in `applyChanges()`.

## Flush behavior

While `world.start()` or XR is active, Anyo flushes dirty runtime transforms once per frame.

For a stopped or headless world, flush explicitly:

```ts
world.transforms.set('crate', transform, {
  source: 'simulation',
})

await world.flushRuntimeTransforms()
```

The renderer hot path is synchronous and optional:

```ts
applyRuntimeTransforms(
  updates: readonly RuntimeTransformUpdate[],
): void
```

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

The commit:

- converts the final world pose back into authored local/room space
- creates one normal history mutation
- preserves asset scaling
- clears transient layers after the authored update succeeds

Surface-attached and generated entities reject direct runtime-transform commits because their transforms are derived from higher-level authoring constraints.

Reset without committing:

```ts
await world.resetRuntimeTransform('chair', 'placement')
```

## Hierarchy and authoring identity

Parent transient transforms propagate to descendants. Local-space layers follow parent rotation and scale.

When an editable entity is reparented and its canonical compiled ID changes, layers rebase through its stable `authoringId`. Generated entities without stable editable identity may intentionally lose transient state after structural regeneration.

## Error and lifecycle rules

- Renderer synchronization failures restore dirty updates for retry.
- Failed world loads restore previous runtime layers.
- System setup failure disposes systems already initialized.
- Disposal runs in reverse system order.
- Disposal automatically clears layers owned by each system name.
- System update errors are reported through `onWarning` and do not corrupt the world loop.
- Unsupported or structural document mutations still use Anyo's complete validation/compiler path.

## Animation and physics package boundaries

Recommended package layout:

```text
@blcklab/anyo
  runtime systems, transient transforms, queries, renderer batching

@blcklab/anyo-animation
  keyframes, timelines, clips, state machines, blending, events

@blcklab/anyo-physics
  bodies, shapes, broad phase, narrow phase, solver, joints, events

@blcklab/sekai64
  GPU transforms, skinning, morph targets, visual resources
```

The core provides the scheduling and state boundary. Optional engines provide simulation behavior.
