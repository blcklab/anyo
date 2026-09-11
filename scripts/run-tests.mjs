import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entries = await readdir(join(root, 'tests'), { withFileTypes: true })
const unsupported = entries.filter(entry => entry.isFile() && /\.test\.[cm]?[jt]s$/.test(entry.name) && !entry.name.endsWith('.test.mjs'))
if (unsupported.length) {
  throw new Error(`Convert these tests to .test.mjs so the suite can run them: ${unsupported.map(entry => entry.name).join(', ')}`)
}
const tests = entries
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map(entry => `tests/${entry.name}`)
  .sort()
if (!tests.length) throw new Error('No .test.mjs files found in tests/.')

// Forward slashes and explicit filenames also work from Windows and UNC paths.
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...tests], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  timeout: 120_000
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
