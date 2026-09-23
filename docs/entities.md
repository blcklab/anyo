# Entities

Entities are universal spatial nodes. They may exist inside rooms or directly in an entity-only world.

## Local room coordinates

```json
{
  "id": "counter",
  "type": "box",
  "room": "store",
  "position": [3, 0.55, 2],
  "size": [2.5, 1.1, 0.8],
  "collision": true
}
```

When `room` is provided, position is relative to the room center and floor elevation.

## Surface attachment

```json
{
  "id": "heading",
  "type": "text",
  "content": "Projects",
  "size": [4, 1],
  "surface": {
    "room": "gallery",
    "wall": "west",
    "anchor": "center",
    "offset": [0, 0.6],
    "depth": 0.012,
    "faceRoom": true
  }
}
```

The first offset component moves along the wall. The second moves vertically.

## Text

Text uses a generated canvas texture and requires no font file:

```json
{
  "type": "text",
  "content": "Hello",
  "style": {
    "fontSize": 0.22,
    "fontFamily": "system-ui, sans-serif",
    "fontWeight": 700,
    "color": "#202124",
    "background": "#ffffff",
    "padding": 0.08,
    "align": "center",
    "resolution": 512
  }
}
```

## Models

```json
{
  "assets": {
    "shoe": {
      "type": "model",
      "format": "glb",
      "src": "/models/shoe.glb",
      "scale": 0.5,
      "lod": [
        { "distance": 0, "src": "/models/shoe.glb" },
        { "distance": 20, "type": "box" },
        { "distance": 40, "type": "hidden" }
      ]
    }
  }
}
```

```json
{
  "id": "shoe-display",
  "type": "model",
  "asset": "shoe",
  "room": "store",
  "position": [0, 1.2, 0]
}
```

## Groups and transforms

Groups compose child transforms using quaternion rotation composition. JSON rotations are XYZ Euler angles in radians; compiled transforms also expose quaternion and matrix metadata. Child IDs are namespaced by their parent during normalization.

```text
display/product
```

## Triggers

Triggers do not render geometry:

```json
{
  "id": "about-zone",
  "type": "trigger",
  "room": "about",
  "position": [0, 1, 0],
  "trigger": {
    "size": [4, 2, 4],
    "once": true,
    "onEnter": [
      { "event": "portfolio:about" }
    ]
  }
}
```


## Components

Anyo 0.5 entities may attach namespaced declarative components. See [`components.md`](components.md). Existing interaction, collision, audio, LOD, trigger, and visibility fields remain compatible.
