# Assets and material textures

Anyo assets are renderer-independent declarations. Anyo validates identity, type, format, references, fallbacks, and URLs. Renderers or registered loaders decode the resource and own runtime/GPU disposal.

```json
{
  "assets": {
    "avatar": {
      "type": "model",
      "format": "vrm",
      "src": "./characters/avatar.vrm",
      "preload": true,
      "options": { "humanoid": true }
    }
  }
}
```

## Built-in declaration types

- `model`: glTF, GLB, VRM, OBJ
- `texture`: PNG, JPEG, WebP, AVIF, KTX2
- `image`: PNG, JPEG, WebP, AVIF, SVG
- `audio`: MP3, OGG, WAV, M4A
- `video`: MP4, WebM
- `font`: WOFF, WOFF2, TTF, OTF
- `environment`: HDR, EXR and common image formats
- `data`: custom JSON-safe or external data resources

These are declaration contracts. A renderer may support only a subset and must report its real capabilities.

## Custom asset types

```ts
import {
  assetsPlugin,
  createAssetTypeRegistry,
} from '@blcklab/anyo/assets'

const registry = createAssetTypeRegistry()
registry.register({ type: 'point-cloud', formats: ['ply'] })

const world = createWorld({
  plugins: [assetsPlugin({ registry })],
})
```

## Relative URLs

When a document is loaded from `https://example.com/worlds/shop/world.anyo.json`, an asset source such as `./models/chair.glb` resolves to `https://example.com/worlds/shop/models/chair.glb` in normalized runtime state. Serialization preserves the author's relative URL.

## Material texture references

```json
{
  "assets": {
    "wood-color": {
      "type": "texture",
      "format": "webp",
      "src": "./textures/wood-color.webp"
    },
    "wood-normal": {
      "type": "texture",
      "format": "png",
      "src": "./textures/wood-normal.png"
    }
  },
  "materials": {
    "wood": {
      "baseColor": "#ffffff",
      "baseColorTexture": "wood-color",
      "normalTexture": "wood-normal",
      "roughness": 0.8,
      "metalness": 0,
      "alphaMode": "opaque",
      "doubleSided": false
    }
  }
}
```

Available declaration channels are `baseColorTexture`, `normalTexture`, `roughnessTexture`, `metalnessTexture`, `emissiveTexture`, and `occlusionTexture`. The current Sekai64 0.6.1 adapter renders base-color and normal textures and reports those exact channels. Anyo rejects a world before mount when a required renderer channel is unavailable.

## Sekai64 loader registration

Sekai64 includes glTF/GLB support. Other model formats remain optional:

```ts
const renderer = new Sekai64Renderer({
  canvas,
  assetLoaders: [vrmLoader],
})
```

The loader receives `{ type, format, src, id, signal, options }` and returns a Sekai64 `Node`. Abort signals, stale completion protection, bounded concurrency, diagnostics, and disposal remain managed by the adapter.

## Security

Host applications should allowlist asset origins, apply CSP, enforce size/request limits, and keep credentials out of public JSON. Anyo never executes asset-provided scripts.
