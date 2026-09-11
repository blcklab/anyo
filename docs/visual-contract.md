# Visual settings

Store lighting and material settings in the world document. Anyo validates and normalizes them; the renderer adapter applies the supported settings to its backend.

## Texture color spaces

Use these color spaces for texture data:

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

## Environment

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

The world supplies the default look. Your app can override it, for example with an exposure control.

## Materials

Normalization fills in material defaults such as roughness, metalness, alpha mode, and shadow settings. Transparent or transmissive materials default to not casting an opaque shadow.

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

Anyo warns about lighting values likely to wash out or darken the scene. Check the result in your viewer as well.

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

Diagnostics identify unsupported material channels, color management, environment lighting, maps, and shadows. A missing environment-map asset is reported before rendering.

## Normalization API

```ts
import {
  normalizeEnvironmentDefinition,
  normalizeMaterialDefinition,
  normalizeWorldDocument,
} from '@blcklab/anyo'
```

Use the normalized values in renderer adapters so each backend starts from the same defaults.
