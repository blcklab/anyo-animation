import type { PluginRuntimeContext } from '@blcklab/anyo'
import { createAnimationDiagnostic } from './diagnostics.js'
import { AnimationParameterStore } from './ParameterStore.js'
import { animationConfigKey, parseAnimationComponent } from './schema.js'
import { selectAnimationTransition, transitionTriggerNames } from './state-machine.js'
import {
  ANYO_ANIMATION_COMPONENT,
  ANYO_ANIMATION_SNAPSHOT_VERSION,
  type AnimationActionReference,
  type AnimationActiveTransitionSnapshot,
  type AnimationBindingEvent,
  type AnimationComponentConfig,
  type AnimationDiagnostic,
  type AnimationEntityBinding,
  type AnimationEntityRuntimeSnapshot,
  type AnimationEntitySnapshot,
  type AnimationLoopMode,
  type AnimationParameterBinding,
  type AnimationParameterSnapshot,
  type AnimationParameterValue,
  type AnimationPluginOptions,
  type AnimationRootMotionEvent,
  type AnimationRuntimeAdapter,
  type AnimationRuntimeSnapshot,
  type AnimationTransitionConfig,
} from './types.js'

interface DesiredPlayback {
  clip?: string
  loop?: AnimationLoopMode
  speed: number
  startTime?: number
  state: 'none' | 'playing' | 'paused' | 'stopped'
}

interface ActiveTransition {
  config: AnimationTransitionConfig
  from: string
  to: string
  elapsed: number
}

interface EntityRecord {
  entityId: string
  config: AnimationComponentConfig
  configKey: string
  binding: AnimationEntityBinding | null
  bindingCleanup: (() => void) | null
  desired: DesiredPlayback
  status: AnimationEntitySnapshot['status']
  activeClip: string | undefined
  parameters: AnimationParameterStore
  currentState: string | undefined
  transition: ActiveTransition | undefined
  rootMotion: [number, number, number]
}

export class AnimationController {
  private readonly records = new Map<string, EntityRecord>()
  private context: PluginRuntimeContext | null = null
  private elapsedSeconds = 0

  constructor(
    readonly adapter: AnimationRuntimeAdapter,
    private readonly options: Pick<AnimationPluginOptions, 'onDiagnostic' | 'onRootMotion' | 'strict'> = {},
  ) {}

  bind(context: PluginRuntimeContext): void {
    this.context = context
    this.reconcile(context)
  }

  reconcile(context = this.context): void {
    if (!context) return
    this.context = context
    const seen = new Set<string>()

    for (const match of context.query.components(ANYO_ANIMATION_COMPONENT)) {
      const entityId = match.entity.id
      seen.add(entityId)
      let config: AnimationComponentConfig
      try {
        config = parseAnimationComponent(match.component)
      } catch (error) {
        this.report('error', 'ANYO_ANIMATION_COMPONENT_INVALID', errorMessage(error), entityId, {
          sourcePath: match.component.sourcePath,
        })
        const stale = this.records.get(entityId)
        if (stale) this.disposeRecord(stale)
        this.records.delete(entityId)
        if (this.options.strict) throw error
        continue
      }

      const key = animationConfigKey(config)
      const current = this.records.get(entityId)
      if (current?.binding?.isAvailable && !current.binding.isAvailable()) {
        this.detachBinding(current)
        current.status = 'pending'
      }
      if (!current) {
        this.records.set(entityId, this.createRecord(entityId, config, key))
      } else if (current.configKey !== key) {
        const parameterSnapshot = current.parameters.snapshot()
        this.detachBinding(current)
        this.clearRootMotion(current)
        current.config = config
        current.configKey = key
        current.status = 'pending'
        current.parameters.reconfigure(config.parameters)
        current.parameters.restore(parameterSnapshot)
        current.currentState = config.stateMachine?.states[current.currentState ?? '']
          ? current.currentState
          : config.stateMachine?.initial
        current.transition = undefined
        current.rootMotion = [0, 0, 0]
        current.desired = this.initialDesired(config, current.currentState)
        current.activeClip = current.desired.clip
      }

      const record = this.records.get(entityId)
      if (record && !record.binding) this.attach(record, context)
    }

    for (const [entityId, record] of this.records) {
      if (seen.has(entityId)) continue
      this.disposeRecord(record)
      this.records.delete(entityId)
    }
  }

