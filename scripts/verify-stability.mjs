import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
assert.equal(pkg.version, '0.10.0-rc.1')
assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'Anyo core must keep zero runtime dependencies.')

const expectedSubpaths = [
  '.', './assets', './building', './components', './core', './document', './editor', './entities', './explore', './explore-xr', './history', './interactions', './migrations', './package.json', './presets', './renderer', './renderer-sekai64', './renderer-three', './schema', './schema/0.2', './schema/0.3', './schema/0.3.1', './schema/0.4', './schema/0.5', './schema/0.6', './schema/0.7', './snapshots', './systems', './validation', './visibility', './web-surface', './zones',
].sort()
assert.deepEqual(Object.keys(pkg.exports).sort(), expectedSubpaths)

const expectedRoot = `ANYO_TEXTURE_COLOR_SPACES ANYO_VISUAL_DEFAULTS ANYO_VISUAL_PRESETS ActionRegistry AnyoValidationError AssetTypeRegistry AudioZoneSystem CollisionWorld ComponentTypeRegistry DocumentHistory EditorSession EntityTypeRegistry EventBus ExtensionRegistry FirstPersonController InteractionManager LodSystem PortalVisibilitySystem RuntimeTransformStore SystemScheduler TeleportSystem TriggerSystem World WorldQuery XRExplorationController applyJsonPatchValue applyStableTransaction applyVisualPreset assetsPlugin buildCompilerDependencyGraph buildingPlugin canonicalSnapshotString canonicalWorldString canonicalizeJson canonicalizeWorldDocument cloneWorldDocument compileBuilding compileCameras compileEntities compileWorldChannels createAnimeUrbanPrefabKit createAssetTypeRegistry createComponentTypeRegistry createEditorSession createEntityTypeRegistry createPortableWorldPackageDescriptor createPortableWorldPackageManifest createWorld createWorldSchema decomposeWall entitiesPlugin explorableBuildingPreset explorePlugin findEntityInDocument findEntityInList getVisualPreset hashWorldDocument inspectArchitectureDocument inspectAssetManifest inspectWorldDocument inspectWorldRuntimeSnapshot inspectWorldSemantics interactionsPlugin migrateWorldDocument normalizeEnvironmentDefinition normalizeMaterialDefinition normalizeWorldDocument registerBuiltInAssetTypes registerBuiltInComponents resolveAssetVariant resolveChannelMask resolveEntityComponents resolveRenderingConfiguration resolveSurfaceTransform serializeWorldDocument validateAssetEcosystem validateWorldDocument validateWorldRuntimeSnapshot visibilityPlugin xrExplorationPlugin zonesPlugin`.split(' ').sort()
const expectedWebSurface = `WebSurfaceAppRegistry WebSurfaceRuntime compileWebSurfaceTarget createWebSurfaceAppRegistry getWebSurfaceHostSlot projectWebSurface resolveWebSurfaceTarget resolveWebSurfaceTargetEntity webSurfacePlugin`.split(' ').sort()
const expectedSekaiBridge = `Sekai64CameraAdapter Sekai64FrameDriver Sekai64Renderer Sekai64XRBridge toSekaiTextOptions`.split(' ').sort()

const esmRoot = await import(new URL('dist/esm/index.js', root))
const esmWebSurface = await import(new URL('dist/esm/web-surface/index.js', root))
const esmSekai = await import(new URL('dist/esm/renderer-sekai64/index.js', root))
assert.deepEqual(Object.keys(esmRoot).sort(), expectedRoot)
assert.deepEqual(Object.keys(esmWebSurface).sort(), expectedWebSurface)
assert.deepEqual(Object.keys(esmSekai).sort(), expectedSekaiBridge)

const require = createRequire(import.meta.url)
const cjsRoot = require(fileURLToPath(new URL('dist/cjs/index.js', root)))
const cjsWebSurface = require(fileURLToPath(new URL('dist/cjs/web-surface/index.js', root)))
assert.deepEqual(Object.keys(cjsRoot).sort(), expectedRoot)
assert.deepEqual(Object.keys(cjsWebSurface).sort(), expectedWebSurface)

const rendererTypes = await readFile(new URL('dist/types/core/types.d.ts', root), 'utf8')
assert.ok(rendererTypes.includes('interface RendererAdapter'), 'RendererAdapter declaration must remain published.')
assert.ok(!rendererTypes.includes('createDynamicTexture'), 'Dynamic texture creation must not become a mandatory RendererAdapter method.')
const surfaceTypes = rendererTypes + (await readFile(new URL('dist/types/web-surface/index.d.ts', root), 'utf8')) + (await readFile(new URL('dist/types/web-surface/target.d.ts', root), 'utf8')) + (await readFile(new URL('dist/types/web-surface/registry.d.ts', root), 'utf8'))
for (const name of ['WebSurfaceTarget', 'WebSurfacePresentation', 'RegisteredWebSurfaceApp']) assert.ok(surfaceTypes.includes(name), `${name} must remain declared.`)

console.log('Verified Anyo 0.10 Track A JSON-first, schema, validation, renderer, and Web Surface contracts.')
