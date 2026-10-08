import type {
  GeometryBounds,
  GeometryInspectionResult,
  GeometryIssue,
  GeometryIssueCode,
  GeometryMesh,
  GeometryMeshDraft,
  GeometryMeshValidationOptions,
  GeometrySafetyLimits,
  GeometryValidationLevel,
} from '../types/index.js'
import { computeGeometryBounds } from '../bounds/computeBounds.js'
import { GeometryValidationError } from './errors.js'
import { resolveGeometrySafetyLimits } from './limits.js'

const DEFAULT_MAX_DIAGNOSTICS = 64
const DEFAULT_WINDING_TRIANGLE_LIMIT = 100_000
const DEGENERATE_AREA_SQUARED_EPSILON = 1e-20
const VECTOR_LENGTH_SQUARED_EPSILON = 1e-20

interface ResolvedMeshValidationOptions {
  limits: GeometrySafetyLimits
  degenerateTriangles: GeometryValidationLevel
  vectorAttributes: GeometryValidationLevel
  groupOverlaps: GeometryValidationLevel
  winding: GeometryValidationLevel
  bounds: 'repair' | 'error'
  maxDiagnostics: number
  windingTriangleLimit: number
  context: GeometryMeshValidationOptions['context']
  onDiagnostic: GeometryMeshValidationOptions['onDiagnostic']
}

function resolveOptions(options: GeometryMeshValidationOptions): ResolvedMeshValidationOptions {
  const maxDiagnostics = options.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS
  const windingTriangleLimit = options.windingTriangleLimit ?? DEFAULT_WINDING_TRIANGLE_LIMIT
  if (!Number.isSafeInteger(maxDiagnostics) || maxDiagnostics <= 0) throw new TypeError('maxDiagnostics must be a positive safe integer.')
  if (!Number.isSafeInteger(windingTriangleLimit) || windingTriangleLimit <= 0) throw new TypeError('windingTriangleLimit must be a positive safe integer.')
  return {
    limits: resolveGeometrySafetyLimits(options.limits),
    degenerateTriangles: options.degenerateTriangles ?? 'warn',
    vectorAttributes: options.vectorAttributes ?? 'warn',
    groupOverlaps: options.groupOverlaps ?? 'warn',
    winding: options.winding ?? 'warn',
    bounds: options.bounds ?? 'repair',
    maxDiagnostics,
    windingTriangleLimit,
    context: options.context,
    onDiagnostic: options.onDiagnostic,
  }
}

function makeIssue(code: GeometryIssueCode, path: string, message: string, options: ResolvedMeshValidationOptions, suggestion?: string, severity?: 'warning'): GeometryIssue {
  return {
    code,
    path,
    message,
    ...(severity ? { severity } : {}),
    ...(options.context ? { context: options.context } : {}),
    ...(suggestion ? { suggestion } : {}),
  }
}

function pushIssue(issues: GeometryIssue[], issue: GeometryIssue, options: ResolvedMeshValidationOptions): void {
  if (issues.length < options.maxDiagnostics) issues.push(issue)
}

function pushDiagnostic(diagnostics: GeometryIssue[], issue: GeometryIssue, options: ResolvedMeshValidationOptions): void {
  if (diagnostics.length >= options.maxDiagnostics) return
  const diagnostic = { ...issue, severity: 'warning' as const }
  diagnostics.push(diagnostic)
  options.onDiagnostic?.(diagnostic)
}

function pushByLevel(
  level: GeometryValidationLevel,
  issues: GeometryIssue[],
  diagnostics: GeometryIssue[],
  issue: GeometryIssue,
  options: ResolvedMeshValidationOptions,
): void {
  if (level === 'ignore') return
  if (level === 'error') pushIssue(issues, issue, options)
  else pushDiagnostic(diagnostics, issue, options)
}

function finiteArray(values: Float32Array, path: string, issues: GeometryIssue[], options: ResolvedMeshValidationOptions): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index]!)) {
      pushIssue(issues, makeIssue('GEOMETRY_MESH_INVALID', `${path}/${index}`, `${path.slice(1)} must contain only finite numbers.`, options, 'Replace NaN/Infinity with finite authored or generated values.'), options)
      return false
    }
  }
  return true
}

