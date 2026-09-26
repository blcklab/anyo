# Step 05 — Particle Quality

This example keeps the Step 4 generic `anyo.vfx` particle contract and demonstrates the Step 5 quality layer without semantic effect systems.

It uses normalized-lifetime `overLife` controls for size, opacity, color, and rotation on the same content recipes used for dust, rain, snow, embers, and fireflies. Those names are example labels only; there are no effect-specific engine branches.

Distance density/fade remains Sekai64 renderer policy through particle quality and generic emitter importance. True depth-aware soft intersection is intentionally not demonstrated at this checkpoint because the existing single main pass would need a separate opaque-depth resolve or transparent-particle pass to sample scene depth correctly.
