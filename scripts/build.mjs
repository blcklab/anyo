import { mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
await rm(dist, { recursive: true, force: true })

for (const config of ['tsconfig.build.esm.json', 'tsconfig.build.cjs.json', 'tsconfig.build.types.json']) {
  const result = spawnSync('tsc', ['-p', config], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await mkdir(path.join(dist, 'cjs'), { recursive: true })
await writeFile(path.join(dist, 'cjs', 'package.json'), '{"type":"commonjs"}\n')
await unlink(path.join(dist, 'types', 'three-shim.d.ts')).catch(() => undefined)
await unlink(path.join(dist, 'types', 'three-shim.d.ts.map')).catch(() => undefined)
