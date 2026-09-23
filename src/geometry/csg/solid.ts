import type { GeometryGroup, GeometryMesh, GeometryMeshDraft, GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import type { CsgOperation, CsgPlane, CsgPolygon, CsgSource, CsgVec3, CsgVertex } from './types.js'

export function csgEpsilon(a: GeometryMesh, b?: GeometryMesh): number {
  const bounds = b ? {
    min: [Math.min(a.bounds.min[0], b.bounds.min[0]), Math.min(a.bounds.min[1], b.bounds.min[1]), Math.min(a.bounds.min[2], b.bounds.min[2])] as CsgVec3,
    max: [Math.max(a.bounds.max[0], b.bounds.max[0]), Math.max(a.bounds.max[1], b.bounds.max[1]), Math.max(a.bounds.max[2], b.bounds.max[2])] as CsgVec3,
  } : { min: [...a.bounds.min] as CsgVec3, max: [...a.bounds.max] as CsgVec3 }
  const diagonal = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2])
  return Math.max(1e-7, Math.min(1e-4, Math.max(1, diagonal) * 1e-6))
}

export function meshToCsgPolygons(
  mesh: GeometryMesh,
  source: CsgSource,
  path: string,
  limits: GeometrySafetyLimits,
  epsilon: number,
): CsgPolygon[] {
  assertClosedSolid(mesh, path, limits, epsilon)
  const groups = [...(mesh.groups ?? [])].sort((a, b) => a.start - b.start)
  const polygons: CsgPolygon[] = []
  let groupIndex = 0
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    while (groupIndex + 1 < groups.length && groups[groupIndex + 1]!.start <= offset) groupIndex += 1
    const group = groupForOffset(groups, groupIndex, offset)
    const vertices = [0, 1, 2].map(local => vertexAt(mesh, mesh.indices[offset + local]!))
    const plane = planeFromVertices(vertices, epsilon)
    if (!plane) {
      throw new GeometryValidationError([{
        code: 'CSG_SOLID_INVALID', path,
        message: `Boolean operand contains a degenerate triangle at triangle ${offset / 3}.`,
        suggestion: 'Repair or simplify the source solid before applying CSG.',
      }])
    }
    polygons.push({ vertices, plane, source, ...(group?.name ? { groupName: group.name } : {}) })
  }
  return polygons
}

export function csgPolygonsToMesh(
  polygons: readonly CsgPolygon[],
  operation: CsgOperation,
  limits: GeometrySafetyLimits,
  epsilon: number,
): GeometryMeshDraft {
  if (polygons.length === 0) emptyResult(operation)
  const conformed = conformPolygonEdges(polygons, limits, epsilon)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const tangents: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const groups: GeometryGroup[] = []
  const hasNormals = conformed.every(polygon => polygon.vertices.every(vertex => vertex.normal))
  const hasUvs = conformed.every(polygon => polygon.vertices.every(vertex => vertex.uv))
  const hasTangents = conformed.every(polygon => polygon.vertices.every(vertex => vertex.tangent))
  const hasColors = conformed.every(polygon => polygon.vertices.every(vertex => vertex.color))

  for (const polygon of conformed) {
    const vertices = sanitizeOutputVertices(polygon.vertices, epsilon)
    if (vertices.length < 3) continue
    const base = positions.length / 3
    for (const vertex of vertices) {
      positions.push(...vertex.position)
      if (hasNormals) normals.push(...vertex.normal!)
      if (hasUvs) uvs.push(...vertex.uv!)
      if (hasTangents) tangents.push(...vertex.tangent!)
      if (hasColors) colors.push(...vertex.color!)
    }
    const groupStart = indices.length
    for (const triangle of triangulateConvexBoundary(vertices, polygon.plane.normal, epsilon)) {
      indices.push(base + triangle[0], base + triangle[1], base + triangle[2])
    }
    if (indices.length > groupStart) appendGroup(groups, groupStart, indices.length - groupStart, resultGroupName(operation, polygon))
    if (positions.length / 3 > limits.maxGeometryVertices || indices.length > limits.maxGeometryIndices) {
      throw new GeometryValidationError([{
        code: 'CSG_COMPLEXITY_LIMIT', path: '/',
        message: 'Boolean result exceeds the configured geometry vertex/index safety limits.',
        suggestion: 'Reduce operand quality/segments or split the Boolean into simpler operations.',
      }])
    }
  }

  if (indices.length === 0 || positions.length === 0) emptyResult(operation)
  const vertexCount = positions.length / 3
  const indexArray = vertexCount > 65_535 ? new Uint32Array(indices) : new Uint16Array(indices)
  const draft: GeometryMeshDraft = {
    positions: new Float32Array(positions),
    indices: indexArray,
    ...(hasNormals ? { normals: new Float32Array(normals) } : {}),
    ...(hasUvs ? { uvs: new Float32Array(uvs) } : {}),
    ...(hasTangents ? { tangents: new Float32Array(tangents) } : {}),
    ...(hasColors ? { colors: new Float32Array(colors) } : {}),
    ...(groups.length ? { groups: Object.freeze(groups.map(group => Object.freeze(group))) } : {}),
  }
  assertClosedSolid(draft, '/result', limits, epsilon)
  return draft
}

