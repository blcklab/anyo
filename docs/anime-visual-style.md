# Anime visual style

Anyo keeps anime styling renderer-neutral. A world opts into a profile through its environment:

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

A material may override the world profile:

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

The Sekai64 renderer applies the global toon profile to ordinary materials. Explicit PBR materials and generated window primitives remain PBR, which prevents glass and transparent surfaces from receiving an unsuitable opaque toon treatment.
