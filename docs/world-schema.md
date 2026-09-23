# World schema

The default package schema remains the stable 0.7 contract:

```txt
@blcklab/anyo/schema
@blcklab/anyo/schema/0.7
schemas/world-0.7.schema.json
```

Use 0.7 for existing primitive/building worlds:

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.7.schema.json",
  "version": "0.7"
}
```

S14 adds the opt-in 0.8 procedural authoring contract:

```txt
@blcklab/anyo/schema/0.8
schemas/world-0.8.schema.json
```

```json
{
  "$schema": "./node_modules/@blcklab/anyo/schemas/world-0.8.schema.json",
  "version": "0.8"
}
```

`building` remains optional. Entity-only and empty worlds remain valid. Existing 0.2 through 0.6 documents migrate automatically to 0.7; 0.7 is not silently promoted to 0.8.

## Top-level fields

Stable fields include:

- `$schema`
- `version`
- `revision`
- `units`
- `metadata`
- `data`
- `environment`
- `rendering`
- `cameras`
- `activeCamera`
- `channels`
- `requires`
- `events`
- `materials`
- `assets`
- `prefabs`
- `building`
- `entities`
- `exploration`
- `visibility`
- `extensions`

World 0.8 additionally accepts reusable top-level `geometries`.

## Procedural authoring in 0.8

A reusable geometry definition is referenced by a normal stable entity id:

```json
{
  "version": "0.8",
  "geometries": {
    "desk": {
      "kind": "roundedBox",
      "size": [5.4, 1.05, 1.1],
      "radius": 0.08
    }
  },
  "entities": [
    {
      "id": "reception",
      "type": "geometry",
      "geometry": "desk",
      "material": "graphite"
    }
  ]
}
```

`geometry` may also be an inline GeometryDefinition. `materialBindings` exposes the existing semantic geometry-region system, and `type: "construction"` accepts the existing S7 ArchitectureDefinition. These declarations compile internally to the content-addressed ResourceGraph; they do not introduce renderer-specific object types.

Procedural entities may also opt into the existing Anyo collision system with `collision: true` or the more explicit schema-0.8 `collisionPolicy` field. `geometry` supports transformed `bounds` collision. S7 `construction` supports `semantic`/`parts` collision, which lowers the same solid parts used by construction so wall door/window openings remain traversable. `none` disables procedural collision.

See `docs/migrations/MIGRATION_WORLD_0.8.md` for the full S14 contract and compatibility boundary.

## Authoring identity

Entities may contain an optional `authoringId`. It is a stable, renderer-independent identity used by editor sessions and picking bridges. Runtime IDs can change after prefab or repeat expansion, while `authoringId` identifies the editable source declaration.

Generated repeat instances expose compiler provenance but are not directly editable until an authoring tool detaches them into ordinary entities.

## Assets, components, and materials

Typed assets, namespaced components, and texture-backed material contracts remain renderer-neutral. Asset decoding remains the responsibility of a compatible renderer or registered loader.

The JSON Schema validates document shape. Anyo semantic validation then verifies references and registered capabilities. For world 0.8 this includes named geometry references and semantic material-binding references.

## Web Surface target intent

Web Surface definitions may include an optional renderer-neutral `target`:

- `plane`: current transform and size behavior; an optional target size overrides the plane dimensions.
- `wall`: room and wall intent with an optional two-dimensional offset.
- `entity-slot`: a named slot declared by an `anyo.surface-host` component.
- `mesh`: a direct entity, optional mesh name, material-slot index, and UV-set index.

`anyo.surface-host` is a built-in component. Each slot requires a mesh name and non-negative material-slot index; `uvSet` defaults to `0` when resolved.

Local target references `$self`, `$parent`, `$self/...`, and `$parent/...` are normalized after prefab expansion. No DOM node, renderer object, function, texture, mesh handle, or GPU resource is serialized into world JSON.

## Semantic validation modes

Anyo keeps backward-compatible permissive loading while offering stricter validation for deployment and generated worlds:

```ts
const result = inspectWorldDocument(document, {
  mode: 'generator',
  actionRegistry,
  webSurfaceRegistry,
  componentTypeRegistry,
  entityTypeRegistry,
  handledComponents: new Set(['anyo.animation']),
  rendererInfo: renderer.info,
})
```

Modes:

- `permissive`: unresolved optional behavior and unknown stable fields produce warnings where safe.
- `production`: missing required references, registrations, and renderer capabilities are errors.
- `generator`: strictest mode; unknown stable fields are errors unless data is stored in a namespaced extension contract.

Semantic validation covers room, floor, material, asset, geometry, prefab, opening, spawn, binding, action, web-application, custom-component, custom-entity, model-format, and material-texture references. Validation returns structured diagnostic codes and JSON-pointer paths.

A world may opt into the same checks during loading:

```ts
const world = createWorld({
  renderer,
  validation: {
    mode: 'production',
    webSurfaceRegistry,
    componentTypeRegistry,
    entityTypeRegistry,
  },
})
```

Actions registered through `world.registerAction()` are included automatically when the world validates during `load()`.