  play(
    entityId: string,
    clip: string,
    options: { loop?: AnimationLoopMode; speed?: number; startTime?: number } = {},
  ): boolean {
    const record = this.requireRecord(entityId)
    const speed = positiveFinite(options.speed ?? record.config.speed, 'speed')
    record.currentState = undefined
    record.transition = undefined
    record.desired = {
      clip,
      loop: options.loop ?? record.config.loop,
      speed,
      state: 'playing',
      ...(options.startTime !== undefined ? { startTime: nonNegativeFinite(options.startTime, 'startTime') } : {}),
    }
    record.activeClip = clip
    if (!record.binding) return this.queuePending(record, clip)
    this.applyDesired(record)
    return true
  }

  transitionTo(entityId: string, state: string, duration = 0.2): boolean {
    const record = this.requireRecord(entityId)
    const machine = record.config.stateMachine
    if (!machine?.states[state]) {
      const message = `Unknown animation state "${state}".`
      this.report('error', 'ANYO_ANIMATION_STATE_NOT_FOUND', message, record.entityId)
      throw new Error(message)
    }
    const from = record.currentState ?? state
    this.enterState(record, state, Math.max(0, duration), from)
    return Boolean(record.binding)
  }

  pause(entityId: string): boolean {
    const record = this.requireRecord(entityId)
    record.desired.state = 'paused'
    if (!record.binding) return false
    record.binding.pause()
    record.status = 'paused'
    this.emit('animation:pause', { entityId: record.entityId, clip: record.activeClip })
    return true
  }

  resume(entityId: string): boolean {
    const record = this.requireRecord(entityId)
    record.desired.state = 'playing'
    if (!record.binding) return false
    if (record.activeClip) record.binding.resume()
    else if (record.currentState) this.enterState(record, record.currentState, 0, record.currentState)
    else if (record.config.defaultClip) return this.play(record.entityId, record.config.defaultClip)
    record.status = 'playing'
    this.emit('animation:resume', { entityId: record.entityId, clip: record.activeClip })
    return true
  }

  stop(entityId: string): boolean {
    const record = this.requireRecord(entityId)
    record.desired.state = 'stopped'
    record.transition = undefined
    if (!record.binding) {
      record.status = 'stopped'
      return false
    }
    record.binding.stop()
    record.status = 'stopped'
    this.emit('animation:stop', { entityId: record.entityId, clip: record.activeClip })
    return true
  }

  seek(entityId: string, time: number): boolean {
    const record = this.requireRecord(entityId)
    const resolved = nonNegativeFinite(time, 'time')
    record.desired.startTime = resolved
    if (!record.binding) return false
    record.binding.seek(resolved)
    this.emit('animation:seek', { entityId: record.entityId, time: resolved })
    return true
  }

  setSpeed(entityId: string, speed: number): boolean {
    const record = this.requireRecord(entityId)
    const resolved = positiveFinite(speed, 'speed')
    record.desired.speed = resolved
    if (!record.binding) return false
    record.binding.setSpeed(resolved)
    this.emit('animation:speed', { entityId: record.entityId, speed: resolved })
    return true
  }

  setBoolean(entityId: string, parameter: string, value: boolean): boolean {
    return this.parameterOperation(entityId, parameter, () => this.requireRecord(entityId).parameters.setBoolean(parameter, value))
  }

  setNumber(entityId: string, parameter: string, value: number): boolean {
    return this.parameterOperation(entityId, parameter, () => this.requireRecord(entityId).parameters.setNumber(parameter, value))
  }

  setTrigger(entityId: string, parameter: string): boolean {
    return this.parameterOperation(entityId, parameter, () => this.requireRecord(entityId).parameters.setTrigger(parameter))
  }

  resetTrigger(entityId: string, parameter: string): boolean {
    return this.parameterOperation(entityId, parameter, () => this.requireRecord(entityId).parameters.resetTrigger(parameter))
  }

  setParameter(entityId: string, parameter: string, value: AnimationParameterValue): boolean {
    return this.parameterOperation(entityId, parameter, () => this.requireRecord(entityId).parameters.setParameter(parameter, value))
  }

