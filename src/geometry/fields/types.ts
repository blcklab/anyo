import type { GeometryJsonValue, ScalarFieldDefinition } from '../types/index.js'

/** Canonical field definition after named references and defaults are resolved. */
export type NormalizedScalarFieldDefinition = ScalarFieldDefinition

export interface ScalarFieldSampleOptions {
  fields?: Readonly<Record<string, ScalarFieldDefinition>>
  path?: string
}

export type ScalarFieldJsonRecord = { [key: string]: GeometryJsonValue | undefined }
