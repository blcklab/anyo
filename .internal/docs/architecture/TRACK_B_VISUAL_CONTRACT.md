# Anyo Track B Visual Contract

Anyo stores renderer-neutral visual intent. Sekai64 remains the GPU implementation and does not become authoritative world state.

## Example

```json
{
  "version": "0.7",
  "assets": {
    "town-lightmap": {
      "type": "texture",
      "format": "ktx2",
      "src": "./textures/town-light.ktx2",
      "colorSpace": "linear",
      "compression": "ktx2"
    },
    "cinematic-grade": {
      "type": "color-lut",
      "format": "cube",
      "src": "./grading/cinematic.cube"
    }
  },
  "materials": {
    "plaza-stone": {
      "shadingModel": "pbr",
      "lightMapTexture": "town-lightmap",
      "lightMapTexCoord": 1,
      "lightMapIntensity": 0.85,
      "clearcoat": 0.08,
      "specularFactor": 0.55
    },
    "river": {
      "shadingModel": "water",
      "water": {
        "shallowColor": "#64d8e8",
        "deepColor": "#16466f",
        "foamColor": "#e8fbff",
        "fresnelPower": 5,
        "reflectionStrength": 0.72,
        "absorptionStrength": 0.38
      }
    }
  },
  "environment": {
    "visualStyle": { "profile": "anime-rpg" },
    "sky": {
      "enabled": true,
      "width": 512,
      "height": 256,
      "sunDirection": [0.35, 0.72, -0.6],
      "haze": 0.22,
      "cloudCoverage": 0.2,
      "cloudDensity": 0.65,
      "seed": 7
    },
    "shadows": {
      "enabled": true,
      "cascades": 3,
      "filter": "pcf5",
      "cascadeBlend": 0.12,
      "distanceFade": 0.16
    },
    "postProcessing": {
      "colorGrading": {
        "enabled": true,
        "lut": "cinematic-grade",
        "lutIntensity": 0.8
      }
    }
  }
}
```

## Ownership

Anyo describes material, environment, shadow, LUT, sky, texture color-space, and compression intent. The optional Sekai64 adapter resolves referenced assets and converts this intent into renderer runtime objects. Browser capability checks, GPU resource allocation, shader compilation, render passes, codec implementations, and device fallback remain code-only host/renderer responsibilities.

The fields are additive to the current unpublished/RC `0.7` schema. If `0.7` has already been frozen or published as immutable, copy these additions into a new `0.8` schema before release instead of mutating a stable schema identifier.
