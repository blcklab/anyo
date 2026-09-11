# Anime visual style

Set an environment profile to give ordinary materials a consistent anime style:

```json
{
  "environment": {
    "visualStyle": {
      "profile": "anime-cinematic",
      "shadowColor": "#77749f",
      "highlightColor": "#fff5cf",
      "rimColor": "#ffe8f0",
      "outlineColor": "#29283b"
    }
  }
}
```

Available profiles are `standard`, `anime-soft`, `anime`, and `anime-cinematic`.

Override individual materials when needed. Here, the pink material adjusts toon shading and the glass keeps PBR:

```json
{
  "materials": {
    "hero-pink": {
      "color": "#eeb7c5",
      "toon": {
        "shadeSteps": 3,
        "highlightStrength": 0.3
      }
    },
    "glass": {
      "color": "#bfe8f4",
      "transparent": true,
      "opacity": 0.3,
      "shadingModel": "pbr"
    }
  }
}
```

The Sekai64 adapter applies the profile to ordinary materials. Explicit PBR materials and generated windows keep PBR shading. See [visual settings](visual-contract.md) for lighting and color management.
