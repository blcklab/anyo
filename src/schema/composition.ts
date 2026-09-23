import type { JsonValue } from '../core/types.js'

export interface ExtensionSchemaContribution {
  id: string
  root?: Record<string, JsonValue>
  components?: readonly Record<string, JsonValue>[]
  entities?: readonly Record<string, JsonValue>[]
  definitions?: Record<string, JsonValue>
}
export interface CreateWorldSchemaOptions {
  baseSchema?: Record<string, JsonValue>
  version?: '0.7' | '0.8'
  extensions?: readonly ExtensionSchemaContribution[]
}

function clone<T>(value: T): T { return structuredClone(value) }

function defaultBaseSchema(version: '0.7' | '0.8' = '0.7'): Record<string, JsonValue> {
  const procedural = version === '0.8'
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://anyo.blcklab.dev/schemas/world-${version}.schema.json`,
    title: `Anyo World ${version}`,
    type: 'object',
    required: ['version'],
    properties: {
      version: { type: 'string', pattern: `^${version.replace('.', '\\.')}(?:\\.|$)` },
      extensions: { type: 'object', additionalProperties: true },
      ...(procedural ? { geometries: { type: 'object', additionalProperties: { $ref: '#/$defs/geometryDefinition' } } } : {}),
      entities: { type: 'array', items: { $ref: '#/$defs/entity' } },
    },
    additionalProperties: false,
    $defs: {
      component: { type: 'object', required: ['type'], properties: { type: { type: 'string' } }, additionalProperties: true },
      ...(procedural ? { geometryDefinition: { type: 'object', required: ['kind'], properties: { kind: { type: 'string' } }, additionalProperties: true } } : {}),
      entity: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, ...(procedural ? { geometry: { oneOf: [{ type: 'string' }, { $ref: '#/$defs/geometryDefinition' }] }, construction: { type: 'object' }, materialBindings: { type: 'object', additionalProperties: { type: 'string' } }, collisionPolicy: { enum: ['none', 'bounds', 'semantic', 'parts'] } } : {}), components: { type: 'array', items: { $ref: '#/$defs/component' } } }, additionalProperties: true },
    },
  }
}

export function createWorldSchema(options: CreateWorldSchemaOptions = {}): Record<string, JsonValue> {
  const schema = clone(options.baseSchema ?? defaultBaseSchema(options.version))
  const defs = (schema.$defs ??= {}) as Record<string, JsonValue>
  const properties = (schema.properties ??= {}) as Record<string, JsonValue>
  const extensionIds = new Set<string>()
  const componentVariants: JsonValue[] = []
  const entityVariants: JsonValue[] = []

  for (const extension of [...(options.extensions ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!/^[A-Za-z0-9@][A-Za-z0-9@._/-]*$/.test(extension.id)) throw new Error(`Invalid extension schema id "${extension.id}".`)
    if (extensionIds.has(extension.id)) throw new Error(`Extension schema "${extension.id}" is duplicated.`)
    extensionIds.add(extension.id)
    const prefix = extension.id.replace(/[^A-Za-z0-9]+/g, '_')
    for (const [name, definition] of Object.entries(extension.definitions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const key = `${prefix}__${name}`
      if (key in defs) throw new Error(`Composed schema definition "${key}" is duplicated.`)
      defs[key] = clone(definition)
    }
    componentVariants.push(...(extension.components ?? []).map(clone))
    entityVariants.push(...(extension.entities ?? []).map(clone))
    if (extension.root) {
      const extensionRoot = ((properties.extensions as Record<string, JsonValue>).properties ??= {}) as Record<string, JsonValue>
      extensionRoot[extension.id] = clone(extension.root)
    }
  }
  if (componentVariants.length) {
    const component = defs.component as Record<string, JsonValue>
    defs.component = { oneOf: [clone(component), ...componentVariants] }
  }
  if (entityVariants.length) {
    const entity = defs.entity as Record<string, JsonValue>
    defs.entity = { oneOf: [clone(entity), ...entityVariants] }
  }
  return schema
}
