# Entities

Use entities for objects, text, models, lights, and triggers. They can belong to rooms or form a world without a building.

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

The built-in text renderers draw text to a canvas texture. This example uses a system font:

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

Place related entities in a group to move and rotate them together. JSON rotations use XYZ Euler angles in radians; the compiler composes rotations with quaternions and also exposes matrix data. A child ID is prefixed by its parent during normalization, for example:

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

Attach [components](components.md) for optional behavior. Existing `interaction`, `collision`, `audio`, `lod`, `trigger`, and `visible` fields are still supported.
