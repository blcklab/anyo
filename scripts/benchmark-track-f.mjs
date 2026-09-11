import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import os from 'node:os'
import { applyStableTransaction, buildCompilerDependencyGraph, hashWorldDocument, inspectWorldDocument, normalizeWorldDocument } from '../dist/esm/index.js'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const count = Number(process.env.ANYO_TRACK_F_ENTITIES ?? 10_000)
const document = { version: '0.7', revision: 0, materials: { shared: { baseColor: '#8899aa' } }, entities: Array.from({ length: count }, (_, index) => ({ id: `e-${index}`, type: 'box', material: 'shared', position: [index % 100, 0, -Math.floor(index / 100)] })) }
function percentile(values, p) { const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.floor((sorted.length-1)*p)] ?? 0 }
async function measure(name, iterations, fn) { const values=[]; let details; for(let i=0;i<iterations+2;i++){global.gc?.();const start=performance.now();details=await fn();const ms=performance.now()-start;if(i>=2)values.push(ms)} return {name,iterations,medianMs:percentile(values,.5),p95Ms:percentile(values,.95),details} }
const normalized=normalizeWorldDocument(document)
const results=[]
results.push(await measure('validation',8,()=>({valid:inspectWorldDocument(document).valid})))
results.push(await measure('normalization',8,()=>({entities:normalizeWorldDocument(document).entities.length})))
results.push(await measure('dependency graph',8,()=>({materials:buildCompilerDependencyGraph(normalized).materialConsumers.size})))
results.push(await measure('canonical hash',5,()=>({hash:hashWorldDocument(document)})))
results.push(await measure('single stable transaction',10,()=>({affected:applyStableTransaction(document,{id:'patch',baseRevision:0,revision:1,operations:[{op:'replace',target:{entityId:'e-5000'},path:'/position/0',value:99}]}).affectedEntities.size})))
const report={format:'@blcklab/anyo/track-f-benchmark',schemaVersion:1,generatedAt:new Date().toISOString(),environment:{node:process.version,platform:`${process.platform}-${process.arch}`,cpu:os.cpus()[0]?.model??'unknown'},fixture:{entities:count},results,disclaimer:'CPU/document measurements only; not GPU or browser FPS claims.'}
await writeFile(path.join(root,'track-f-benchmark-results.json'),`${JSON.stringify(report,null,2)}\n`)
console.table(results.map(item=>({operation:item.name,medianMs:item.medianMs.toFixed(3),p95Ms:item.p95Ms.toFixed(3)})))