function validateVectorAttribute(
  values: Float32Array,
  width: 3 | 4,
  path: '/normals' | '/tangents',
  issues: GeometryIssue[],
  diagnostics: GeometryIssue[],
  options: ResolvedMeshValidationOptions,
): void {
  if (options.vectorAttributes === 'ignore') return
  for (let offset = 0; offset < values.length; offset += width) {
    const x = values[offset]!, y = values[offset + 1]!, z = values[offset + 2]!
    const lengthSquared = x * x + y * y + z * z
    if (lengthSquared <= VECTOR_LENGTH_SQUARED_EPSILON) {
      pushByLevel(options.vectorAttributes, issues, diagnostics, makeIssue(
        path === '/normals' ? 'GEOMETRY_NORMAL_INVALID' : 'GEOMETRY_TANGENT_INVALID',
        `${path}/${offset}`,
        `${path.slice(1, -1)} vector at vertex ${offset / width} has near-zero length.`,
        options,
        path === '/normals' ? 'Regenerate normals or author a non-zero normal vector.' : 'Regenerate tangents from valid normals and UVs.',
      ), options)
      return
    }
    if (width === 4) {
      const handedness = values[offset + 3]!
      if (Math.abs(Math.abs(handedness) - 1) > 1e-3) {
        pushByLevel(options.vectorAttributes, issues, diagnostics, makeIssue(
          'GEOMETRY_TANGENT_INVALID',
          `${path}/${offset + 3}`,
          `Tangent handedness at vertex ${offset / width} should be -1 or +1.`,
          options,
          'Regenerate tangents or normalize the tangent w component to -1/+1.',
        ), options)
        return
      }
    }
  }
}

function inspectTriangles(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  issues: GeometryIssue[],
  diagnostics: GeometryIssue[],
  options: ResolvedMeshValidationOptions,
): void {
  const triangleCount = indices.length / 3
  const runWinding = options.winding !== 'ignore' && triangleCount <= options.windingTriangleLimit
  const edges = runWinding ? new Map<string, 1 | -1>() : undefined

  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset]!, b = indices[offset + 1]!, c = indices[offset + 2]!
    const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!
    const bx = positions[b * 3]!, by = positions[b * 3 + 1]!, bz = positions[b * 3 + 2]!
    const cx = positions[c * 3]!, cy = positions[c * 3 + 1]!, cz = positions[c * 3 + 2]!
    const abx = bx - ax, aby = by - ay, abz = bz - az
    const acx = cx - ax, acy = cy - ay, acz = cz - az
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    const areaSquared4 = nx * nx + ny * ny + nz * nz
    const degenerate = a === b || b === c || c === a || areaSquared4 <= DEGENERATE_AREA_SQUARED_EPSILON
    if (degenerate) {
      pushByLevel(options.degenerateTriangles, issues, diagnostics, makeIssue(
        'GEOMETRY_DEGENERATE_TRIANGLE',
        `/indices/${offset}`,
        `Triangle ${offset / 3} is degenerate and contributes no stable surface area.`,
        options,
        'Remove the triangle or move its vertices so the three points form a non-zero-area face.',
      ), options)
      continue
    }

    if (!edges) continue
    const triangleEdges: readonly [number, number][] = [[a, b], [b, c], [c, a]]
    for (const [from, to] of triangleEdges) {
      const low = Math.min(from, to), high = Math.max(from, to)
      const key = `${low}:${high}`
      const direction: 1 | -1 = from === low ? 1 : -1
      const previous = edges.get(key)
      if (previous === undefined) edges.set(key, direction)
      else if (previous === direction) {
        pushByLevel(options.winding, issues, diagnostics, makeIssue(
          'GEOMETRY_WINDING_INCONSISTENT',
          `/indices/${offset}`,
          `Triangle ${offset / 3} shares edge ${low}-${high} with the same directed winding as another face.`,
          options,
          'Reverse one triangle winding if this edge is intended to be manifold.',
        ), options)
        // Mark as opposite after reporting so non-manifold third faces do not flood diagnostics.
        edges.set(key, direction === 1 ? -1 : 1)
      }
    }
  }
}

function boundsFinite(bounds: GeometryBounds): boolean {
  return bounds.min.length === 3 && bounds.max.length === 3 && bounds.sphere.center.length === 3 &&
    [...bounds.min, ...bounds.max, ...bounds.sphere.center, bounds.sphere.radius].every(Number.isFinite) &&
    bounds.sphere.radius >= 0 &&
    bounds.min[0] <= bounds.max[0] && bounds.min[1] <= bounds.max[1] && bounds.min[2] <= bounds.max[2]
}

function near(a: number, b: number): boolean {
  const tolerance = 1e-5 * Math.max(1, Math.abs(a), Math.abs(b))
  return Math.abs(a - b) <= tolerance
}

