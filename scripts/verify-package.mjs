import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'anyo-pack-'))

try {
  const result = spawnSync('npm', ['pack', '--json', '--pack-destination', temporary], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error(result.stdout)
    console.error(result.stderr)
    process.exit(result.status ?? 1)
  }
  const metadata = JSON.parse(result.stdout)[0]
  const names = new Set(metadata.files.map((file) => file.path))
  for (const required of [
    'dist/esm/index.js',
    'dist/cjs/index.js',
    'dist/types/index.d.ts',
    'schemas/world-0.4.schema.json',
    'schemas/world-0.7.schema.json',
    'dist/esm/snapshots/index.js',
    'dist/esm/geometry/index.js',
    'dist/cjs/geometry/index.js',
    'dist/types/geometry/index.d.ts',
    'dist/esm/resources/index.js',
    'dist/cjs/resources/index.js',
    'dist/types/resources/index.d.ts',
    'dist/cjs/snapshots/index.js',
    'dist/types/snapshots/index.d.ts',
    'dist/esm/renderer-sekai64/index.js',
    'dist/types/renderer-sekai64/index.d.ts',
    'dist/esm/explore-xr/index.js',
    'dist/cjs/explore-xr/index.js',
    'dist/types/explore-xr/index.d.ts',
    'README.md',
    'docs/README.md',
    'docs/migrations/MIGRATION_WORLD_0.7.md',
    'docs/entities.md',
    'docs/geometry.md',
    'docs/resources.md',
    'docs/sekai64.md',
    'docs/production.md',
    'LICENSE',
  ]) {
    if (!names.has(required)) throw new Error(`Packed artifact is missing ${required}.`)
  }
  if ([...names].some((name) => name.startsWith('src/') || name.startsWith('tests/') || name.startsWith('.internal/') || name.startsWith('vendor/'))) {
    throw new Error('Packed artifact unexpectedly contains source or test files.')
  }

  const esm = await import(pathToFileURL(path.join(root, 'dist/esm/index.js')).href)
  if (typeof esm.createWorld !== 'function' || typeof esm.migrateWorldDocument !== 'function' || typeof esm.applyStableTransaction !== 'function' || typeof esm.createPortableWorldPackageDescriptor !== 'function') {
    throw new Error('ESM root export smoke test failed.')
  }

  const cjs = await import(pathToFileURL(path.join(root, 'dist/cjs/index.js')).href)
  if (typeof (cjs.default ?? cjs).createWorld !== 'function') {
    throw new Error('CommonJS root export smoke test failed.')
  }

  const geometry = await import(pathToFileURL(path.join(root, 'dist/esm/geometry/index.js')).href)
  if (typeof geometry.compileGeometry !== 'function' || typeof geometry.GeometryCache !== 'function') throw new Error('Geometry export smoke test failed.')

  const resources = await import(pathToFileURL(path.join(root, 'dist/esm/resources/index.js')).href)
  if (typeof resources.createResourceGraphBuilder !== 'function' || typeof resources.ResourceGraph !== 'function') throw new Error('Resources export smoke test failed.')

  const sekai = await import(pathToFileURL(path.join(root, 'dist/esm/renderer-sekai64/index.js')).href)
  if (typeof sekai.Sekai64Renderer !== 'function') throw new Error('Sekai64 renderer export smoke test failed.')

  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  if (packageJson.peerDependencies?.['@blcklab/sekai64'] !== '>=0.7.0 <0.8.0 || >=0.8.0-0 <0.9.0' || packageJson.peerDependenciesMeta?.['@blcklab/sekai64']?.optional !== true) {
    throw new Error('Sekai64 must remain an optional >=0.7.0 <0.8.0 || >=0.8.0-0 <0.9.0 peer dependency.')
  }
  console.log(`Verified npm package ${packageJson.name}@${packageJson.version}: ${metadata.size} bytes compressed.`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
