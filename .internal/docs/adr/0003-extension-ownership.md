# ADR 0003: Specialized Runtime Systems Stay in Extensions

**Status:** Accepted

Anyo core provides extension requirements, capability manifests, schema/validation/migration hooks, action registration, and snapshot hooks. Physics, animation, audio, avatar, VFX, hologram, networking, and commerce implementations remain in specialized packages or host code.

World JSON never causes package installation or dynamic import by package name.