  getParameter(entityId: string, parameter: string): AnimationParameterValue | undefined {
    return this.requireRecord(entityId).parameters.get(parameter)
  }

  subscribeParameter(
    entityId: string,
    parameter: string,
    listener: (value: AnimationParameterValue) => void,
  ): () => void {
    return this.requireRecord(entityId).parameters.subscribe(parameter, listener)
  }

  bindParameter(entityId: string, parameter: string, binding: AnimationParameterBinding): () => void {
    return this.requireRecord(entityId).parameters.bind(parameter, binding)
  }

  createParameterSnapshot(entityId: string): AnimationParameterSnapshot {
    return this.requireRecord(entityId).parameters.snapshot()
  }

  restoreParameterSnapshot(entityId: string, snapshot: AnimationParameterSnapshot): void {
    this.requireRecord(entityId).parameters.restore(snapshot)
  }

  createSnapshot(): AnimationRuntimeSnapshot {
    return Object.freeze({
      version: ANYO_ANIMATION_SNAPSHOT_VERSION,
      entities: Object.freeze([...this.records.values()].map((record) => this.entityRuntimeSnapshot(record))),
    })
  }

  restoreSnapshot(snapshot: AnimationRuntimeSnapshot): void {
    if (snapshot.version !== ANYO_ANIMATION_SNAPSHOT_VERSION || !Array.isArray(snapshot.entities)) {
      const message = 'Animation snapshot has an unsupported schema version.'
      this.report('error', 'ANYO_ANIMATION_SNAPSHOT_INVALID', message)
      throw new Error(message)
    }
    for (const entity of snapshot.entities) {
      const record = this.records.get(entity.entityId)
      if (!record) continue
      record.parameters.restore(entity.parameters)
      record.rootMotion = [entity.rootMotion[0], entity.rootMotion[1], entity.rootMotion[2]]
      if (entity.currentState && record.config.stateMachine?.states[entity.currentState]) {
        this.enterState(record, entity.currentState, 0, record.currentState ?? entity.currentState)
      } else if (entity.activeClip) {
        this.play(record.entityId, entity.activeClip, { speed: entity.speed, ...(entity.time !== undefined ? { startTime: entity.time } : {}) })
      }
      if (entity.status === 'paused') this.pause(record.entityId)
      else if (entity.status === 'stopped') this.stop(record.entityId)
    }
  }

  pauseAll(): void { for (const entityId of this.records.keys()) this.pause(entityId) }
  resumeAll(): void { for (const entityId of this.records.keys()) this.resume(entityId) }
  stopAll(): void { for (const entityId of this.records.keys()) this.stop(entityId) }
  has(entityId: string): boolean { return Boolean(this.findRecord(entityId)) }

  get(entityId: string): AnimationEntitySnapshot | null {
    const record = this.findRecord(entityId)
    if (!record) return null
    const time = record.binding?.getTime?.()
    const transition = record.transition ? transitionSnapshot(record.transition) : undefined
    return Object.freeze({
      entityId: record.entityId,
      status: record.status,
      configuredClips: record.config.clips,
      availableClips: Object.freeze([...(record.binding?.availableClips ?? [])]),
      ...(record.activeClip ? { activeClip: record.activeClip } : {}),
      speed: record.desired.speed,
      ...(time !== undefined ? { time } : {}),
      ...(record.currentState ? { currentState: record.currentState } : {}),
      ...(transition ? { transition } : {}),
      parameters: record.parameters.snapshot(),
      rootMotion: Object.freeze([...record.rootMotion]) as readonly [number, number, number],
    })
  }

  list(): readonly AnimationEntitySnapshot[] {
    return [...this.records.keys()]
      .map((entityId) => this.get(entityId))
      .filter((value): value is AnimationEntitySnapshot => value !== null)
  }

  update(deltaSeconds: number): void {
    const delta = Math.max(0, deltaSeconds)
    this.elapsedSeconds += delta
    for (const record of this.records.values()) {
      try {
        record.parameters.updateBindings({ entityId: record.entityId, deltaSeconds: delta, elapsedSeconds: this.elapsedSeconds })
        this.evaluateStateMachine(record)
      } catch (error) {
        this.report('error', 'ANYO_ANIMATION_PARAMETER_VALUE_INVALID', errorMessage(error), record.entityId)
        if (this.options.strict) throw error
      }
    }
    this.adapter.update?.(delta)
    for (const record of this.records.values()) {
      this.processRootMotion(record)
      if (record.transition) {
        record.transition.elapsed += delta
        if (record.transition.elapsed >= record.transition.config.duration) {
          const completed = record.transition
          record.transition = undefined
          this.emit('animation:transition-complete', {
            entityId: record.entityId, id: completed.config.id, from: completed.from, to: completed.to,
          })
        }
      }
    }
  }

