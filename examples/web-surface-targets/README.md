# Web Surface target foundation

This example demonstrates RC.5 renderer-neutral targets:

- a wall target using the current plane/snapshot fallback;
- a reusable monitor prefab;
- an `anyo.surface-host` slot on the monitor model;
- `$parent/body` resolving independently for each prefab instance;
- host-registered application content with a native snapshot fallback.

The example intentionally does not upload a live app to a GPU texture. Dynamic textures and material replacement begin in WS3 and the optional texture package.