export function assertClosedSolid(
  mesh: Pick<GeometryMeshDraft, 'positions' | 'indices'>,
  path: string,
  limits: GeometrySafetyLimits,
  epsilon: number,
): void {
  const triangleCount = mesh.indices.length / 3
  const maxBooleanInputTriangles = Math.min(100_000, Math.floor(limits.maxGeometryIndices / 3))
  if (triangleCount > maxBooleanInputTriangles) {
    throw new GeometryValidationError([{
      code: 'CSG_COMPLEXITY_LIMIT', path,
      message: `Boolean operand has ${triangleCount} triangles, above the safe S8 Boolean input budget ${maxBooleanInputTriangles}.`,
      suggestion: 'Use a lower geometry quality/segment count or perform CSG before high-detail modifiers.',
    }])
  }

  const edges = new Map<string, { count: number; balance: number }>()
  let signedVolume6 = 0
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = positionAt(mesh.positions, mesh.indices[offset]!)
    const b = positionAt(mesh.positions, mesh.indices[offset + 1]!)
    const c = positionAt(mesh.positions, mesh.indices[offset + 2]!)
    if (triangleArea2(a, b, c) <= epsilon * epsilon) {
      solidInvalid(path, `Boolean operand contains a degenerate triangle at triangle ${offset / 3}.`, 'Remove zero-area triangles or reduce nearly coincident geometry.')
    }
    const keys = [pointKey(a, epsilon), pointKey(b, epsilon), pointKey(c, epsilon)]
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[2] === keys[0]) {
      solidInvalid(path, `Boolean operand collapses a triangle within the numerical tolerance at triangle ${offset / 3}.`, 'Increase feature size or remove nearly coincident vertices before CSG.')
    }
    addEdge(edges, keys[0]!, keys[1]!)
    addEdge(edges, keys[1]!, keys[2]!)
    addEdge(edges, keys[2]!, keys[0]!)
    signedVolume6 += dot(a, cross(b, c))
  }
  for (const edge of edges.values()) {
    if (edge.count !== 2 || edge.balance !== 0) {
      solidInvalid(path, `${path === '/result' ? 'Boolean result' : 'Boolean operand'} must be a closed, consistently wound 2-manifold solid.`, 'Use closed primitives/extrusions/sweeps and repair boundary/non-manifold edges before CSG.')
    }
  }
  if (Math.abs(signedVolume6) <= epsilon * epsilon * epsilon) {
    solidInvalid(path, `${path === '/result' ? 'Boolean result' : 'Boolean operand'} has effectively zero enclosed volume.`, 'Use a volumetric closed solid instead of a plane, disc, or collapsed shape.')
  }
  if (signedVolume6 < 0) {
    solidInvalid(path, `${path === '/result' ? 'Boolean result' : 'Boolean operand'} winding points inward instead of outward.`, 'Repair triangle winding before CSG; Anyo built-in closed solids are outward/CCW by contract.')
  }
}

