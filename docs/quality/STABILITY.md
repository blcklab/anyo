# Compatibility

The package is currently `0.10.0-rc.1`, and the current world schema is `0.7`. Pin a tested package version while using release candidates and check the [changelog](../../CHANGELOG.md) before upgrading.

## Existing worlds and integrations

Earlier supported world documents migrate to 0.7 through the public migration API. Existing JSON Pointer patches remain available alongside stable-ID transactions. See the [migration guide](../migrations/MIGRATION_WORLD_0.7.md).

Web-surface `target` and `presentation` remain optional. Existing registered apps and plane/overlay surfaces continue to work. When advanced presentation is unavailable, integrations use overlay, snapshot, or external-link fallbacks.

World JSON contains authored data. DOM nodes, GPU resources, renderer objects, functions, and private application state stay outside it. Core imports remain usable in headless and server environments.

## Optional packages

Sekai64, Three.js, `@blcklab/anyo-web-surface-texture`, and `@blcklab/anyo-hologram` are optional integrations. Your app installs the packages it uses; Anyo core does not load them from names found in world JSON.

## The 0.9 compatibility policy

The 0.9 line preserved documented imports, existing web-surface app contracts, and the required renderer-adapter methods. Bug fixes and additive diagnostics could ship in 0.9.x; breaking changes required a new minor line and migration notes. That policy describes 0.9 and should not be read as a blanket stability guarantee for later release candidates.