function boundsMatch(a: GeometryBounds, b: GeometryBounds): boolean {
  return a.min.every((value, index) => near(value, b.min[index]!)) &&
    a.max.every((value, index) => near(value, b.max[index]!)) &&
    a.sphere.center.every((value, index) => near(value, b.sphere.center[index]!)) &&
    near(a.sphere.radius, b.sphere.radius)
}

function inspectProvidedBounds(
  supplied: GeometryBounds | undefined,
  actual: GeometryBounds,
  issues: GeometryIssue[],
  diagnostics: GeometryIssue[],
  options: ResolvedMeshValidationOptions,
): void {
  if (!supplied) return
  const valid = boundsFinite(supplied)
  const matches = valid && boundsMatch(supplied, actual)
  if (valid && matches) return
  const issue = makeIssue(
    valid ? 'GEOMETRY_BOUNDS_MISMATCH' : 'GEOMETRY_BOUNDS_INVALID',
    '/bounds',
    valid ? 'Supplied geometry bounds do not match the finalized vertex positions.' : 'Supplied geometry bounds must contain finite ordered min/max values and a finite non-negative sphere.',
    options,
    'Remove authored/generated bounds and allow Anyo to recompute canonical bounds from final positions.',
  )
  if (options.bounds === 'error') pushIssue(issues, issue, options)
  else pushDiagnostic(diagnostics, issue, options)
}

function inspectGroupOverlaps(
  groups: readonly { start: number; count: number }[],
  issues: GeometryIssue[],
  diagnostics: GeometryIssue[],
  options: ResolvedMeshValidationOptions,
): void {
  if (options.groupOverlaps === 'ignore' || groups.length < 2) return
  const ranges = groups.map((group, index) => ({ index, start: group.start, end: group.start + group.count })).sort((a, b) => a.start - b.start || a.end - b.end)
  let previous = ranges[0]!
  for (let index = 1; index < ranges.length; index += 1) {
    const current = ranges[index]!
    if (current.start < previous.end) {
      pushByLevel(options.groupOverlaps, issues, diagnostics, makeIssue(
        'GEOMETRY_GROUP_OVERLAP',
        `/groups/${current.index}`,
        `Geometry group ${current.index} overlaps group ${previous.index} in the index buffer.`,
        options,
        'Keep overlapping groups only when duplicate material coverage is intentional; otherwise split them into disjoint triangle ranges.',
      ), options)
    }
    if (current.end > previous.end) previous = current
  }
}

