const TAU = Math.PI * 2

function finitePositive(value, fallback, name) {
  const resolved = value ?? fallback
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved <= 0) throw new Error(`${name} must be a positive finite number.`)
  return resolved
}
function integerRange(value, fallback, name, min, max) {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new Error(`${name} must be an integer in [${min}, ${max}].`)
  return resolved
}
function finite(value, fallback, name) {
  const resolved = value ?? fallback
  if (typeof resolved !== 'number' || !Number.isFinite(resolved)) throw new Error(`${name} must be a finite number.`)
  return resolved
}

const twistedSpire = {
  name: 'twisted-spire',
  normalize(definition) {
    const params = definition.params ?? {}
    return {
      ...definition,
      params: {
        radius: finitePositive(params.radius, 0.6, 'radius'),
        height: finitePositive(params.height, 4, 'height'),
        segments: integerRange(params.segments, 24, 'segments', 3, 256),
        twist: finite(params.twist, Math.PI * 1.5, 'twist'),
        topScale: finitePositive(params.topScale, 0.28, 'topScale'),
      },
    }
  },
  compile(definition, context) {
    const { radius, height, segments, twist, topScale } = definition.params
    return context.compileSource({
      kind: 'pipeline',
      source: { kind: 'cylinder', radius, height, segments, cap: true },
      modifiers: [
        { kind: 'taper', axis: 'y', startScale: 1, endScale: topScale },
        { kind: 'twist', axis: 'y', angle: twist },
      ],
    })
  },
}

const stellatedPrism = {
  name: 'stellated-prism',
  normalize(definition) {
    const params = definition.params ?? {}
    const outerRadius = finitePositive(params.outerRadius, 1, 'outerRadius')
    const innerRadius = finitePositive(params.innerRadius, 0.5, 'innerRadius')
    if (innerRadius >= outerRadius) throw new Error('innerRadius must be smaller than outerRadius.')
    return {
      ...definition,
      params: {
        outerRadius,
        innerRadius,
        height: finitePositive(params.height, 0.35, 'height'),
        points: integerRange(params.points, 7, 'points', 3, 64),
      },
    }
  },
  compile(definition, context) {
    const { outerRadius, innerRadius, height, points } = definition.params
    const ringCount = points * 2
    const halfHeight = height / 2
    const positions = [0, halfHeight, 0]
    for (let i = 0; i < ringCount; i += 1) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius
      const angle = (i / ringCount) * TAU
      positions.push(Math.cos(angle) * radius, halfHeight, Math.sin(angle) * radius)
    }
    const bottomCenter = positions.length / 3
    positions.push(0, -halfHeight, 0)
    const bottomStart = positions.length / 3
    for (let i = 0; i < ringCount; i += 1) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius
      const angle = (i / ringCount) * TAU
      positions.push(Math.cos(angle) * radius, -halfHeight, Math.sin(angle) * radius)
    }

    const indices = []
    for (let i = 0; i < ringCount; i += 1) {
      const next = (i + 1) % ringCount
      const topA = 1 + i
      const topB = 1 + next
      const bottomA = bottomStart + i
      const bottomB = bottomStart + next
      indices.push(0, topB, topA)
      indices.push(bottomCenter, bottomA, bottomB)
      indices.push(topA, bottomA, bottomB, topA, bottomB, topB)
    }

    return context.compileSource({
      kind: 'mesh',
      positions,
      indices,
      normals: { mode: 'flat' },
    })
  },
}

export const referenceGeometryProvider = Object.freeze({
  namespace: 'blcklab.reference',
  version: '0.1.0',
  kinds: Object.freeze([twistedSpire, stellatedPrism]),
})

export default referenceGeometryProvider
