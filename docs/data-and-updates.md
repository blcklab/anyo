# Data and runtime updates

## Bindings

A binding object replaces itself with data from the root `data` object:

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

The resolver also works recursively in extension fields.

## Updating data

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

Renderable fields are recompiled and sent to the renderer adapter. Structural changes should use `world.patch()`.

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

Patches are applied to the original source document, then the world is validated, normalized, compiled, and remounted.
