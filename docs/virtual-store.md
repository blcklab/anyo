# Virtual store guide

Anyo controls space and interaction plumbing. Your application controls products, inventory, cart state, routing, analytics, and checkout.

## Recommended layers

```text
building.json      rooms, doors, windows, stairs
fixtures.json      shelves, counters, displays
products.json      product entities and metadata
experience.json    text, triggers, lighting
application code   cart, API, checkout, UI
```

## Product entity

```json
{
  "id": "shoe-black",
  "type": "model",
  "asset": "shoe",
  "room": "main-store",
  "position": [0, 1.2, 0],
  "interaction": {
    "action": "inspect-product",
    "params": {
      "sku": "SHOE-001"
    }
  },
  "data": {
    "category": "shoes"
  }
}
```

## Application action

```ts
world.registerAction('inspect-product', async ({ sku }) => {
  const product = await api.products.get(String(sku))
  productPanel.open(product)
})
```

## Inventory labels

Use `$bind` for values that should update with application data:

```ts
await world.setData('store.inventory', inventory)
```

## Performance recommendations

- use prefabs for repeated fixtures
- use low-poly glTF assets
- use entity LOD for detailed products
- keep architecture procedural
- do not add collision to small products unless necessary
- split large stores into connected rooms so portal visibility can hide unreachable chunks
