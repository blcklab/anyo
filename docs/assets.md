# Assets and material textures

Declare assets once and reference them by ID from entities and materials. Anyo checks the declarations and URLs; a renderer or registered loader decodes the files and cleans up their runtime resources.

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

Declaring a format does not install a decoder. Check your renderer's capabilities before using it; it may support only part of this list.

## Custom asset types

```ts
import { createWorld } from '@blcklab/anyo'
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

Material texture fields include `baseColorTexture`, `normalTexture`, `roughnessTexture`, `metalnessTexture`, `metallicRoughnessTexture`, `emissiveTexture`, and `occlusionTexture`. The Sekai64 adapter maps these to supported engine channels and reports them through `renderer.info.capabilities.materialTextureChannels`. Anyo checks required channels before mounting.

## Sekai64 loader registration

The Anyo adapter registers glTF/GLB loading by default. Supply an asset loader for other formats, even if the underlying renderer can decode them. Here, `canvas` and `vrmLoader` come from your application:

```ts
const renderer = new Sekai64Renderer({
  canvas,
  assetLoaders: [vrmLoader],
})
```

The loader receives `{ type, format, src, id, signal, options }` and returns a Sekai64 `Node`. The adapter manages cancellation, concurrency, diagnostics, and disposal, and ignores results from a world that has since been replaced.

## Security

Set trusted asset origins, a Content Security Policy, and request/size limits in your app. Keep credentials out of public JSON. See [security](../SECURITY.md).
