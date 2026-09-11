import type { PluginRuntimeContext, WorldChange, WorldPlugin } from '@blcklab/anyo'
import { AnimationController } from './AnimationController.js'
import type { AnimationParameterValue, AnimationPluginOptions } from './types.js'

export class AnyoAnimationPlugin implements WorldPlugin {
  readonly name = 'anyo:animation'
  readonly controller: AnimationController
  private availabilityCleanup: (() => void) | null = null
  private activeContext: PluginRuntimeContext | null = null
  private readonly cleanups: Array<() => void> = []
  private pendingDispose: Promise<void> | null = null

  constructor(readonly options: AnimationPluginOptions) {
    this.controller = new AnimationController(options.adapter, options)
  }

  async setup(context: PluginRuntimeContext): Promise<void> {
    this.activeContext = context
    this.pendingDispose = null
    await this.options.adapter.setup?.(context)
    this.availabilityCleanup?.()
    this.availabilityCleanup = this.options.adapter.onAvailabilityChange?.(() => {
      if (this.activeContext) this.controller.reconcile(this.activeContext)
    }) ?? null
    this.bindHostLifecycle(context)
    this.controller.bind(context)
  }

  update(deltaSeconds: number): void { this.controller.update(deltaSeconds) }

  applyChanges(_changes: readonly WorldChange[], context: PluginRuntimeContext): void {
    this.activeContext = context
    this.controller.reconcile(context)
  }

  /** Releases bindings/listeners for the current world document while keeping the adapter reusable. */
  teardown(): void { this.teardownRuntime() }

  /** Permanently releases the plugin and its renderer adapter. */
  dispose(): void { void this.disposeAsync() }

  async disposeAsync(): Promise<void> {
    if (this.pendingDispose) return this.pendingDispose
    this.pendingDispose = (async () => {
      this.teardownRuntime()
      await this.options.adapter.dispose?.()
    })()
    return this.pendingDispose
  }

  play(...args: Parameters<AnimationController['play']>): ReturnType<AnimationController['play']> { return this.controller.play(...args) }
  transitionTo(...args: Parameters<AnimationController['transitionTo']>): ReturnType<AnimationController['transitionTo']> { return this.controller.transitionTo(...args) }
  pause(...args: Parameters<AnimationController['pause']>): ReturnType<AnimationController['pause']> { return this.controller.pause(...args) }
  resume(...args: Parameters<AnimationController['resume']>): ReturnType<AnimationController['resume']> { return this.controller.resume(...args) }
  stop(...args: Parameters<AnimationController['stop']>): ReturnType<AnimationController['stop']> { return this.controller.stop(...args) }
  seek(...args: Parameters<AnimationController['seek']>): ReturnType<AnimationController['seek']> { return this.controller.seek(...args) }
  setSpeed(...args: Parameters<AnimationController['setSpeed']>): ReturnType<AnimationController['setSpeed']> { return this.controller.setSpeed(...args) }
  setBoolean(...args: Parameters<AnimationController['setBoolean']>): ReturnType<AnimationController['setBoolean']> { return this.controller.setBoolean(...args) }
  setNumber(...args: Parameters<AnimationController['setNumber']>): ReturnType<AnimationController['setNumber']> { return this.controller.setNumber(...args) }
  setTrigger(...args: Parameters<AnimationController['setTrigger']>): ReturnType<AnimationController['setTrigger']> { return this.controller.setTrigger(...args) }
  resetTrigger(...args: Parameters<AnimationController['resetTrigger']>): ReturnType<AnimationController['resetTrigger']> { return this.controller.resetTrigger(...args) }
  setParameter(...args: Parameters<AnimationController['setParameter']>): ReturnType<AnimationController['setParameter']> { return this.controller.setParameter(...args) }
  getParameter(...args: Parameters<AnimationController['getParameter']>): ReturnType<AnimationController['getParameter']> { return this.controller.getParameter(...args) }
  subscribeParameter(...args: Parameters<AnimationController['subscribeParameter']>): ReturnType<AnimationController['subscribeParameter']> { return this.controller.subscribeParameter(...args) }
  bindParameter(...args: Parameters<AnimationController['bindParameter']>): ReturnType<AnimationController['bindParameter']> { return this.controller.bindParameter(...args) }
  createParameterSnapshot(...args: Parameters<AnimationController['createParameterSnapshot']>): ReturnType<AnimationController['createParameterSnapshot']> { return this.controller.createParameterSnapshot(...args) }
  restoreParameterSnapshot(...args: Parameters<AnimationController['restoreParameterSnapshot']>): ReturnType<AnimationController['restoreParameterSnapshot']> { return this.controller.restoreParameterSnapshot(...args) }
  createSnapshot(): ReturnType<AnimationController['createSnapshot']> { return this.controller.createSnapshot() }
  restoreSnapshot(...args: Parameters<AnimationController['restoreSnapshot']>): ReturnType<AnimationController['restoreSnapshot']> { return this.controller.restoreSnapshot(...args) }
  pauseAll(): void { this.controller.pauseAll() }
  resumeAll(): void { this.controller.resumeAll() }
  stopAll(): void { this.controller.stopAll() }
  get(...args: Parameters<AnimationController['get']>): ReturnType<AnimationController['get']> { return this.controller.get(...args) }
  list(): ReturnType<AnimationController['list']> { return this.controller.list() }


