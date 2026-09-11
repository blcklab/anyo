import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')

async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory)) {
    const full = path.join(directory, entry)
    const info = await stat(full)
    if (info.isDirectory()) files.push(...await walk(full))
    else if (entry.endsWith('.ts')) files.push(full)
  }
  return files
}

const threeViolations = []
const sekaiViolations = []
const dynamicCodeViolations = []
for (const file of await walk(src)) {
  const relative = path.relative(src, file).replaceAll('\\', '/')
  const source = await readFile(file, 'utf8')
  const importsThree = /(?:from\s+|import\()['"]three(?:\/|['"])/.test(source)
  const importsSekai = /(?:from\s+|import\()['"]@blcklab\/sekai64(?:\/|['"])/.test(source)
  if (importsThree && !relative.startsWith('renderer-three/') && relative !== 'three-shim.d.ts') threeViolations.push(relative)
  if (importsSekai && !relative.startsWith('renderer-sekai64/')) sekaiViolations.push(relative)
  if (/\bnew\s+Function\s*\(|\beval\s*\(/.test(source)) dynamicCodeViolations.push(relative)
}

if (threeViolations.length || sekaiViolations.length || dynamicCodeViolations.length) {
  if (threeViolations.length) console.error(`Three.js leaked outside renderer-three:\n${threeViolations.map((file) => `- ${file}`).join('\n')}`)
  if (sekaiViolations.length) console.error(`Sekai64 leaked outside renderer-sekai64:\n${sekaiViolations.map((file) => `- ${file}`).join('\n')}`)
  if (dynamicCodeViolations.length) console.error(`Forbidden dynamic code evaluation found:\n${dynamicCodeViolations.map((file) => `- ${file}`).join('\n')}`)
  process.exit(1)
}
console.log('Verified renderer boundaries: Anyo core imports neither Three.js nor Sekai64, and source contains no eval/new Function.')
