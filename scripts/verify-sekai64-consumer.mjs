import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sekaiTarball = process.env.SEKAI64_TARBALL
if (!sekaiTarball) throw new Error('Set SEKAI64_TARBALL to the exact validated @blcklab/sekai64 npm tarball.')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'anyo-sekai64-consumer-'))
try {
  const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
  if (pack.status !== 0) throw new Error(pack.stderr || pack.stdout)
  const metadata = JSON.parse(pack.stdout)[0]
  const anyoTarball = path.join(temporary, metadata.filename)
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ name: 'anyo-sekai64-consumer', private: true, type: 'module' }, null, 2))
  const install = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--legacy-peer-deps', anyoTarball, path.resolve(sekaiTarball)], { cwd: temporary, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000 })
  if (install.status !== 0) throw new Error(install.stderr || install.stdout)
  await writeFile(path.join(temporary, 'smoke.mjs'), `
    import { createWorld } from '@blcklab/anyo'
    import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'
    import { Engine } from '@blcklab/sekai64'
    if (typeof createWorld !== 'function' || typeof Sekai64Renderer !== 'function' || typeof Engine !== 'function') process.exit(1)
  `)
  const smoke = spawnSync(process.execPath, ['smoke.mjs'], { cwd: temporary, encoding: 'utf8' })
  if (smoke.status !== 0) throw new Error(smoke.stderr || smoke.stdout)
  const packageJson = JSON.parse(await readFile(path.join(temporary, 'node_modules/@blcklab/anyo/package.json'), 'utf8'))
  console.log(`Verified packed consumer: ${packageJson.name}@${packageJson.version} with exact Sekai64 tarball.`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
