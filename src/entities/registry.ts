import type { ResolvedEntityComponents } from '../components/index.js'
import type {
  CompileAccumulator,
  EntityDefinition,
  NormalizedWorldDocument,
  Size3,
  TransformDefinition,
} from '../core/types.js'

export interface EntityCompileContext {
  entity: EntityDefinition
  document: NormalizedWorldDocument
  output: CompileAccumulator
  transform: TransformDefinition
  size: Size3
  roomId?: string
  sourcePath: string
  parentId?: string
  components: ResolvedEntityComponents
}

export interface EntityTypeRegistration {
  type: string
  validate?(entity: EntityDefinition, sourcePath: string): void
  compile(context: EntityCompileContext): void
}

export class EntityTypeRegistry {
  private readonly registrations = new Map<string, EntityTypeRegistration>()

  register(registration: EntityTypeRegistration): () => void {
    const type = registration.type.trim()
    if (!type) throw new Error('Entity type registrations require a non-empty type.')
    if (this.registrations.has(type)) throw new Error(`Entity type "${type}" is already registered.`)
    this.registrations.set(type, { ...registration, type })
    return () => {
      if (this.registrations.get(type) === registration) this.registrations.delete(type)
      else this.registrations.delete(type)
    }
  }

  get(type: string): EntityTypeRegistration | undefined {
    return this.registrations.get(type)
  }

  has(type: string): boolean {
    return this.registrations.has(type)
  }
}

export function createEntityTypeRegistry(): EntityTypeRegistry {
  return new EntityTypeRegistry()
}
