# Virtual stores

Use Anyo for the store layout and object interactions. Keep product data, inventory, carts, routing, analytics, and checkout in your application.

## Organize the content

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

Register the action referenced by the product. In this example, `api` and `productPanel` belong to your app:

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

## Keep the store responsive

- Reuse prefabs for shelves and other repeated fixtures.
- Keep product models small and use LOD for distant objects when the renderer supports it.
- Generate architecture from room definitions.
- Add product collision only where interaction requires it.
- Split large stores into connected rooms so portal visibility can hide rooms outside the visible portal chain.