function conformPolygonEdges(
  polygons: readonly CsgPolygon[],
  limits: GeometrySafetyLimits,
  epsilon: number,
): CsgPolygon[] {
  interface LineGroup { direction: CsgVec3; origin: CsgVec3; points: Map<string, CsgVec3> }
  const lines = new Map<string, LineGroup>()
  const globalPoints = new Map<string, CsgVec3>()
  let edgeCount = 0
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.vertices.length; index += 1) {
      const a = polygon.vertices[index]!.position
      const b = polygon.vertices[(index + 1) % polygon.vertices.length]!.position
      const line = canonicalLine(a, b, epsilon)
      globalPoints.set(pointKey(a, epsilon), a)
      globalPoints.set(pointKey(b, epsilon), b)
      if (!line) continue
      let group = lines.get(line.key)
      if (!group) {
        group = { direction: line.direction, origin: a, points: new Map() }
        lines.set(line.key, group)
      }
      group.points.set(pointKey(a, epsilon), a)
      group.points.set(pointKey(b, epsilon), b)
      edgeCount += 1
    }
  }
  if (edgeCount > Math.min(200_000, limits.maxGeometryIndices)) {
    throw new GeometryValidationError([{
      code: 'CSG_COMPLEXITY_LIMIT', path: '/result',
      message: 'Boolean result has too many polygon edges for safe deterministic T-junction conformance.',
      suggestion: 'Reduce source segments/quality or break the Boolean into smaller operations.',
    }])
  }

  const conformanceChecks = lines.size * globalPoints.size
  if (conformanceChecks > 3_000_000) {
    throw new GeometryValidationError([{
      code: 'CSG_COMPLEXITY_LIMIT', path: '/result',
      message: `Boolean result needs ${conformanceChecks} line/vertex conformance checks, above the safe S8 budget.`,
      suggestion: 'Reduce operand tessellation or stage the Boolean before high-detail surface refinement.',
    }])
  }
  for (const group of lines.values()) {
    for (const [key, position] of globalPoints) {
      const relative = subtract(position, group.origin)
      if (Math.hypot(...cross(relative, group.direction)) <= epsilon * 2) group.points.set(key, position)
    }
  }

  let generatedVertices = 0
  return polygons.map(polygon => {
    const vertices: CsgVertex[] = []
    for (let index = 0; index < polygon.vertices.length; index += 1) {
      const start = polygon.vertices[index]!
      const end = polygon.vertices[(index + 1) % polygon.vertices.length]!
      vertices.push(start)
      const line = canonicalLine(start.position, end.position, epsilon)
      if (!line) continue
      const group = lines.get(line.key)
      if (!group || group.points.size <= 2) continue
      const segment = subtract(end.position, start.position)
      const lengthSquared = dot(segment, segment)
      if (lengthSquared <= epsilon * epsilon) continue
      const splits: Array<{ alpha: number; position: CsgVec3 }> = []
      for (const position of group.points.values()) {
        const alpha = dot(subtract(position, start.position), segment) / lengthSquared
        if (alpha <= 1e-8 || alpha >= 1 - 1e-8) continue
        const projected: CsgVec3 = [
          start.position[0] + segment[0] * alpha,
          start.position[1] + segment[1] * alpha,
          start.position[2] + segment[2] * alpha,
        ]
        if (distanceSquared(projected, position) > epsilon * epsilon * 4) continue
        splits.push({ alpha, position })
      }
      splits.sort((a, b) => a.alpha - b.alpha)
      let previousAlpha = -1
      for (const split of splits) {
        if (Math.abs(split.alpha - previousAlpha) <= 1e-9) continue
        vertices.push(interpolateEdgeVertex(start, end, split.alpha, split.position))
        previousAlpha = split.alpha
        generatedVertices += 1
        if (generatedVertices > limits.maxGeometryVertices) {
          throw new GeometryValidationError([{
            code: 'CSG_COMPLEXITY_LIMIT', path: '/result',
            message: 'Boolean T-junction conformance exceeded maxGeometryVertices.',
            suggestion: 'Reduce source detail or perform CSG before high-resolution surface refinement.',
          }])
        }
      }
    }
    return { ...polygon, vertices: sanitizeOutputVertices(vertices, epsilon) }
  })
}

