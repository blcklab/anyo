import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const missing = []

function collect(value) {
  if (typeof value === 'string') {
    if (value.startsWith('./dist/') || value.startsWith('./schemas/')) return [value]
    return []
  }
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(collect)
}

const paths = new Set([
  packageJson.main,
  packageJson.module,
  packageJson.types,
  ...collect(packageJson.exports),
].filter(Boolean))

for (const relative of paths) {
  const file = path.join(root, relative.replace(/^\.\//, ''))
  try {
    await access(file)
  } catch {
    missing.push(relative)
  }
}

if (missing.length > 0) {
  console.error(`Missing package export files:\n${missing.map((item) => `- ${item}`).join('\n')}`)
  process.exit(1)
}

console.log(`Verified ${paths.size} package export files.`)