  dispose(): void {
    for (const record of this.records.values()) this.disposeRecord(record)
    this.records.clear()
    this.context = null
    this.elapsedSeconds = 0
  }

  private createRecord(entityId: string, config: AnimationComponentConfig, key: string): EntityRecord {
    const currentState = config.stateMachine?.initial
    const desired = this.initialDesired(config, currentState)
    return {
      entityId,
      config,
      configKey: key,
      binding: null,
      bindingCleanup: null,
      desired,
      status: 'pending',
      activeClip: desired.clip,
      parameters: new AnimationParameterStore(config.parameters),
      currentState,
      transition: undefined,
      rootMotion: [0, 0, 0],
    }
  }

  private initialDesired(config: AnimationComponentConfig, currentState?: string): DesiredPlayback {
    const state = currentState ? config.stateMachine?.states[currentState] : undefined
    const clip = state?.clip ?? config.defaultClip
    return {
      speed: state?.speed ?? config.speed,
      state: config.autoplay && clip ? 'playing' : 'none',
      ...(clip ? { clip } : {}),
      loop: state?.loop ?? config.loop,
      ...(state?.startTime !== undefined ? { startTime: state.startTime } : {}),
    }
  }

  private attach(record: EntityRecord, context: PluginRuntimeContext): void {
    try {
      const entity = context.query.entity(record.entityId)
      if (!entity) return
      const binding = this.adapter.attachEntity({
        entity,
        primitiveIds: context.query.primitives(record.entityId).map((primitive) => primitive.id),
        config: record.config,
        context,
      })
      if (!binding) return
      record.binding = binding
      record.bindingCleanup = binding.onEvent?.((event) => this.handleBindingEvent(record, event)) ?? null
      record.status = 'ready'
      this.applyDesired(record)
      if (record.currentState && record.config.autoplay) this.runActions(record, record.config.stateMachine?.states[record.currentState]?.onEnter ?? [])
      this.emit('animation:ready', { entityId: record.entityId, clips: [...binding.availableClips] })
    } catch (error) {
      this.report('error', 'ANYO_ANIMATION_ADAPTER_ERROR', errorMessage(error), record.entityId)
      if (this.options.strict) throw error
    }
  }

  private applyDesired(record: EntityRecord): void {
    const binding = record.binding
    if (!binding) return
    binding.setSpeed(record.desired.speed)
    if (record.desired.state === 'stopped') {
      binding.stop()
      record.status = 'stopped'
      return
    }
    if (!record.desired.clip) {
      record.status = 'ready'
      return
    }
    try {
      binding.play({
        clip: record.desired.clip,
        loop: record.desired.loop ?? record.config.loop,
        speed: record.desired.speed,
        ...(record.desired.startTime !== undefined ? { startTime: record.desired.startTime } : {}),
      })
    } catch (error) {
      this.report('error', 'ANYO_ANIMATION_CLIP_NOT_FOUND', errorMessage(error), record.entityId, {
        requestedClip: record.desired.clip,
        availableClips: [...binding.availableClips],
      })
      if (this.options.strict) throw error
      record.status = 'ready'
      return
    }
    record.status = record.desired.state === 'paused' ? 'paused' : 'playing'
    if (record.desired.state === 'paused') binding.pause()
    this.emit('animation:play', {
      entityId: record.entityId,
      clip: record.desired.clip,
      loop: record.desired.loop ?? record.config.loop,
      speed: record.desired.speed,
    })
  }

  private evaluateStateMachine(record: EntityRecord): void {
    const machine = record.config.stateMachine
    if (!machine || !record.currentState || record.status !== 'playing' || !record.binding) return
    if (record.transition && !record.transition.config.interruptible) return
    const transition = selectAnimationTransition(
      machine,
      record.currentState,
      record.parameters.snapshot(),
      record.binding.getNormalizedTime?.(),
    )
    if (!transition || transition.to === record.currentState) return
    for (const trigger of transitionTriggerNames(transition)) record.parameters.consumeTrigger(trigger)
    this.enterState(record, transition.to, transition.duration, record.currentState, transition)
  }