  private teardownRuntime(): void {
    this.activeContext = null
    this.availabilityCleanup?.()
    this.availabilityCleanup = null
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.controller.dispose()
  }

  private bindHostLifecycle(context: PluginRuntimeContext): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    const world = context.world
    if (typeof world.on === 'function') {
      this.cleanups.push(
        world.on('player:pause', () => this.controller.pauseAll()),
        world.on('player:resume', () => this.controller.resumeAll()),
        world.on('world:pause', () => this.controller.pauseAll()),
        world.on('world:resume', () => this.controller.resumeAll()),
        world.on('renderer:recovered', () => this.activeContext && this.controller.reconcile(this.activeContext)),
        world.on('renderer:recovery-complete', () => this.activeContext && this.controller.reconcile(this.activeContext)),
        world.on('player:world-replaced', () => this.activeContext && this.controller.reconcile(this.activeContext)),
      )
    }
    if (typeof world.registerAction === 'function') {
      this.cleanups.push(
        world.registerAction('animation.play', (params) => {
          this.controller.play(requiredEntity(params), requiredString(params.clip, 'clip'), {
            ...(typeof params.loop === 'string' ? { loop: params.loop as 'once' | 'repeat' | 'ping-pong' } : {}),
            ...(typeof params.speed === 'number' ? { speed: params.speed } : {}),
            ...(typeof params.startTime === 'number' ? { startTime: params.startTime } : {}),
          })
        }),
        world.registerAction('animation.state', (params) => {
          this.controller.transitionTo(requiredEntity(params), requiredString(params.state, 'state'), typeof params.duration === 'number' ? params.duration : 0.2)
        }),
        world.registerAction('animation.parameter', (params) => {
          const value = params.value
          if (typeof value !== 'boolean' && typeof value !== 'number') throw new Error('value must be boolean or number.')
          this.controller.setParameter(requiredEntity(params), requiredString(params.parameter, 'parameter'), value as AnimationParameterValue)
        }),
        world.registerAction('animation.trigger', (params) => {
          this.controller.setTrigger(requiredEntity(params), requiredString(params.parameter, 'parameter'))
        }),
      )
    }
  }}

export function createAnimationPlugin(options: AnimationPluginOptions): AnyoAnimationPlugin {
  return new AnyoAnimationPlugin(options)
}

function requiredEntity(params: Record<string, unknown>): string { return requiredString(params.entityId, 'entityId') }
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`)
  return value
}
