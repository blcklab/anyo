# Exploration and collision

Use the exploration plugin for first-person movement through compiled rooms and colliders. For moving rigid bodies, joints, or impulses, add a separate physics system.

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

The controller uses the camera position and compiled room bounds to track the current room. Read it with `world.getCurrentRoom()`.

Room changes emit `room:leave` and `room:enter`.

## Custom controls

If your app owns camera movement, omit `explorePlugin()` and use `world.compiled.colliders` for collision data. If you only want custom input with Anyo's movement rules, use [player input APIs](player-foundation.md#input-ownership).
