# Buildings

Define rooms and connections in JSON. The compiler builds wall segments, floors, colliders, and visibility portals from those declarations.

## Rooms

A rectangular room uses a position, size, and height:

```json
{
  "id": "lobby",
  "position": [0, 0],
  "size": [10, 8],
  "height": 3.2,
  "wallThickness": 0.14
}
```

`size` is `[width, depth]`.

## Attached rooms

```json
{
  "id": "gallery",
  "size": [8, 6],
  "attachTo": {
    "room": "lobby",
    "wall": "north",
    "align": "end",
    "gap": 0,
    "offset": 0
  }
}
```

`align` controls placement along the parent wall. Valid values are `start`, `center`, and `end`.

Anyo creates an open doorway when attached rooms do not declare their own connection. When only one side declares a targeted opening, Anyo mirrors it onto the other room.

## Doors

```json
{
  "id": "entrance",
  "type": "door",
  "wall": "south",
  "offset": "center",
  "width": 2.4,
  "height": 2.6,
  "open": true
}
```

Closed doors create a panel and collider. Open doors leave a traversable wall opening.

## Windows

```json
{
  "type": "window",
  "wall": "east",
  "offset": 2,
  "width": 2,
  "height": 1.4,
  "elevation": 0.9,
  "material": "glass"
}
```

Windows create a real wall opening plus a thin pane. Window collision is enabled by default and can be disabled explicitly.

## Multiple floors

Each floor has an absolute elevation:

```json
{
  "id": "upper",
  "elevation": 3.8,
  "rooms": []
}
```

## Stairs

```json
{
  "id": "main-stairs",
  "fromFloor": "ground",
  "toFloor": "upper",
  "position": [-4, 3],
  "direction": "north",
  "width": 1.4,
  "run": 5.2,
  "steps": 22
}
```

The compiler creates:

- one box per step
- one collider per step
- a floor cutout on the upper floor
- a ceiling cutout on the lower floor
- a room visibility portal between endpoints

Place the stair footprint inside rooms on both floors so the compiler can associate it with room chunks.

## Automatic doors

A door starts closed unless you set `open: true`. Setting `automatic: true` records the intended behavior but does not implement it.

Install a system or plugin to detect proximity, animate the door, update its state, and synchronize collision. Validation reports `ANYO_AUTOMATIC_DOOR_SYSTEM_REQUIRED` for automatic-door declarations.
