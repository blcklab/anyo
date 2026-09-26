# Step 08 — Generic Water Quality

This showcase proves water quality using the existing generic Anyo material path rather than a `WaterSystem`.

It contains four authored surfaces using the same `shadingModel: "water"` contract:

- a restrained pool;
- a softly moving lake;
- a directional river;
- a calm ocean surface.

The Step 08 additions are renderer-neutral author intent: `waveScale`, `waveStrength`, `waveSpeed`, `flowDirection`, and `foamStrength`. Sekai64 owns animation time, layered surface motion, Fresnel/specular response, and WebGL2/WebGPU execution.

`waveStrength` defaults to zero. Existing water documents therefore keep the pre-Step-08 static water path unless they opt into enhanced motion.

This milestone does **not** add scene-color refraction, a water render pass, ocean FFT simulation, or a `WaterSystem`. Those would be substantially larger rendering architectures and are outside Step 08.
