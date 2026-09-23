# Exploration and collision

The exploration plugin uses a lightweight first-person controller and does not include a rigid-body physics engine.

## Configuration

```json
{
  "exploration": {
    "spawn": {
      "room": "lobby",
      "position": [0, 1.65, 2]
    },
    "height": 1.75,
    "eyeHeight": 1.65,
    "radius": 0.3,
    "walkSpeed": 3.2,
    "runSpeed": 5.5,
    "gravity": 9.81,
    "stepHeight": 0.32,
    "pointerLock": true
  }
}
```

## Collision representation

- walls: axis-aligned boxes
- floors: thin boxes
- windows: thin solid panes by default
- closed doors: thin boxes
- stairs: one box per step
- primitive entities: optional bounding boxes
- player: vertical capsule approximation using a horizontal circle and height interval

Movement is divided into substeps to reduce tunneling through thin walls.

## Room detection

The controller tests the camera position against compiled room bounds and updates `world.getCurrentRoom()`.

Room changes emit `room:leave` and `room:enter`.

## Custom controls

Do not include `explorePlugin()` when an application supplies its own camera controller. The compiled colliders remain available through `world.compiled.colliders`.
