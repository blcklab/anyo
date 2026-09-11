import { World } from './World.js'
import type { CreateWorldOptions } from './types.js'

export function createWorld(options: CreateWorldOptions = {}): World {
  return new World(options)
}
