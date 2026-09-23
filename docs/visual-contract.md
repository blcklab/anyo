# Visual Contract

Anyo describes visual intent without binding world JSON to a renderer. The world is validated and normalized once, then an adapter translates the normalized contract to Sekai64, Three.js, or another renderer.

## Texture color spaces

The standard channels have fixed semantics:

| Channel | Color space |
|---|---|
| Base color | sRGB |
| Emissive | sRGB |
| Normal | Linear data |
| Roughness | Linear data |
| Metalness | Linear data |
| Packed metallic-roughness | Linear data |
| Occlusion | Linear data |

Use `ANYO_TEXTURE_COLOR_SPACES` when a loader or renderer needs to inspect the contract programmatically.

## World-owned environment

```json
{
  "environment": {
    "background": "#090d14",
    "ambientLight": {
      "color": "#d8e5ff",
      "intensity": 0.3
    },
    "lighting": {
      "enabled": true,
      "skyColor": "#7187a5",
      "groundColor": "#111722",
      "diffuseIntensity": 0.32,
      "specularIntensity": 0.42
    },
    "colorManagement": {
      "toneMapping": "aces",
      "exposure": 1.1,
      "outputColorSpace": "srgb"
    },
    "shadows": {
      "enabled": true,
      "mapSize": 2048,
      "bias": 0.0008,
      "normalBias": 0.018,
      "softness": 1,
      "cameraPadding": 2.5
    },
    "imageQuality": {
      "dithering": true,
      "maxAnisotropy": 8
    },
    "sun": {
      "color": "#e7f0ff",
      "intensity": 0.82,
      "position": [10, 16, 7],
      "castShadow": true
    }
  }
}
```

Runtime hosts may override a recommendation—for example, an accessibility exposure control—but the world remains the default owner of its intended presentation.

## Materials

Normalized materials provide stable defaults for base color, emissive intensity, roughness, metalness, normal scale, occlusion strength, alpha mode, double-sided rendering, and shadow participation. Transparent or transmissive materials default to not casting an opaque shadow.

```json
{
  "materials": {
    "lab-glass": {
      "color": "#8bc7d4",
      "roughness": 0.16,
      "metalness": 0.02,
      "opacity": 0.34,
      "alphaMode": "blend",
      "doubleSided": true,
      "transmission": 0.72,
      "ior": 1.5,
      "thickness": 0.025,
      "attenuationColor": "#70a9b8",
      "attenuationDistance": 2.5,
      "castShadow": false,
      "receiveShadow": true
    }
  }
}
```

## Local lights

Point-light range and decay are portable authoring controls:

```json
{
  "id": "work-light",
  "type": "light",
  "lightType": "point",
  "color": "#b6f3ff",
  "intensity": 3.6,
  "range": 5.5,
  "decay": 2,
  "castShadow": false
}
```

Anyo reports warnings for destructive ambient, sun, and local-light values. These warnings do not replace physical visual testing, but they prevent common accidental washout and black-screen calibrations.

## Diagnostics

```ts
import { inspectWorldDocument } from '@blcklab/anyo'

const result = inspectWorldDocument(document, {
  rendererInfo: renderer.info,
})

for (const warning of result.warnings) {
  console.warn(warning.code, warning.path, warning.message)
}
```

Capability diagnostics cover material channels and features, color management, environment lighting, environment maps, and shadows. A missing environment-map asset is an error before rendering begins.

## Normalization API

```ts
import {
  normalizeEnvironmentDefinition,
  normalizeMaterialDefinition,
  normalizeWorldDocument,
} from '@blcklab/anyo'
```

Renderer adapters should consume the normalized world rather than re-inventing defaults. This keeps the same JSON predictable across backends.
