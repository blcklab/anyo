import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const required = ['.internal/docs/track-f-production-validation.md', 'tests/track-f-production.test.mjs', 'scripts/benchmark-track-f.mjs']
for (const relative of required) {
  const info = await stat(path.join(root, relative))
  if (!info.isFile()) throw new Error(`Missing Track F file: ${relative}`)
}
const source = await readFile(path.join(root, 'tests/track-f-production.test.mjs'), 'utf8')
for (const token of ['10_000', 'applyStableTransaction', 'hashWorldDocument', 'buildCompilerDependencyGraph']) {
  if (!source.includes(token)) throw new Error(`Track F production test is missing ${token}.`)
}
console.log('Anyo Track F production-validation source gate passed.')
