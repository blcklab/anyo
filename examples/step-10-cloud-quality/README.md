# Step 10 — generic cloud quality showcase

This scene demonstrates cloud quality without adding a cloud-specific engine abstraction.

- Large / medium / small lobe hierarchy is authored with shared `lathe + noise` geometry resources.
- The lathe profiles intentionally begin with a broad low ring, while `startCap` material bindings keep cloud bases visually cooler and flatter.
- PBR roughness + sheen let the existing sun and atmosphere produce warm/cool cloud response.
- Three cloud masses reuse one composition and three geometry resources instead of generating unique meshes per cloud.
- Natural drift is authored through the existing `anyo.animation` property-track contract. Use the frozen `@blcklab/anyo-animation@0.1.3` runtime to execute those tracks; no second cloud animation system is introduced.
- The procedural environment sky remains a distant cloud layer. Sekai64 Step 10 improves that existing resource with multi-scale structure and directional warm/cool shading.

The scene is intentionally a cloud-focused overlook rather than the integrated Step 12 world.
