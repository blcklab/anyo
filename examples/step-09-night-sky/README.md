# Step 09 — Procedural Night Sky

This showcase proves deterministic night-sky stars through the existing Anyo environment/sky architecture.

The `sky.stars` block describes only generic author intent: density, intensity, brightness variation, size variation, color-temperature variation, and seed. Sekai64 turns that intent into one deterministic HDR procedural environment resource and draws that environment with one optional fullscreen background pass.

The scene intentionally disables clouds and sunlight so star stability and exposure are easy to inspect while moving and rotating the camera. The observatory/platform geometry is ordinary Anyo content and is not part of the star implementation.

There is no `StarSystem`, no star entity/node population, no per-frame star simulation, and no backend-specific star vocabulary in world JSON. Existing procedural skies without `stars` preserve their previous behavior.