  private enterState(
    record: EntityRecord,
    stateName: string,
    duration: number,
    from: string,
    transitionConfig?: AnimationTransitionConfig,
  ): void {
    const machine = record.config.stateMachine
    const state = machine?.states[stateName]
    if (!state) return
    if (record.transition) {
      this.emit('animation:transition-interrupted', {
        entityId: record.entityId,
        id: record.transition.config.id,
        from: record.transition.from,
        to: record.transition.to,
        next: stateName,
      })
    }
    const previous = record.currentState ? machine.states[record.currentState] : undefined
    if (record.currentState !== stateName) this.runActions(record, previous?.onExit ?? [])
    record.currentState = stateName
    record.activeClip = state.clip
    record.desired = {
      clip: state.clip,
      loop: state.loop ?? record.config.loop,
      speed: state.speed ?? record.config.speed,
      state: 'playing',
      ...(state.startTime !== undefined ? { startTime: state.startTime } : {}),
    }
    if (record.binding) {
      const request = {
        clip: state.clip,
        loop: state.loop ?? record.config.loop,
        speed: state.speed ?? record.config.speed,
        ...(state.startTime !== undefined ? { startTime: state.startTime } : {}),
      }
      try {
        if (duration > 0 && record.binding.crossFade) record.binding.crossFade({ ...request, duration })
        else record.binding.play(request)
        record.status = 'playing'
      } catch (error) {
        this.report('error', 'ANYO_ANIMATION_CLIP_NOT_FOUND', errorMessage(error), record.entityId)
        if (this.options.strict) throw error
      }
    } else record.status = 'pending'
    this.runActions(record, state.onEnter)
    if (transitionConfig) {
      record.transition = { config: transitionConfig, from, to: stateName, elapsed: 0 }
      this.emit('animation:transition-start', { entityId: record.entityId, id: transitionConfig.id, from, to: stateName, duration })
    } else record.transition = undefined
    this.emit('animation:state-enter', { entityId: record.entityId, state: stateName, from })
  }

  private handleBindingEvent(record: EntityRecord, event: AnimationBindingEvent): void {
    if (event.type === 'marker') {
      this.emit('animation:marker', { entityId: record.entityId, clip: record.activeClip, ...event })
      for (const binding of record.config.markers) {
        if (binding.marker === event.name) this.runActions(record, binding.actions, { marker: event.name, markerData: event.data })
      }
    } else {
      this.emit('animation:complete', { entityId: record.entityId, clip: event.clip })
    }
  }

  private processRootMotion(record: EntityRecord): void {
    const mode = record.config.rootMotion.mode
    if (mode === 'disabled') return
    const delta = record.binding?.consumeRootMotion?.()
    if (!delta || (delta[0] === 0 && delta[1] === 0 && delta[2] === 0)) return
    const resolved: [number, number, number] = mode === 'horizontal-only'
      ? [delta[0], 0, delta[2]]
      : [delta[0], delta[1], delta[2]]
    record.rootMotion[0] += resolved[0]
    record.rootMotion[1] += resolved[1]
    record.rootMotion[2] += resolved[2]
    const event: AnimationRootMotionEvent = Object.freeze({
      entityId: record.entityId,
      delta: Object.freeze([...resolved]) as readonly [number, number, number],
      accumulated: Object.freeze([...record.rootMotion]) as readonly [number, number, number],
      mode,
    })
    if (mode === 'apply-to-entity' || mode === 'horizontal-only') {
      if (this.context && typeof this.context.transforms.set === 'function') this.context.transforms.set(record.entityId, { position: record.rootMotion }, {
        source: record.config.rootMotion.source,
        priority: record.config.rootMotion.priority,
        mode: 'additive',
        space: 'local',
      })
    }
    this.options.onRootMotion?.(event)
    this.emit('animation:root-motion', event)
  }

