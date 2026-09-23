export type CsgOperation = 'union' | 'subtract' | 'intersect'
export type CsgSource = 'left' | 'right'

export type CsgVec2 = [number, number]
export type CsgVec3 = [number, number, number]
export type CsgVec4 = [number, number, number, number]

export interface CsgVertex {
  position: CsgVec3
  normal?: CsgVec3
  uv?: CsgVec2
  tangent?: CsgVec4
  color?: CsgVec4
}

export interface CsgPlane {
  normal: CsgVec3
  w: number
}

export interface CsgPolygon {
  vertices: CsgVertex[]
  plane: CsgPlane
  source: CsgSource
  groupName?: string
}
