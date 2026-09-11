import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import {
  applyStableTransaction,
  buildCompilerDependencyGraph,
  canonicalWorldString,
  createPortableWorldPackageDescriptor,
  hashWorldDocument,
  inspectWorldDocument,
  normalizeWorldDocument,
} from '../dist/esm/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entityCount = Number(process.env.ANYO_TRACK_A_ENTITIES ?? 10_000)
const entities = Array.from({ length: entityCount }, (_, index) => ({
  id: `entity-${index}`,
  authoringId: `author:${index}`,
  type: index % 100 === 0 ? 'model' : 'box',
  material: `material-${index % 32}`,
  asset: index % 100 === 0 ? `asset-${index % 8}` : undefined,
  position: [index % 100, Math.floor(index / 10_000), Math.floor(index / 100)],
  visible: index % 5 === 0 ? { $bind: `visibility.group${index % 12}`, fallback: true } : true,
  layers: ['world'],
  pickLayers: index % 10 === 0 ? ['interactive'] : [],
}))
const document = {
  version: '0.7', revision: 100,
  channels: { render: { world: 1, characters: 2 }, picking: { interactive: 1 }, editor: { default: 1 } },
  cameras: {
    main: { type: 'perspective', position: [0, 3, 8], priority: 10, layers: ['world', 'characters'] },
    map: { type: 'orthographic', position: [0, 100, 0], size: 160, layers: ['world'] },
  },
  activeCamera: 'main',
  materials: Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`material-${index}`, { color: `#${(0x334455 + index * 1024).toString(16).slice(-6)}` }])),
  assets: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`asset-${index}`, { type: 'model', src: `./assets/model-${index}.glb`, sizeBytes: 1024 * (index + 1) }])),
  prefabs: { crate: { type: 'box', size: [1, 1, 1], material: 'material-0', version: '1.0.0' } },
  data: { visibility: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`group${index}`, true])) },
  entities,
}

async function measure(label, operation, iterations = 5) {
  const values = []
  let last
  for (let index = 0; index < iterations; index += 1) {
    global.gc?.()
    const start = performance.now()
    last = await operation()
    values.push(performance.now() - start)
  }
  values.sort((a, b) => a - b)
  return { label, medianMs: values[Math.floor(values.length / 2)], minimumMs: values[0], maximumMs: values.at(-1), iterations, details: last }
}

const normalized = normalizeWorldDocument(document)
const results = []
results.push(await measure('Validate 10,000-entity WorldDocument', () => {
  const report = inspectWorldDocument(document)
  if (!report.valid) throw new Error(report.errors.map((item) => `${item.code}: ${item.message}`).join('\n'))
  return { diagnostics: report.issues.length }
}))
results.push(await measure('Normalize and expand 10,000 entities', () => {
  const value = normalizeWorldDocument(document)
  return { entities: value.entities.length }
}))
results.push(await measure('Build compiler dependency graph', () => {
  const graph = buildCompilerDependencyGraph(normalized)
  const edges = [...graph.materialConsumers.values(), ...graph.assetConsumers.values(), ...graph.prefabInstances.values(), ...graph.cameraDependents.values(), ...graph.variableBindings.values()].reduce((total, set) => total + set.size, 0)
  return { edges }
}))
results.push(await measure('Canonical serialization', () => ({ bytes: Buffer.byteLength(canonicalWorldString(document)) }), 3))
results.push(await measure('Canonical document hash', () => ({ hash: hashWorldDocument(document) }), 3))
results.push(await measure('Single stable-ID transform transaction', () => {
  const result = applyStableTransaction(document, {
    id: 'benchmark-patch', baseRevision: 100, revision: 101,
    operations: [{ op: 'replace', target: { entityId: `entity-${Math.floor(entityCount / 2)}` }, path: '/position/0', value: 999 }],
  })
  return { revision: result.document.revision, affectedEntities: result.affectedEntities.size }
}))
results.push(await measure('Portable package descriptor', () => {
  const descriptor = createPortableWorldPackageDescriptor(document)
  return { textFiles: Object.keys(descriptor.files).length, requiredAssets: descriptor.requiredAssets.length }
}, 3))

const output = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  logicalCpus: os.cpus().length,
  entityCount,
  results,
}
await writeFile(path.join(root, 'track-a-benchmark-results.json'), `${JSON.stringify(output, null, 2)}\n`)
const lines = [
  '# Anyo Track A Benchmark Report', '',
  'Measured in Node.js against a deterministic 10,000-entity JSON world. Results cover document architecture work only; they do not measure GPU rendering.', '',
  `- Node: ${output.node}`, `- Platform: ${output.platform}`, `- CPU: ${output.cpu}`, `- Logical CPUs: ${output.logicalCpus}`, `- Entities: ${entityCount.toLocaleString()}`, '',
  '| Scenario | Median | Min | Max | Iterations | Details |', '|---|---:|---:|---:|---:|---|',
  ...results.map((item) => `| ${item.label} | ${item.medianMs.toFixed(3)} ms | ${item.minimumMs.toFixed(3)} ms | ${item.maximumMs.toFixed(3)} ms | ${item.iterations} | ${JSON.stringify(item.details)} |`), '',
  '## Notes', '',
  '- Values vary by hardware, Node version, garbage collection, document shape, and extension hooks.',
  '- Stable-ID transactions are atomic and clone the source document; this benchmark intentionally measures the safe compatibility path, not a future persistent-data structure.',
  '- Dependency graphs and renderer-change classification support selective updates, while insufficient dependency information still falls back to full compilation.',
  '- No benchmark claim here represents browser, WebGL2, WebGPU, or Sekai64 frame performance.', '',
]
await mkdir(path.join(root, 'docs/reports'), { recursive: true })
await writeFile(path.join(root, 'docs/reports/TRACK_A_BENCHMARK_REPORT.md'), `${lines.join('\n')}\n`)
console.log(lines.join('\n'))
