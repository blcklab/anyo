# Data and updates

Use data bindings for changing content, entity updates for individual objects, and patches for edits to the world document.

## Bindings

A `$bind` expression reads a value from the root `data` object:

```json
{
  "$bind": "store.inventory",
  "format": "{value} available",
  "fallback": 0
}
```

Supported bound entity fields include:

- `content`
- `src`
- `color`
- `intensity`
- `visible`
- asset `src`

Bindings also resolve inside nested extension fields.

## Updating data

`setData()` updates runtime values and their bindings. It does not change saved world JSON unless you call `world.commitRuntimeData()`.

```ts
await world.setData('store.inventory', 8)
```

Array paths are supported:

```ts
await world.setData('products[0].price', 1999)
```

Read current data:

```ts
world.getData('products[0].price')
```

## Updating one entity

```ts
await world.updateEntity('title', {
  content: 'New title',
  visible: true,
})
```

Anyo recompiles the changed renderable fields and sends them to the adapter. Use `world.patch()` for structural changes such as adding entities or resizing rooms.

## Patching the document

```ts
await world.patch([
  {
    operation: 'replace',
    path: '/building/floors/0/rooms/0/size/0',
    value: 14
  },
  {
    operation: 'add',
    path: '/entities/-',
    value: {
      id: 'new-display',
      type: 'box',
      position: [0, 1, 0]
    }
  }
])
```

Patches update the source document, which is then validated, normalized, and compiled. Anyo sends incremental changes when possible and remounts when the change requires rebuilding.

For movement every frame, use [runtime transforms](runtime-systems.md) instead of repeatedly editing the document.