export function inspectGeometryMesh(
  mesh: GeometryMeshDraft,
  inputOptions: GeometryMeshValidationOptions = {},
): GeometryInspectionResult<GeometryMesh> {
  const options = resolveOptions(inputOptions)
  const issues: GeometryIssue[] = []
  const diagnostics: GeometryIssue[] = []

  const positionsValidType = mesh.positions instanceof Float32Array
  const positionsValidLayout = positionsValidType && mesh.positions.length > 0 && mesh.positions.length % 3 === 0
  if (!positionsValidLayout) {
    pushIssue(issues, makeIssue('GEOMETRY_MESH_INVALID', '/positions', 'Positions must be a non-empty Float32Array with xyz layout.', options), options)
  }

  const indicesValidType = mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array
  const indicesValidLayout = indicesValidType && mesh.indices.length > 0 && mesh.indices.length % 3 === 0
  if (!indicesValidType) {
    pushIssue(issues, makeIssue('GEOMETRY_MESH_INVALID', '/indices', 'Indices must be Uint16Array or Uint32Array.', options), options)
  } else if (!indicesValidLayout) {
    pushIssue(issues, makeIssue('GEOMETRY_MESH_INVALID', '/indices', 'Indices must describe a non-empty triangle list.', options), options)
  }

  const vertexCount = positionsValidLayout ? mesh.positions.length / 3 : 0
  if (positionsValidLayout && vertexCount > options.limits.maxGeometryVertices) {
    pushIssue(issues, makeIssue('GEOMETRY_MESH_LIMIT', '/positions', `Mesh exceeds maxGeometryVertices ${options.limits.maxGeometryVertices}.`, options, 'Reduce generated detail or increase the explicit geometry safety limit.'), options)
  }
  if (indicesValidType && mesh.indices.length > options.limits.maxGeometryIndices) {
    pushIssue(issues, makeIssue('GEOMETRY_MESH_LIMIT', '/indices', `Mesh exceeds maxGeometryIndices ${options.limits.maxGeometryIndices}.`, options, 'Reduce generated topology or increase the explicit geometry safety limit.'), options)
  }

  const positionsFinite = positionsValidLayout ? finiteArray(mesh.positions, '/positions', issues, options) : false
  const attributes: Array<[Float32Array | undefined, number, string]> = [
    [mesh.normals, 3, '/normals'], [mesh.uvs, 2, '/uvs'], [mesh.tangents, 4, '/tangents'], [mesh.colors, 4, '/colors'],
  ]
  let attributeValueCount = 0
  for (const [attribute, width, path] of attributes) {
    if (!attribute) continue
    if (!(attribute instanceof Float32Array) || !positionsValidLayout || attribute.length !== vertexCount * width) {
      pushIssue(issues, makeIssue('GEOMETRY_ATTRIBUTE_LENGTH_INVALID', path, `${path.slice(1)} must contain ${width} values per vertex.`, options), options)
      continue
    }
    attributeValueCount += attribute.length
    const finite = finiteArray(attribute, path, issues, options)
    if (finite && (path === '/normals' || path === '/tangents')) {
      validateVectorAttribute(attribute, width as 3 | 4, path as '/normals' | '/tangents', issues, diagnostics, options)
    }
  }
  if (attributeValueCount > options.limits.maxGeometryAttributeValues) {
    pushIssue(issues, makeIssue('GEOMETRY_MESH_LIMIT', '/attributes', `Mesh exceeds maxGeometryAttributeValues ${options.limits.maxGeometryAttributeValues}.`, options, 'Reduce optional vertex channels or increase the explicit geometry safety limit.'), options)
  }

  let indicesInRange = indicesValidLayout && positionsValidLayout
  if (indicesValidLayout && positionsValidLayout) {
    for (let index = 0; index < mesh.indices.length; index += 1) {
      if (mesh.indices[index]! >= vertexCount) {
        pushIssue(issues, makeIssue('GEOMETRY_INDEX_OUT_OF_RANGE', `/indices/${index}`, `Index ${mesh.indices[index]} is outside ${vertexCount} vertices.`, options), options)
        indicesInRange = false
        break
      }
    }
  }

  const groups = Array.isArray(mesh.groups) ? mesh.groups : undefined
  if (mesh.groups !== undefined && !groups) {
    pushIssue(issues, makeIssue('GEOMETRY_GROUP_INVALID', '/groups', 'Geometry groups must be an array.', options), options)
  }
  if (groups && groups.length > options.limits.maxGeometryGroups) {
    pushIssue(issues, makeIssue('GEOMETRY_MESH_LIMIT', '/groups', `Mesh exceeds maxGeometryGroups ${options.limits.maxGeometryGroups}.`, options, 'Merge semantic/material regions or increase the explicit geometry safety limit.'), options)
  }
  let groupsStructurallyValid = true
  for (let index = 0; index < (groups?.length ?? 0); index += 1) {
    const group = groups![index]!
    if (!group || !Number.isSafeInteger(group.start) || !Number.isSafeInteger(group.count) || !Number.isSafeInteger(group.materialIndex) || group.start < 0 || group.count <= 0 || group.materialIndex < 0 || group.start % 3 !== 0 || group.count % 3 !== 0 || !indicesValidType || group.start + group.count > mesh.indices.length || (group.name !== undefined && typeof group.name !== 'string')) {
      pushIssue(issues, makeIssue('GEOMETRY_GROUP_INVALID', `/groups/${index}`, 'Geometry groups must be non-negative triangle-aligned index ranges with a valid materialIndex and optional string name.', options), options)
      groupsStructurallyValid = false
    }
  }
  if (groups && groupsStructurallyValid) inspectGroupOverlaps(groups, issues, diagnostics, options)

  if (positionsFinite && indicesInRange && indicesValidLayout) inspectTriangles(mesh.positions, mesh.indices, issues, diagnostics, options)

  if (issues.length > 0) return { valid: false, issues, ...(diagnostics.length > 0 ? { diagnostics } : {}) }

  const bounds = computeGeometryBounds(mesh.positions)
  inspectProvidedBounds(mesh.bounds, bounds, issues, diagnostics, options)
  if (issues.length > 0) return { valid: false, issues, ...(diagnostics.length > 0 ? { diagnostics } : {}) }
  return { valid: true, value: { ...mesh, bounds }, issues, ...(diagnostics.length > 0 ? { diagnostics } : {}) }
}

export function finalizeGeometryMesh(
  mesh: GeometryMeshDraft,
  options: GeometryMeshValidationOptions = {},
): GeometryMesh {
  const result = inspectGeometryMesh(mesh, options)
  if (!result.valid || !result.value) throw new GeometryValidationError(result.issues)
  return result.value
}