function canonicalLine(a: CsgVec3, b: CsgVec3, epsilon: number): { key: string; direction: CsgVec3 } | undefined {
  const delta = subtract(b, a)
  const length = Math.hypot(...delta)
  if (length <= epsilon) return undefined
  let direction: CsgVec3 = [delta[0] / length, delta[1] / length, delta[2] / length]
  const signIndex = Math.abs(direction[0]) > 1e-10 ? 0 : Math.abs(direction[1]) > 1e-10 ? 1 : 2
  if (direction[signIndex] < 0) direction = [-direction[0], -direction[1], -direction[2]]
  const moment = cross(a, direction)
  const directionStep = 1e-6
  const key = `${Math.round(direction[0] / directionStep)},${Math.round(direction[1] / directionStep)},${Math.round(direction[2] / directionStep)}|${Math.round(moment[0] / epsilon)},${Math.round(moment[1] / epsilon)},${Math.round(moment[2] / epsilon)}`
  return { key, direction }
}

function interpolateEdgeVertex(a: CsgVertex, b: CsgVertex, alpha: number, exactPosition: CsgVec3): CsgVertex {
  const normal = a.normal && b.normal ? normalize3(lerp3(a.normal, b.normal, alpha)) : undefined
  const uv = a.uv && b.uv ? [lerp(a.uv[0], b.uv[0], alpha), lerp(a.uv[1], b.uv[1], alpha)] as [number, number] : undefined
  let tangent: [number, number, number, number] | undefined
  if (a.tangent && b.tangent) {
    const xyz = normalize3([lerp(a.tangent[0], b.tangent[0], alpha), lerp(a.tangent[1], b.tangent[1], alpha), lerp(a.tangent[2], b.tangent[2], alpha)])
    tangent = [xyz[0], xyz[1], xyz[2], alpha < 0.5 ? a.tangent[3] : b.tangent[3]]
  }
  const color = a.color && b.color ? [
    lerp(a.color[0], b.color[0], alpha), lerp(a.color[1], b.color[1], alpha),
    lerp(a.color[2], b.color[2], alpha), lerp(a.color[3], b.color[3], alpha),
  ] as [number, number, number, number] : undefined
  return { position: [...exactPosition], ...(normal ? { normal } : {}), ...(uv ? { uv } : {}), ...(tangent ? { tangent } : {}), ...(color ? { color } : {}) }
}

function triangulateConvexBoundary(vertices: readonly CsgVertex[], normal: CsgVec3, epsilon: number): Array<[number, number, number]> {
  if (vertices.length < 3) return []
  const threshold = epsilon * epsilon
  // BSP polygons are convex, but S8 edge conformance deliberately keeps collinear
  // boundary vertices so neighboring polygons share identical edge segmentation.
  // Pick a fan root that does not strand a collinear boundary chain.
  for (let root = 0; root < vertices.length; root += 1) {
    const triangles: Array<[number, number, number]> = []
    let valid = true
    for (let step = 1; step < vertices.length - 1; step += 1) {
      const current = (root + step) % vertices.length
      const next = (root + step + 1) % vertices.length
      const a = vertices[root]!.position, b = vertices[current]!.position, c = vertices[next]!.position
      const orientation = dot(cross(subtract(b, a), subtract(c, a)), normal)
      if (orientation <= threshold) { valid = false; break }
      triangles.push([root, current, next])
    }
    if (valid) return triangles
  }

  throw new GeometryValidationError([{
    code: 'CSG_NUMERICAL_FAILURE', path: '/result',
    message: 'A convex Boolean polygon could not be triangulated while preserving its conformed boundary.',
    suggestion: 'Avoid extremely thin or nearly collinear Boolean features and retry with simpler operands.',
  }])
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
function lerp3(a: CsgVec3, b: CsgVec3, t: number): CsgVec3 { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] }
function normalize3(value: CsgVec3): CsgVec3 { const length = Math.hypot(...value); return length <= 1e-15 ? [1, 0, 0] : [value[0] / length, value[1] / length, value[2] / length] }

