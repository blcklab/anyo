import { readdir, readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist', 'esm')

async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory)) {
    const full = path.join(directory, entry)
    const info = await stat(full)
    if (info.isDirectory()) files.push(...await walk(full))
    else if (entry.endsWith('.js')) files.push(full)
  }
  return files
}

const files = await walk(dist)
let raw = 0
let gzip = 0
for (const file of files) {
  const content = await readFile(file)
  raw += content.length
  gzip += gzipSync(content).length
}

console.log(`ESM JavaScript: ${(raw / 1024).toFixed(1)} kB raw, ${(gzip / 1024).toFixed(1)} kB gzip across ${files.length} modules.`)
