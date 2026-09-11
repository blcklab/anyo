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
  extensions?: readonly ExtensionSchemaContribution[]
}

function clone<T>(value: T): T { return structuredClone(value) }

function defaultBaseSchema(): Record<string, JsonValue> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://anyo.blcklab.dev/schemas/world-0.7.schema.json',
    title: 'Anyo World 0.7',
    type: 'object',
    required: ['version'],
    properties: {
      version: { type: 'string', pattern: '^0\\.7(?:\\.|$)' },
      extensions: { type: 'object', additionalProperties: true },
      entities: { type: 'array', items: { $ref: '#/$defs/entity' } },
    },
    additionalProperties: false,
    $defs: {
      component: { type: 'object', required: ['type'], properties: { type: { type: 'string' } }, additionalProperties: true },
      entity: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, components: { type: 'array', items: { $ref: '#/$defs/component' } } }, additionalProperties: true },
    },
  }
}

export function createWorldSchema(options: CreateWorldSchemaOptions = {}): Record<string, JsonValue> {
  const schema = clone(options.baseSchema ?? defaultBaseSchema())
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
