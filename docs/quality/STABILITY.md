# Anyo 0.9 Stability Contract

Anyo 0.9.0 freezes the renderer-neutral world and Web Surface contracts proven through WS0–WS10.

## Guaranteed through the 0.9 line

- Existing 0.2–0.6 world documents continue to normalize or migrate without requiring advanced packages.
- Existing root and documented subpath imports remain available.
- `RendererAdapter` gains no new mandatory method during the 0.9 line.
- Existing registered Web Surface applications remain valid.
- `target` and `presentation` remain optional; legacy surfaces keep the plane/overlay path.
- DOM, renderer, GPU, executable functions, and private application state are never serialized into world JSON.
- Normal imports remain DOM-free and SSR-safe.
- Unsupported advanced presentation degrades to overlay, snapshot, or external-link behavior.

## Optional ecosystem

`@blcklab/anyo-web-surface-texture` and `@blcklab/anyo-hologram` are optional packages. Anyo core has no runtime dependency on either package or on Sekai64.

## Compatibility policy

Bug fixes and additive diagnostics may ship in 0.9.x. Breaking document, renderer, target, presentation, or application-contract changes require a new minor line and migration notes.
