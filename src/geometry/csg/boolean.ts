import type { GeometryCompileContext, GeometryKindCompiler } from '../core/GeometryCompiler.js'
import type { GeometryDefinition, GeometryIssue, GeometryJsonValue, GeometryMesh, GeometryMeshDraft, GeometrySafetyLimits } from '../types/index.js'
import { GeometryValidationError } from '../validation/errors.js'
import { resolveGeometrySafetyLimits } from '../validation/limits.js'
import { finalizeGeometryMesh } from '../validation/validateMesh.js'
import { BspNode, CsgWorkBudget } from './bsp.js'
import { csgEpsilon, csgPolygonsToMesh, meshToCsgPolygons } from './solid.js'
import type { CsgOperation, CsgPolygon } from './types.js'

export const CSG_OPERATIONS: readonly CsgOperation[] = Object.freeze(['union', 'subtract', 'intersect'])

export const unionGeometryKind = createBooleanGeometryKind('union')
export const subtractGeometryKind = createBooleanGeometryKind('subtract')
export const intersectGeometryKind = createBooleanGeometryKind('intersect')

export function booleanGeometryMeshes(
  left: GeometryMesh,
  right: GeometryMesh,
  operation: CsgOperation,
  options: { limits?: Partial<GeometrySafetyLimits> } = {},
): GeometryMesh {
  if (operation !== 'union' && operation !== 'subtract' && operation !== 'intersect') {
    throw new GeometryValidationError([{
      code: 'GEOMETRY_PARAMETER_INVALID', path: '/operation',
      message: 'Boolean operation must be union, subtract, or intersect.',
    }])
  }
  const limits = resolveGeometrySafetyLimits(options.limits)
  return finalizeGeometryMesh(booleanGeometryDraft(left, right, operation, limits), { limits })
}

export function booleanGeometryDraft(
  left: GeometryMesh,
  right: GeometryMesh,
  operation: CsgOperation,
  limits: GeometrySafetyLimits,
): GeometryMeshDraft {
  const epsilon = csgEpsilon(left, right)
  const budget = new CsgWorkBudget(limits, epsilon)
  const leftPolygons = meshToCsgPolygons(left, 'left', '/left', limits, epsilon)
  const rightPolygons = meshToCsgPolygons(right, 'right', '/right', limits, epsilon)
  budget.consume(leftPolygons.length + rightPolygons.length)
  const result = performBoolean(leftPolygons, rightPolygons, operation, budget)
  return csgPolygonsToMesh(result, operation, limits, epsilon)
}

function createBooleanGeometryKind(operation: CsgOperation): GeometryKindCompiler {
  return {
    kind: operation,
    normalize(definition, context) {
      const left = context.normalizeBooleanChild(requireRecord(definition.left, '/left'), operation)
      const right = context.normalizeBooleanChild(requireRecord(definition.right, '/right'), operation)
      return {
        ...definition,
        left: left as unknown as GeometryJsonValue,
        right: right as unknown as GeometryJsonValue,
      }
    },
    compile(definition, context) {
      const left = context.compileBooleanChild(requireRecord(definition.left, '/left'), operation)
      const right = context.compileBooleanChild(requireRecord(definition.right, '/right'), operation)
      return booleanGeometryDraft(left, right, operation, context.limits)
    },
  }
}

function performBoolean(left: CsgPolygon[], right: CsgPolygon[], operation: CsgOperation, budget: CsgWorkBudget): CsgPolygon[] {
  const a = new BspNode(left, budget)
  const b = new BspNode(right, budget)
  switch (operation) {
    case 'union':
      a.clipTo(b)
      b.clipTo(a)
      b.invert()
      b.clipTo(a)
      b.invert()
      a.build(b.allPolygons())
      return a.allPolygons()
    case 'subtract':
      a.invert()
      a.clipTo(b)
      b.clipTo(a)
      b.invert()
      b.clipTo(a)
      b.invert()
      a.build(b.allPolygons())
      a.invert()
      return a.allPolygons()
    case 'intersect':
      a.invert()
      b.clipTo(a)
      b.invert()
      a.clipTo(b)
      b.clipTo(a)
      a.build(b.allPolygons())
      a.invert()
      return a.allPolygons()
  }
}

function requireRecord(value: unknown, path: string): GeometryDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) parameterError(path, `${path.slice(1)} must be a geometry definition object.`)
  return value as GeometryDefinition
}
function parameterError(path: string, message: string): never {
  const issue: GeometryIssue = { code: 'GEOMETRY_PARAMETER_INVALID', path, message }
  throw new GeometryValidationError([issue])
}