function groupForOffset(groups: readonly GeometryGroup[], index: number, offset: number): GeometryGroup | undefined {
  const group = groups[index]
  return group && offset >= group.start && offset < group.start + group.count ? group : undefined
}
function vertexAt(mesh: GeometryMesh, index: number): CsgVertex {
  const p = index * 3, uv = index * 2, tangent = index * 4, color = index * 4
  return {
    position: [mesh.positions[p]!, mesh.positions[p + 1]!, mesh.positions[p + 2]!],
    ...(mesh.normals ? { normal: [mesh.normals[p]!, mesh.normals[p + 1]!, mesh.normals[p + 2]!] as CsgVec3 } : {}),
    ...(mesh.uvs ? { uv: [mesh.uvs[uv]!, mesh.uvs[uv + 1]!] as [number, number] } : {}),
    ...(mesh.tangents ? { tangent: [mesh.tangents[tangent]!, mesh.tangents[tangent + 1]!, mesh.tangents[tangent + 2]!, mesh.tangents[tangent + 3]!] as [number, number, number, number] } : {}),
    ...(mesh.colors ? { color: [mesh.colors[color]!, mesh.colors[color + 1]!, mesh.colors[color + 2]!, mesh.colors[color + 3]!] as [number, number, number, number] } : {}),
  }
}
function planeFromVertices(vertices: readonly CsgVertex[], epsilon: number): CsgPlane | undefined {
  for (let index = 2; index < vertices.length; index += 1) {
    const a = vertices[0]!.position, b = vertices[index - 1]!.position, c = vertices[index]!.position
    const normalRaw = cross(subtract(b, a), subtract(c, a))
    const normalLength = Math.hypot(...normalRaw)
    if (normalLength > epsilon * epsilon) {
      const normal: CsgVec3 = [normalRaw[0] / normalLength, normalRaw[1] / normalLength, normalRaw[2] / normalLength]
      return { normal, w: dot(normal, a) }
    }
  }
  return undefined
}
function sanitizeOutputVertices(vertices: readonly CsgVertex[], epsilon: number): CsgVertex[] {
  const output: CsgVertex[] = []
  for (const vertex of vertices) {
    if (output.length === 0 || distanceSquared(output[output.length - 1]!.position, vertex.position) > epsilon * epsilon) output.push(vertex)
  }
  if (output.length > 2 && distanceSquared(output[0]!.position, output[output.length - 1]!.position) <= epsilon * epsilon) output.pop()
  return output
}
function appendGroup(groups: GeometryGroup[], start: number, count: number, name: string): void {
  const previous = groups[groups.length - 1]
  if (previous && previous.start + previous.count === start && previous.name === name && previous.materialIndex === 0) {
    previous.count += count
  } else groups.push({ start, count, materialIndex: 0, name })
}
function resultGroupName(operation: CsgOperation, polygon: CsgPolygon): string {
  const source = operation === 'subtract' && polygon.source === 'right' ? 'cut' : polygon.source
  return `${source}:${polygon.groupName ?? 'surface'}`
}
function addEdge(edges: Map<string, { count: number; balance: number }>, from: string, to: string): void {
  const forward = from < to
  const key = forward ? `${from}|${to}` : `${to}|${from}`
  const edge = edges.get(key) ?? { count: 0, balance: 0 }
  edge.count += 1
  edge.balance += forward ? 1 : -1
  edges.set(key, edge)
}
function pointKey(value: CsgVec3, epsilon: number): string {
  return `${Math.round(value[0] / epsilon)},${Math.round(value[1] / epsilon)},${Math.round(value[2] / epsilon)}`
}
function positionAt(values: Float32Array, index: number): CsgVec3 { const o = index * 3; return [values[o]!, values[o + 1]!, values[o + 2]!] }
function triangleArea2(a: CsgVec3, b: CsgVec3, c: CsgVec3): number { return Math.hypot(...cross(subtract(b, a), subtract(c, a))) }
function subtract(a: CsgVec3, b: CsgVec3): CsgVec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a: CsgVec3, b: CsgVec3): CsgVec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a: CsgVec3, b: CsgVec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function distanceSquared(a: CsgVec3, b: CsgVec3): number { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z }
function solidInvalid(path: string, message: string, suggestion: string): never {
  throw new GeometryValidationError([{ code: 'CSG_SOLID_INVALID', path, message, suggestion }])
}
function emptyResult(operation: CsgOperation): never {
  throw new GeometryValidationError([{
    code: 'CSG_EMPTY_RESULT', path: '/',
    message: `Boolean ${operation} produced no volumetric geometry.`,
    suggestion: operation === 'intersect'
      ? 'Ensure the operands overlap with positive volume.'
      : 'Adjust the operands so the operation leaves a non-empty solid.',
  }])
}
