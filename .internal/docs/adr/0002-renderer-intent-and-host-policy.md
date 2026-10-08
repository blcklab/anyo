# ADR 0002: Separate Renderer Intent From Host Policy

**Status:** Accepted

World JSON may declare quality, exposure, tone mapping, shadow, antialiasing, pixel-ratio, capability, and post-processing intent. Hosts retain authority over actual device/backend selection, limits, battery policy, accessibility, canvas ownership, and fallback behavior.

`resolveRenderingConfiguration()` produces deterministic resolved configuration and diagnostics.
