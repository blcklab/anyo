# Lights

Anyo uses one renderer-neutral `type: "light"` entity. World 0.9 supports four light kinds:

- `ambient`
- `directional`
- `point`
- `spot`

## Spot lights — World 0.9+

```json
{
  "id": "gallery-light",
  "type": "light",
  "lightType": "spot",
  "position": [2, 4, 1],
  "direction": [0, -1, 0],
  "color": "#fff1d8",
  "intensity": 3.5,
  "range": 14,
  "innerCone": 0.3,
  "outerCone": 0.65
}
```

`direction` is required for a spot light and is expressed in the light entity's local space. Entity, composition, and parent transforms therefore rotate the direction together with the light. The vector must be non-zero.

`innerCone` and `outerCone` are radians. `innerCone` is in `[0, PI/2]`, `outerCone` is in `(0, PI/2]`, and `innerCone` cannot exceed `outerCone`. If omitted, the renderer adapter may use its renderer-native defaults.

`range`, `color`, and `intensity` use the existing generic light contract. `castShadow` and `shadow` also remain generic authoring fields; renderer adapters report unsupported shadow behavior rather than introducing spotlight-only shadow syntax.

### Sekai64 rc.43 behavior

The Anyo Sekai64 adapter maps authored spot lights to Sekai64 `SpotLight`. WebGL2 and WebGPU both support spot-light shading. In the accepted Sekai64 rc.43 baseline:

- spot-light shadows are not rendered; requesting `castShadow` emits an Anyo renderer diagnostic and the light remains active without a shadow;
- spot-light distance-decay authoring is not configurable by the renderer shader yet; explicitly authoring `decay` emits a diagnostic while Sekai64 keeps its native spot falloff;
- the renderer's normal spot-light budget/selection behavior applies.

These limitations are renderer capabilities, not separate Anyo light types.

## Backward compatibility

World 0.8 remains unchanged. Existing ambient, directional, and point light documents continue to use their previous authoring and runtime paths.
