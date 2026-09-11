# World schema

The current world-document version is `0.7`. It is separate from the npm package version, currently `0.10.0-rc.1`.

Both `@blcklab/anyo/schema` and `@blcklab/anyo/schema/0.7` export `schemas/world-0.7.schema.json`.

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.7.schema.json",
  "version": "0.7",
  "revision": 0,
  "entities": []
}
```

Buildings are optional, so empty and entity-only worlds are valid. Older supported documents migrate to 0.7; see [migration details](migrations/MIGRATION_WORLD_0.7.md).

## Main fields

| Purpose | Fields |
| --- | --- |
| Identity and metadata | `$schema`, `version`, `revision`, `units`, `metadata` |
| Content | `building`, `entities`, `prefabs`, `assets`, `materials` |
| Presentation | `environment`, `cameras`, `activeCamera`, `channels` |
| Runtime configuration | `data`, `exploration`, `visibility` |
| Extensions | `extensions` |

See the [schema](../schemas/world-0.7.schema.json) for the complete field definitions. JSON Schema checks document shape; registered plugins and semantic validation check references and behavior.

## Authoring identity

An entity's optional `authoringId` identifies its editable source declaration. Runtime IDs may change after prefab or repeat expansion; a persisted authoring ID lets an editor keep track of the same object.

Repeated instances carry compiler provenance. Detach an instance into an ordinary entity before editing it independently. See [editor APIs](editor-contract.md).

## Web-surface targets

A web surface can target a `plane`, a room `wall`, an `entity-slot`, or a `mesh`. An `anyo.surface-host` component declares named slots with a mesh name and non-negative material-slot index. Resolved slots default to UV set `0`.

References such as `$self`, `$parent`, and their child paths resolve after prefab expansion. Store these IDs and options in JSON; keep DOM nodes, textures, renderer handles, and functions in the host application. See [web surfaces](web-surfaces.md).

## Validation modes

Use `inspectWorldDocument()` to get diagnostics before loading a world:

```ts
import { inspectWorldDocument } from '@blcklab/anyo'

const result = inspectWorldDocument(worldDocument, {
  mode: 'production',
  rendererInfo: renderer.info
})

for (const issue of result.errors) {
  console.error(issue.code, issue.path, issue.message)
}
```

This example assumes your document is in `worldDocument` and you have a renderer instance. Pass `actionRegistry`, `webSurfaceRegistry`, `componentTypeRegistry`, and `entityTypeRegistry` when checking content that uses those registrations. Use `handledComponents` to identify components handled by installed systems.

| Mode | Use |
| --- | --- |
| `permissive` | Load older or partially supported content; report warnings where a fallback is safe. |
| `production` | Reject missing required references, registrations, and renderer capabilities. |
| `generator` | Also reject unknown stable fields; store custom data in namespaced extensions. |

The same checks can run during loading:

```ts
import { createWorld } from '@blcklab/anyo'

const world = createWorld({
  renderer,
  validation: { mode: 'production' }
})
```

Actions registered with `world.registerAction()` are included automatically in load-time validation. Errors include diagnostic codes and JSON Pointer paths for locating the problem.
