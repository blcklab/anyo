import type {
  Aabb,
  CompileAccumulator,
  CompiledCollider,
  CompiledEntityNode,
  EntityDefinition,
  NormalizedEntityDefinition,
  NormalizedWorldDocument,
  TransformDefinition,
  Vec3,
} from '../core/types.js'
import { GeometryCompiler } from '../geometry/core/GeometryCompiler.js'
import { normalizeCurve, sampleCurve } from '../geometry/curves/index.js'
import { lowerArchitecture } from '../geometry/architecture/index.js'
import type { ArchitectureDefinition } from '../geometry/architecture/types.js'
import type { GeometryBounds, GeometryDefinition } from '../geometry/types/index.js'
import { mergeAabb } from '../math/aabb.js'
import { matrixFromTransform, transformPoint } from '../math/matrix4.js'
import { composeTransforms, createTransform, finalizeTransform } from '../math/transform.js'

export type ProceduralCollisionPolicy = 'none' | 'bounds' | 'semantic' | 'parts'

const compiler = new GeometryCompiler()

function flattenEntities(roots: readonly NormalizedEntityDefinition[]): NormalizedEntityDefinition[] {
  const result: NormalizedEntityDefinition[] = []
  const visit = (entity: NormalizedEntityDefinition): void => {
    result.push(entity)
    for (const child of entity.children ?? []) visit(child)
  }
  for (const entity of roots) visit(entity)
  return result
}

function resolvePolicy(entity: EntityDefinition, node: CompiledEntityNode): ProceduralCollisionPolicy {
  const component = node.components?.find((item) => item.type === 'anyo.collider')
  if (component && !component.enabled) return 'none'
  if (!component && entity.collision === false) return 'none'
  if (entity.collisionPolicy) return entity.collisionPolicy
  if (component?.enabled || entity.collision === true) return entity.type === 'construction' ? 'semantic' : 'bounds'
  return 'none'
}

function geometryDefinition(document: NormalizedWorldDocument, entity: NormalizedEntityDefinition): GeometryDefinition {
  const value = entity.geometry
  if (!value) throw new Error(`ANYO_PROCEDURAL_GEOMETRY_REQUIRED\nEntity: ${entity.id}`)
  if (typeof value !== 'string') return value
  const definition = document.geometries?.[value]
  if (!definition) throw new Error(`ANYO_PROCEDURAL_GEOMETRY_NOT_FOUND\nEntity: ${entity.id}\nGeometry: ${value}`)
  return definition
}

function composeTransform(parent: TransformDefinition, child: {
  readonly position: readonly [number, number, number]
  readonly rotation: readonly [number, number, number]
  readonly scale: readonly [number, number, number]
}): TransformDefinition {
  return finalizeTransform(composeTransforms(
    createTransform([...parent.position] as [number, number, number], [...parent.rotation] as [number, number, number], [...parent.scale] as [number, number, number]),
    createTransform([...child.position] as [number, number, number], [...child.rotation] as [number, number, number], [...child.scale] as [number, number, number]),
  ))
}

