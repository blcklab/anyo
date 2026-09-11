# Runtime systems example

This example animates an entity through a `WorldSystem` and local additive transient transforms.

The source world JSON never changes, no history entries are created per frame, and Sekai64 receives one runtime-transform batch before each render.
