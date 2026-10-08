# Sekai64 0.8 Compatibility Bridge

Anyo `0.9.1-rc.5` supports Sekai64 `>=0.7.0 <0.8.0 || >=0.8.0-0 <0.9.0`.

The only required runtime adaptation is disposal: Sekai64 0.8 can own asynchronous optional renderer modules, so `Sekai64Renderer.disposeAsync()` now awaits `Engine.disposeAsync()` when present and falls back to `Engine.dispose()` for Sekai64 0.7. Static rendering, Web Surface compilation, materials, picking, XR, world replacement, and renderer-neutral JSON contracts remain unchanged.