function transformedBounds(bounds: GeometryBounds, transform: TransformDefinition): Aabb {
  const matrix = transform.matrix ?? matrixFromTransform(transform)
  const [minX, minY, minZ] = bounds.min
  const [maxX, maxY, maxZ] = bounds.max
  const corners: Vec3[] = [
    [minX, minY, minZ], [maxX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [minX, maxY, maxZ], [maxX, maxY, maxZ],
  ]
  const first = transformPoint(matrix, corners[0]!)
  const min: [number, number, number] = [...first]
  const max: [number, number, number] = [...first]
  for (const corner of corners.slice(1)) {
    const point = transformPoint(matrix, corner)
    min[0] = Math.min(min[0], point[0]); min[1] = Math.min(min[1], point[1]); min[2] = Math.min(min[2], point[2])
    max[0] = Math.max(max[0], point[0]); max[1] = Math.max(max[1], point[1]); max[2] = Math.max(max[2], point[2])
  }
  return { min, max }
}

function boundsFor(definition: GeometryDefinition, transform: TransformDefinition): Aabb {
  return transformedBounds(compiler.compile(definition).bounds, transform)
}

function colliderKind(definition: ArchitectureDefinition, role?: string): CompiledCollider['kind'] {
  if (definition.type === 'floor' || role === 'floor') return 'floor'
  if (definition.type === 'stairs' || role?.startsWith('stairs:')) return 'stair'
  return 'solid'
}

function addCollider(output: CompileAccumulator, node: CompiledEntityNode, collider: CompiledCollider): void {
  output.colliders.push(collider)
  if (!node.roomId) return
  const chunk = output.rooms.find((item) => item.roomId === node.roomId)
  if (chunk && !chunk.colliderIds.includes(collider.id)) chunk.colliderIds.push(collider.id)
}

function addGeometryBoundsCollider(
  document: NormalizedWorldDocument,
  output: CompileAccumulator,
  entity: NormalizedEntityDefinition,
  node: CompiledEntityNode,
): void {
  const bounds = boundsFor(geometryDefinition(document, entity), node.transform)
  addCollider(output, node, {
    id: `procedural:${entity.id}:bounds`,
    bounds,
    roomId: node.roomId,
    entityId: entity.id,
    enabled: true,
    kind: 'solid',
  })
}

function constructionBounds(
  definition: ArchitectureDefinition,
  node: CompiledEntityNode,
): Aabb | undefined {
  const assembly = lowerArchitecture(definition)
  let result: Aabb | undefined
  for (const part of assembly.parts) {
    const bounds = boundsFor(part.geometry, composeTransform(node.transform, part.transform))
    result = result ? mergeAabb(result, bounds) : bounds
  }
  for (const group of assembly.instanceGroups) {
    for (const placement of group.placements) {
      const bounds = boundsFor(group.geometry, composeTransform(node.transform, placement))
      result = result ? mergeAabb(result, bounds) : bounds
    }
  }
  return result
}

function addConstructionBoundsCollider(
  output: CompileAccumulator,
  entity: NormalizedEntityDefinition,
  node: CompiledEntityNode,
  definition: ArchitectureDefinition,
): void {
  const bounds = constructionBounds(definition, node)
  if (!bounds) return
  addCollider(output, node, {
    id: `procedural:${entity.id}:bounds`,
    bounds,
    roomId: node.roomId,
    entityId: entity.id,
    enabled: true,
    kind: colliderKind(definition),
  })
}

function addRailingSegmentColliders(
  output: CompileAccumulator,
  entity: NormalizedEntityDefinition,
  node: CompiledEntityNode,
  definition: Extract<ArchitectureDefinition, { type: 'railing' }>,
): void {
  const assembly = lowerArchitecture(definition)
  const prefix = `procedural:${entity.id}`

  for (const part of assembly.parts) {
    if (part.role !== 'railing:rail' || part.geometry.kind !== 'sweep') {
      addCollider(output, node, {
        id: `${prefix}:part:${part.id}:collider`,
        bounds: boundsFor(part.geometry, composeTransform(node.transform, part.transform)),
        roomId: node.roomId,
        entityId: entity.id,
        enabled: true,
        kind: colliderKind(definition, part.role),
      })
      continue
    }

    const sampled = sampleCurve(normalizeCurve(part.geometry.path))
    const points = [...sampled.points]
    const pairs: Array<readonly [readonly [number, number, number], readonly [number, number, number]]> = []
    for (let index = 0; index + 1 < points.length; index += 1) {
      pairs.push([points[index]!, points[index + 1]!] as const)
    }
    if (sampled.closed && points.length > 2) {
      const first = points[0]!
      const last = points[points.length - 1]!
      if (first[0] !== last[0] || first[1] !== last[1] || first[2] !== last[2]) pairs.push([last, first] as const)
    }

    for (const [index, [start, end]] of pairs.entries()) {
      const segment = {
        ...part.geometry,
        path: { kind: 'polyline', points: [[...start], [...end]] },
        cap: true,
      } as GeometryDefinition
      addCollider(output, node, {
        id: `${prefix}:part:${part.id}:segment:${index}:collider`,
        bounds: boundsFor(segment, composeTransform(node.transform, part.transform)),
        roomId: node.roomId,
        entityId: entity.id,
        enabled: true,
        kind: 'solid',
      })
    }
  }

  for (const group of assembly.instanceGroups) {
    for (const placement of group.placements) {
      addCollider(output, node, {
        id: `${prefix}:group:${group.id}:${placement.index}:collider`,
        bounds: boundsFor(group.geometry, composeTransform(node.transform, placement)),
        roomId: node.roomId,
        entityId: entity.id,
        enabled: true,
        kind: colliderKind(definition, group.role),
      })
    }
  }
}

function addConstructionPartColliders(
  output: CompileAccumulator,
  entity: NormalizedEntityDefinition,
  node: CompiledEntityNode,
  definition: ArchitectureDefinition,
): void {
  const assembly = lowerArchitecture(definition)
  const prefix = `procedural:${entity.id}`
  for (const part of assembly.parts) {
    addCollider(output, node, {
      id: `${prefix}:part:${part.id}:collider`,
      bounds: boundsFor(part.geometry, composeTransform(node.transform, part.transform)),
      roomId: node.roomId,
      entityId: entity.id,
      enabled: true,
      kind: colliderKind(definition, part.role),
    })
  }
  for (const group of assembly.instanceGroups) {
    for (const placement of group.placements) {
      addCollider(output, node, {
        id: `${prefix}:group:${group.id}:${placement.index}:collider`,
        bounds: boundsFor(group.geometry, composeTransform(node.transform, placement)),
        roomId: node.roomId,
        entityId: entity.id,
        enabled: true,
        kind: colliderKind(definition, group.role),
      })
    }
  }
}

/**
 * S15 renderer-neutral procedural collision lowering.
 *
 * The result deliberately targets the existing CompiledCollider/AABB domain. Geometry
 * entities currently support coarse bounds collision. Semantic/parts policies are
 * reserved for S7 construction where the lowerer can preserve openings and stair parts.
 */
export function compileProceduralColliders(document: NormalizedWorldDocument, output: CompileAccumulator): void {
  if (!String(document.version).startsWith('0.8')) return
  const nodeById = new Map(output.entities.map((node) => [node.id, node]))

  for (const entity of flattenEntities(document.entities)) {
    if (entity.type !== 'geometry' && entity.type !== 'construction') continue
    const node = nodeById.get(entity.id)
    if (!node) throw new Error(`ANYO_PROCEDURAL_ENTITY_NOT_COMPILED\nEntity: ${entity.id}`)
    const policy = resolvePolicy(entity, node)
    if (policy === 'none') continue

    if (entity.type === 'geometry') {
      if (policy !== 'bounds') {
        throw new Error(`ANYO_PROCEDURAL_COLLISION_POLICY_UNSUPPORTED\nEntity: ${entity.id}\nPolicy: ${policy}\nGeometry entities currently support collisionPolicy "bounds" only.`)
      }
      addGeometryBoundsCollider(document, output, entity, node)
      continue
    }

    if (!entity.construction) throw new Error(`ANYO_PROCEDURAL_CONSTRUCTION_REQUIRED\nEntity: ${entity.id}`)
    if (policy === 'bounds') addConstructionBoundsCollider(output, entity, node, entity.construction)
    else if (entity.construction.type === 'railing') addRailingSegmentColliders(output, entity, node, entity.construction)
    else addConstructionPartColliders(output, entity, node, entity.construction)
  }
}
