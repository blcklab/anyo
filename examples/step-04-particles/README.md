# Step 04 — generic particle rendering

This checkpoint scene deliberately authors five visually different effects—dust, rain, snow, embers, and fireflies—through the same renderer-neutral `anyo.vfx` sprite-particle contract.

The names are example/content labels only. The engine has no dust/rain/snow/ember/firefly rendering branches. Spawn, lifetime, velocity, forces, material, opacity, rotation, importance, and deterministic seed are the reusable vocabulary.

Step 4 provides basic camera-facing batched sprites and quality budgeting. Soft intersections and over-life appearance curves belong to Step 5 and are intentionally not part of this example yet.
