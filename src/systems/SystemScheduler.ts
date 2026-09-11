import type {
  PluginRuntimeContext,
  RuntimeSystemsOptions,
  SystemFrameDriver,
  SystemFrameState,
  SystemRuntimeContext,
  WorldChange,
  WorldSystem,
} from '../core/types.js'
import type { RuntimeTransformStore } from './RuntimeTransformStore.js'

const DEFAULT_FIXED_DELTA = 1 / 60
const DEFAULT_MAX_SUB_STEPS = 4
const DEFAULT_MAX_FRAME_DELTA = 0.1

function positiveFinite(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`)
  return value
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`)
  return value
}

export interface SystemFrameResult {
  fixedSteps: number
  interpolationAlpha: number
}

export class SystemScheduler {
  readonly systems: readonly WorldSystem[]
  readonly fixedDeltaSeconds: number
  readonly maxSubSteps: number
  readonly maxFrameDeltaSeconds: number

  private readonly contexts = new Map<string, SystemRuntimeContext>()
  private baseContext: PluginRuntimeContext | null = null
  private accumulator = 0
  private frameNumber = 0
  private fixedStepNumber = 0
  private droppedTimeWarningEmitted = false
  private active = false

  constructor(
    systems: readonly WorldSystem[],
    options: RuntimeSystemsOptions = {},
    private readonly transforms: RuntimeTransformStore,
    private readonly warn: (message: string) => void,
  ) {
    const names = new Set<string>()
    for (const system of systems) {
      const name = system.name.trim()
      if (!name) throw new Error('World systems require a non-empty name.')
      if (names.has(name)) throw new Error(`Duplicate Anyo world system name "${name}".`)
      names.add(name)
    }
    this.systems = [...systems].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name))
    this.fixedDeltaSeconds = positiveFinite(options.fixedDeltaSeconds, DEFAULT_FIXED_DELTA, 'systemOptions.fixedDeltaSeconds')
    this.maxSubSteps = positiveInteger(options.maxSubSteps, DEFAULT_MAX_SUB_STEPS, 'systemOptions.maxSubSteps')
    this.maxFrameDeltaSeconds = positiveFinite(options.maxFrameDeltaSeconds, DEFAULT_MAX_FRAME_DELTA, 'systemOptions.maxFrameDeltaSeconds')
  }

  async setup(baseContext: PluginRuntimeContext): Promise<void> {
    this.baseContext = baseContext
    this.contexts.clear()
    this.accumulator = 0
    this.frameNumber = 0
    this.fixedStepNumber = 0
    this.droppedTimeWarningEmitted = false
    const setupSystems: WorldSystem[] = []
    try {
      for (const system of this.systems) {
        const context = this.createContext(system.name)
        this.contexts.set(system.name, context)
        await system.setup?.(context)
        setupSystems.push(system)
      }
      this.active = this.systems.length > 0
    } catch (error) {
      for (const system of setupSystems.reverse()) {
        const context = this.contexts.get(system.name)
        if (!context) continue
        try {
          if (system.teardown) system.teardown(context)
          else system.dispose?.(context)
        } catch {}
        this.transforms.clearSource(system.name)
      }
      this.contexts.clear()
      this.baseContext = null
      this.active = false
      throw error
    }
  }

  updateContext(baseContext: PluginRuntimeContext): void {
    this.baseContext = baseContext
    for (const context of this.contexts.values()) {
      context.world = baseContext.world
      context.renderer = baseContext.renderer
      context.document = baseContext.document
      context.compiled = baseContext.compiled
      context.transforms = baseContext.transforms
      context.query = baseContext.query
    }
  }

  beginFrame(deltaSeconds: number, time: number, driver: SystemFrameDriver): SystemFrameResult {
    if (!this.active || !this.baseContext || this.systems.length === 0) return { fixedSteps: 0, interpolationAlpha: 0 }
    const delta = Math.min(this.maxFrameDeltaSeconds, Math.max(0, deltaSeconds))
    this.frameNumber += 1
    this.accumulator += delta
    let fixedSteps = 0

    while (this.accumulator + Number.EPSILON >= this.fixedDeltaSeconds && fixedSteps < this.maxSubSteps) {
      this.fixedStepNumber += 1
      this.setFrameState({
        frame: this.frameNumber,
        fixedStep: this.fixedStepNumber,
        time,
        deltaSeconds: this.fixedDeltaSeconds,
        fixedDeltaSeconds: this.fixedDeltaSeconds,
        interpolationAlpha: 0,
        driver,
      })
      this.invoke('fixedUpdate', this.fixedDeltaSeconds)
      this.accumulator -= this.fixedDeltaSeconds
      fixedSteps += 1
    }

    if (this.accumulator >= this.fixedDeltaSeconds) {
      this.accumulator %= this.fixedDeltaSeconds
      if (!this.droppedTimeWarningEmitted) {
        this.warn(`Runtime systems exceeded maxSubSteps (${this.maxSubSteps}); excess fixed-step time was dropped to prevent a spiral of death.`)
        this.droppedTimeWarningEmitted = true
      }
    }

    const interpolationAlpha = Math.max(0, Math.min(1, this.accumulator / this.fixedDeltaSeconds))
    this.setFrameState({
      frame: this.frameNumber,
      fixedStep: this.fixedStepNumber,
      time,
      deltaSeconds: delta,
      fixedDeltaSeconds: this.fixedDeltaSeconds,
      interpolationAlpha,
      driver,
    })
    this.invoke('update', delta)
    return { fixedSteps, interpolationAlpha }
  }

  lateFrame(deltaSeconds: number): void {
    if (!this.active) return
    this.invoke('lateUpdate', Math.min(this.maxFrameDeltaSeconds, Math.max(0, deltaSeconds)))
  }

  async applyChanges(changes: readonly WorldChange[]): Promise<void> {
    if (!this.active) return
    for (const system of this.systems) {
      const context = this.contexts.get(system.name)
      if (context) await system.applyChanges?.(changes, context)
    }
  }

  dispose(final = false): void {
    if (!this.active && this.contexts.size === 0) return
    for (const system of [...this.systems].reverse()) {
      const context = this.contexts.get(system.name)
      if (context) {
        try {
          if (system.teardown) system.teardown(context)
          else system.dispose?.(context)
        } catch (error) {
          this.warn(`System "${system.name}" failed during world teardown: ${String(error)}`)
        }
        if (final && system.teardown && system.dispose) {
          try {
            system.dispose(context)
          } catch (error) {
            this.warn(`System "${system.name}" failed during final disposal: ${String(error)}`)
          }
        }
      }
      this.transforms.clearSource(system.name)
    }
    this.contexts.clear()
    this.baseContext = null
    this.active = false
    this.accumulator = 0
  }

  get isActive(): boolean { return this.active }

  private createContext(source: string): SystemRuntimeContext {
    const base = this.baseContext
    if (!base) throw new Error('Cannot create a system context before the world runtime is ready.')
    return {
      ...base,
      source,
      setTransform: (entityId, transform, options = {}) => {
        this.transforms.set(entityId, transform, { ...options, source })
      },
      clearTransform: (entityId) => this.transforms.clear(entityId, source),
      frame: {
        frame: 0,
        fixedStep: 0,
        time: 0,
        deltaSeconds: 0,
        fixedDeltaSeconds: this.fixedDeltaSeconds,
        interpolationAlpha: 0,
        driver: 'manual',
      },
    }
  }

  private setFrameState(state: SystemFrameState): void {
    for (const context of this.contexts.values()) context.frame = state
  }

  private invoke(method: 'fixedUpdate' | 'update' | 'lateUpdate', deltaSeconds: number): void {
    for (const system of this.systems) {
      const callback = system[method]
      const context = this.contexts.get(system.name)
      if (!callback || !context) continue
      try {
        callback.call(system, deltaSeconds, context)
      } catch (error) {
        this.warn(`System "${system.name}" failed during ${method}: ${String(error)}`)
      }
    }
  }
}
