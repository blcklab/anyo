import type { EntityDefinition, WorldDocument } from '../core/types.js'

export type AnyoPrefabDefinitions = NonNullable<WorldDocument['prefabs']>

function child(entity: EntityDefinition): EntityDefinition {
  return entity
}

/**
 * Renderer-neutral starter prefabs for anime streets and compact neighborhoods.
 * Materials are intentionally referenced by semantic ids so a project can own its palette.
 */
export function createAnimeUrbanPrefabKit(): AnyoPrefabDefinitions {
  return {
    'anime-utility-pole': {
      type: 'group',
      children: [
        child({ id: 'mast', type: 'cylinder', radius: 0.14, height: 8.5, position: [0, 4.25, 0], material: 'utility-dark', collision: true }),
        child({ id: 'crossarm-a', type: 'box', size: [2.8, 0.16, 0.18], position: [0, 7.25, 0], material: 'utility-dark' }),
        child({ id: 'crossarm-b', type: 'box', size: [2.1, 0.14, 0.16], position: [0, 6.6, 0], material: 'utility-dark' }),
        child({ id: 'lamp-arm', type: 'box', size: [1.55, 0.1, 0.1], position: [0.68, 5.65, 0], material: 'utility-dark' }),
        child({ id: 'lamp', type: 'box', size: [0.42, 0.18, 0.25], position: [1.42, 5.53, 0], material: 'lamp-warm' }),
      ],
    },
    'anime-street-tree': {
      type: 'group',
      children: [
        child({ id: 'trunk', type: 'cylinder', radius: 0.2, height: 2.5, position: [0, 1.25, 0], material: 'tree-trunk', collision: true }),
        child({ id: 'crown-a', type: 'plane', size: [3.2, 3.2], position: [0, 3.25, 0], material: 'foliage', rotation: [0, 0, 0] }),
        child({ id: 'crown-b', type: 'plane', size: [3.2, 3.2], position: [0, 3.25, 0], material: 'foliage', rotation: [0, 1.5707963268, 0] }),
        child({ id: 'crown-c', type: 'plane', size: [2.7, 2.7], position: [0, 3.7, 0], material: 'foliage-light', rotation: [0, 0.7853981634, 0] }),
      ],
    },
    'anime-street-lamp': {
      type: 'group',
      children: [
        child({ id: 'post', type: 'cylinder', radius: 0.09, height: 4.1, position: [0, 2.05, 0], material: 'utility-dark', collision: true }),
        child({ id: 'arm', type: 'box', size: [0.95, 0.08, 0.08], position: [0.42, 3.9, 0], material: 'utility-dark' }),
        child({ id: 'shade', type: 'box', size: [0.38, 0.16, 0.28], position: [0.88, 3.78, 0], material: 'lamp-warm' }),
        child({ id: 'light', type: 'light', lightType: 'point', color: '#ffd8a8', intensity: 1.5, range: 8, position: [0.88, 3.66, 0] }),
      ],
    },
    'anime-shop-sign': {
      type: 'group',
      children: [
        child({ id: 'bracket', type: 'box', size: [0.75, 0.08, 0.08], position: [0.34, 0, 0], material: 'utility-dark' }),
        child({ id: 'panel', type: 'box', size: [0.72, 1.05, 0.1], position: [0.72, -0.48, 0], material: 'sign-panel' }),
        child({ id: 'label', type: 'text', content: 'SORA', position: [0.72, -0.48, 0.061], style: { fontSize: 42, fontWeight: 700, color: '#fff7ef', align: 'center', resolution: 512 } }),
      ],
    },
  }
}