  private runActions(
    record: EntityRecord,
    actions: readonly AnimationActionReference[],
    extra: Readonly<Record<string, unknown>> = {},
  ): void {
    const world = this.context?.world
    if (!world) return
    for (const reference of actions) {
      const params = { ...(reference.params ?? {}), entityId: record.entityId, ...extra }
      void world.runAction(reference.action, params, 'anyo:animation').catch((error) => {
        this.report('error', 'ANYO_ANIMATION_ACTION_ERROR', errorMessage(error), record.entityId, { action: reference.action })
      })
    }
  }

  private entityRuntimeSnapshot(record: EntityRecord): AnimationEntityRuntimeSnapshot {
    const time = record.binding?.getTime?.()
    return Object.freeze({
      entityId: record.entityId,
      parameters: record.parameters.snapshot(),
      ...(record.currentState ? { currentState: record.currentState } : {}),
      ...(record.activeClip ? { activeClip: record.activeClip } : {}),
      status: record.status,
      speed: record.desired.speed,
      ...(time !== undefined ? { time } : {}),
      rootMotion: Object.freeze([...record.rootMotion]) as readonly [number, number, number],
    })
  }

  private queuePending(record: EntityRecord, clip: string): false {
    record.status = 'pending'
    this.report('info', 'ANYO_ANIMATION_ASSET_PENDING', `Animation play request for "${clip}" is queued until the entity asset is ready.`, record.entityId)
    return false
  }

  private parameterOperation(entityId: string, parameter: string, operation: () => boolean): boolean {
    try {
      const changed = operation()
      if (changed) this.emit('animation:parameter', { entityId, parameter, value: this.requireRecord(entityId).parameters.get(parameter) })
      return changed
    } catch (error) {
      const message = errorMessage(error)
      const code = message.includes('Unknown') ? 'ANYO_ANIMATION_PARAMETER_NOT_FOUND' : message.includes('expected')
        ? 'ANYO_ANIMATION_PARAMETER_TYPE_MISMATCH' : 'ANYO_ANIMATION_PARAMETER_VALUE_INVALID'
      this.report('error', code, message, entityId, { parameter })
      throw error
    }
  }

  private requireRecord(entityId: string): EntityRecord {
    const record = this.findRecord(entityId)
    if (record) return record
    const entity = this.context?.query.entity(entityId)
    const message = entity
      ? `Entity "${entityId}" has no enabled ${ANYO_ANIMATION_COMPONENT} component.`
      : `Unknown animation entity "${entityId}".`
    this.report('error', entity ? 'ANYO_ANIMATION_COMPONENT_NOT_FOUND' : 'ANYO_ANIMATION_ENTITY_NOT_FOUND', message, entityId)
    throw new Error(message)
  }

  private findRecord(entityId: string): EntityRecord | undefined {
    const direct = this.records.get(entityId)
    if (direct) return direct
    const resolved = this.context?.query.entity(entityId)
    return resolved ? this.records.get(resolved.id) : undefined
  }

  private detachBinding(record: EntityRecord): void {
    record.bindingCleanup?.()
    record.bindingCleanup = null
    record.binding?.dispose()
    record.binding = null
  }

  private disposeRecord(record: EntityRecord): void {
    this.detachBinding(record)
    this.clearRootMotion(record)
    record.parameters.dispose()
  }

  private clearRootMotion(record: EntityRecord): void {
    if (this.context && typeof this.context.transforms.clear === 'function') {
      this.context.transforms.clear(record.entityId, record.config.rootMotion.source)
    }
  }

  private report(
    severity: AnimationDiagnostic['severity'],
    code: AnimationDiagnostic['code'],
    message: string,
    entityId?: string,
    details?: Readonly<Record<string, unknown>>,
  ): void {
    const diagnostic = createAnimationDiagnostic(severity, code, message, entityId, details)
    this.options.onDiagnostic?.(diagnostic)
    this.context?.world.emit('animation:diagnostic', diagnostic)
  }

  private emit(event: string, payload: unknown): void { this.context?.world.emit(event, payload) }
}

function transitionSnapshot(transition: ActiveTransition): AnimationActiveTransitionSnapshot {
  return Object.freeze({
    id: transition.config.id,
    from: transition.from,
    to: transition.to,
    elapsed: transition.elapsed,
    duration: transition.config.duration,
  })
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`)
  return value
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number.`)
  return value
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
