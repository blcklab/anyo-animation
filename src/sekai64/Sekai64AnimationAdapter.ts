import type { PluginRuntimeContext } from '@blcklab/anyo'
import {
  Sekai64Renderer,
  type Sekai64RendererNativeAccess,
} from '@blcklab/anyo/renderer-sekai64'
import type { AssetLoaderRegistration, AssetLoadRequest } from '@blcklab/sekai64/assets'
import { GltfLoader, GltfModelNode } from '@blcklab/sekai64/gltf'
import {
  AnimationClip,
  GLTF_ANIMATION_EXTENSION_ID,
  createAnimationRendererModule,
  createGltfAnimationAdapter,
  type AnimationAction,
  type AnimationMixer,
  type AnimationRendererModule,
  type AnimationRendererModuleOptions,
  type AnimationTrack,
  type GltfAnimationSet,
} from '@blcklab/sekai64/animation'
import type {
  AnimationAttachRequest,
  AnimationBindingEvent,
  AnimationCrossFadeRequest,
  AnimationEntityBinding,
  AnimationPlayRequest,
  AnimationRootMotionConfig,
  AnimationRuntimeAdapter,
} from '../types.js'

interface LoadedAnimatedModel {
  readonly model: GltfModelNode
  readonly clips: readonly AnimationClip[]
  readonly restorePose?: () => void
  readonly isAvailable?: () => boolean
}

export interface Sekai64ExternalClipOptions {
  /** Restore the target rig before playback and when playback releases it. */
  readonly restorePose?: () => void
}

export interface Sekai64AnimationAdapterOptions {
  /** Optional explicit renderer resolver. When omitted, the adapter uses the renderer from PluginRuntimeContext. */
  readonly getRenderer?: () => Sekai64Renderer
  readonly assetType?: string
  readonly module?: AnimationRendererModule
  readonly moduleOptions?: AnimationRendererModuleOptions
}

export class Sekai64AnimationAdapter implements AnimationRuntimeAdapter {
  readonly assetType: string
  readonly module: AnimationRendererModule
  private readonly loader = new GltfLoader()
  private readonly loaded = new Map<string, LoadedAnimatedModel>()
  private readonly external = new WeakMap<GltfModelNode, LoadedAnimatedModel>()
  private readonly listeners = new Set<() => void>()
  private readonly bindings = new Set<Sekai64AnimationEntityBinding>()
  private moduleInstall: Promise<void> | null = null
  private context: PluginRuntimeContext | null = null
  private assetCleanup: (() => void) | null = null
  private active = true

  constructor(private readonly options: Sekai64AnimationAdapterOptions) {
    this.assetType = options.assetType?.trim().toLowerCase() || 'animated-model'
    this.module = options.module ?? createAnimationRendererModule(options.moduleOptions)
  }

  async setup(context: PluginRuntimeContext): Promise<void> {
    this.context = context
    this.active = true
    await this.ensureModule()
    this.assetCleanup?.()
    this.assetCleanup = this.renderer().onAssetProgress?.(() => this.notify()) ?? null
  }

  attachEntity(request: AnimationAttachRequest): AnimationEntityBinding | null {
    for (const primitiveId of request.primitiveIds) {
      const loaded = this.resolveAnimatedModel(primitiveId)
      if (!loaded) continue
      const binding = new Sekai64AnimationEntityBinding(
        request.entity.id,
        loaded.model,
        loaded.clips,
        request.config.clips,
        request.config.rootMotion,
        this.module,
        loaded.restorePose,
        loaded.isAvailable,
        () => this.bindings.delete(binding),
      )
      this.bindings.add(binding)
      return binding
    }
    return null
  }

  /**
   * Register clips prepared by another package (for example a VRMA retargeter)
   * against an already-loaded Sekai64 model. The caller retains clip ownership.
   *
   * This deliberately does not parse or retarget animation data: it is only the
   * bridge that lets Anyo Animation own playback/state for externally prepared
   * clips on the existing renderer model.
   */
  registerExternalClips(
    model: GltfModelNode,
    clips: readonly AnimationClip[],
    options: Sekai64ExternalClipOptions = {},
  ): () => void {
    if (model.disposed || model.asset.disposed) throw new Error('Cannot register animation clips on a disposed Sekai64 model.')
    if (!clips.length) throw new Error('External animation registration requires at least one clip.')
    let active = true
    const entry: LoadedAnimatedModel = Object.freeze({
      model,
      clips: Object.freeze([...clips]),
      ...(options.restorePose ? { restorePose: options.restorePose } : {}),
      isAvailable: () => active && !model.disposed && !model.asset.disposed,
    })
    this.external.set(model, entry)
    this.notify()
    return () => {
      if (!active) return
      active = false
      if (this.external.get(model) === entry) this.external.delete(model)
      this.notify()
    }
  }

  update(deltaSeconds: number): void {
    if (!this.active) return
    for (const binding of this.bindings) binding.beforeUpdate()
    this.module.update(deltaSeconds)
    for (const binding of this.bindings) binding.afterUpdate()
  }

  onAvailabilityChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  createAssetLoader(): AssetLoaderRegistration<GltfModelNode> {
    return {
      type: this.assetType,
      formats: ['gltf', 'glb'],
      load: (request) => this.loadAnimatedModel(request),
      dispose: () => {
        this.loaded.clear()
        this.loader.dispose()
        this.notify()
      },
    }
  }

  dispose(): void {
    this.active = false
    this.assetCleanup?.()
    this.assetCleanup = null
    for (const binding of [...this.bindings]) binding.dispose()
    this.bindings.clear()
    this.loaded.clear()
    this.loader.dispose()
    this.context = null
    this.listeners.clear()
  }

  private async loadAnimatedModel(request: AssetLoadRequest): Promise<GltfModelNode> {
    await this.ensureModule()
    const animationAdapter = createGltfAnimationAdapter(this.module, { createMixer: true })
    const model = await this.loader.loadNode(request.src, {
      ...(request.id ? { id: request.id, name: request.id } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      animation: animationAdapter,
      animatedFallback: 'error',
    })
    const animation = model.asset.getExtension<GltfAnimationSet>(GLTF_ANIMATION_EXTENSION_ID)
    if (!animation || !animation.mixer) {
      model.dispose()
      throw new Error(`Animated asset "${request.src}" did not produce clips and a mixer.`)
    }
    if (!request.id) {
      model.dispose()
      throw new Error('Animated model requests require a primitive id.')
    }
    animation.mixer.stopAll()
    animation.mixer.clearListeners()
    this.module.removeMixer(animation.mixer)
    const entry: LoadedAnimatedModel = { model, clips: animation.clips }
    this.loaded.set(request.id, entry)
    model.asset.onDispose(() => {
      if (this.loaded.get(request.id as string)?.model === model) {
        this.loaded.delete(request.id as string)
        this.notify()
      }
    })
    this.notify()
    return model
  }

  private async ensureModule(): Promise<void> {
    if (this.moduleInstall) return this.moduleInstall
    this.moduleInstall = (async () => {
      const native = this.nativeAccess()
      // Player may install this exact module through renderer.modules before the
      // world plugins are set up. Reusing that renderer-owned installation is
      // required so GLB and VRM loaders can share one skinning/mixer module.
      if (native.engine.modules.has(this.module.id)) return
      await native.engine.installModules([this.module])
    })()
    try {
      await this.moduleInstall
    } catch (error) {
      this.moduleInstall = null
      throw error
    }
  }

  private resolveAnimatedModel(primitiveId: string): LoadedAnimatedModel | null {
    const owned = this.loaded.get(primitiveId)
    if (owned && !owned.model.disposed && !owned.model.asset.disposed) return owned

    const node = this.nativeAccess().getPrimitiveNode(primitiveId)
    if (!(node instanceof GltfModelNode) || node.disposed || node.asset.disposed) return null
    const external = this.external.get(node)
    if (external) return external
    const animation = node.asset.getExtension<GltfAnimationSet>(GLTF_ANIMATION_EXTENSION_ID)
    if (!animation?.mixer || animation.clips.length === 0) return null
    return { model: node, clips: animation.clips }
  }

  private renderer(): Sekai64Renderer {
    const explicit = this.options.getRenderer?.()
    if (explicit) return explicit
    const renderer = this.context?.renderer as Partial<Sekai64Renderer> | undefined
    if (!renderer || typeof renderer.getNativeAccess !== 'function') {
      throw new Error('Sekai64 animation requires a Sekai64Renderer in the plugin runtime context.')
    }
    return renderer as Sekai64Renderer
  }

  private nativeAccess(): Sekai64RendererNativeAccess {
    const native = this.renderer().getNativeAccess()
    if (!native) throw new Error('Sekai64 animation requires a mounted Sekai64Renderer native scene.')
    return native
  }

  private notify(): void { for (const listener of [...this.listeners]) listener() }
}

class Sekai64AnimationEntityBinding implements AnimationEntityBinding {
  readonly availableClips: readonly string[]
  private action: AnimationAction | null = null
  private speed = 1
  private disposed = false
  private readonly byReference = new Map<string, string>()
  private readonly listeners = new Set<(event: AnimationBindingEvent) => void>()
  private readonly eventCleanups: Array<() => void> = []
  private readonly rootTracks = new Map<string, AnimationTrack>()
  private readonly ownedClips: AnimationClip[] = []
  private readonly mixer: AnimationMixer
  private previousTime: number | null = null
  private previousSample: Float32Array | null = null
  private pendingRootMotion: [number, number, number] = [0, 0, 0]

  constructor(
    readonly entityId: string,
    private readonly model: GltfModelNode,
    clips: readonly AnimationClip[],
    aliases: Readonly<Record<string, string>>,
    rootMotion: AnimationRootMotionConfig,
    private readonly module: AnimationRendererModule,
    private readonly restorePose: (() => void) | undefined,
    private readonly sourceAvailable: (() => boolean) | undefined,
    private readonly onDispose: () => void,
  ) {
    const prepared = rootMotion.mode === 'disabled'
      ? clips
      : this.prepareRootMotionClips(clips, rootMotion)
    this.mixer = this.module.createMixer(model, prepared)

    this.availableClips = Object.freeze(clips.flatMap((clip) => clip.name === clip.id ? [clip.id] : [clip.id, clip.name]))
    for (let index = 0; index < clips.length; index += 1) {
      const original = clips[index] as AnimationClip
      const playable = prepared[index] as AnimationClip
      this.byReference.set(original.id, playable.id)
      this.byReference.set(original.name, playable.id)
    }
    for (const [alias, source] of Object.entries(aliases)) {
      const resolved = this.byReference.get(source)
      if (resolved) this.byReference.set(alias, resolved)
    }
    this.eventCleanups.push(
      this.mixer.on('marker', ({ action, marker }) => {
        if (action !== this.action) return
        this.emit({ type: 'marker', name: marker.name, time: marker.time, ...(marker.data !== undefined ? { data: marker.data } : {}) })
      }),
      this.mixer.on('complete', ({ action }) => {
        if (action !== this.action) return
        this.emit({ type: 'complete', clip: action.clip.name })
      }),
    )
  }

  isAvailable(): boolean {
    return !this.disposed
      && !this.model.disposed
      && !this.model.asset.disposed
      && (this.sourceAvailable?.() ?? true)
  }

  play(request: AnimationPlayRequest): void {
    this.assertAlive()
    const clipId = this.resolveClip(request.clip)
    this.mixer.stopAll()
    this.restorePose?.()
    this.speed = request.speed
    this.action = this.mixer.play(clipId, {
      loop: request.loop,
      speed: request.speed,
      ...(request.startTime !== undefined ? { startTime: request.startTime } : {}),
    })
    this.resetRootMotionCursor()
  }

  crossFade(request: AnimationCrossFadeRequest): void {
    this.assertAlive()
    if (!this.action || request.duration <= 0) return this.play(request)
    const clipId = this.resolveClip(request.clip)
    const next = this.action.crossFadeTo(clipId, { duration: request.duration })
    next.loop = request.loop
    next.speed = request.speed
    if (request.startTime !== undefined) next.seek(request.startTime)
    this.action = next
    this.speed = request.speed
    this.resetRootMotionCursor()
  }

  pause(): void { this.assertAlive(); this.action?.pause() }
  resume(): void { this.assertAlive(); this.action?.resume() }

  stop(): void {
    if (this.disposed) return
    this.action?.stop()
    this.action = null
    this.resetRootMotionCursor()
    this.restorePose?.()
  }

  seek(time: number): void { this.assertAlive(); this.action?.seek(time); this.resetRootMotionCursor() }

  setSpeed(speed: number): void {
    this.assertAlive()
    this.speed = speed
    if (this.action) this.action.speed = speed
  }

  getTime(): number | undefined { return this.action?.time }
  getDuration(): number | undefined { return this.action?.clip.duration }
  getNormalizedTime(): number | undefined {
    const duration = this.getDuration()
    return duration && duration > 0 && this.action ? this.action.time / duration : undefined
  }

  onEvent(listener: (event: AnimationBindingEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  beforeUpdate(): void {
    const action = this.action
    const track = action ? this.rootTracks.get(action.clip.id) : undefined
    if (!action || !track || action.paused || action.finished || !action.enabled) {
      this.previousTime = null
      this.previousSample = null
      return
    }
    this.previousTime = action.time
    this.previousSample = track.sample(action.time)
  }

  afterUpdate(): void {
    const action = this.action
    const track = action ? this.rootTracks.get(action.clip.id) : undefined
    if (!action || !track || this.previousTime === null || !this.previousSample) return
    const current = track.sample(action.time)
    const delta = rootMotionDelta(track, action.loop, this.previousTime, action.time, this.previousSample, current)
    this.pendingRootMotion[0] += delta[0]
    this.pendingRootMotion[1] += delta[1]
    this.pendingRootMotion[2] += delta[2]
    this.previousTime = null
    this.previousSample = null
  }

  consumeRootMotion(): readonly [number, number, number] {
    const output = Object.freeze([...this.pendingRootMotion]) as readonly [number, number, number]
    this.pendingRootMotion = [0, 0, 0]
    return output
  }

  dispose(): void {
    if (this.disposed) return
    this.stop()
    this.disposed = true
    for (const cleanup of this.eventCleanups.splice(0)) cleanup()
    this.listeners.clear()
    this.module.removeMixer(this.mixer)
    for (const clip of this.ownedClips) clip.dispose()
    this.ownedClips.length = 0
    this.onDispose()
  }

  private prepareRootMotionClips(
    clips: readonly AnimationClip[],
    config: AnimationRootMotionConfig,
  ): readonly AnimationClip[] {
    let changed = false
    const rootTargets = new Set<string>()
    if (config.node) {
      rootTargets.add(config.node)
      this.model.traverse((node) => {
        if (node.id === config.node || node.name === config.node) {
          rootTargets.add(node.id)
          if (node.name) rootTargets.add(node.name)
        }
      })
    }
    const output = clips.map((clip) => {
      const rootTrack = clip.tracks.find((track) => track.path === 'translation' && (rootTargets.size === 0 || rootTargets.has(track.target)))
        ?? (rootTargets.size === 0 ? clip.tracks.find((track) => track.path === 'translation') : undefined)
      if (!rootTrack) return clip
      changed = true
      const cloned = new AnimationClip({
        id: `${clip.id}#anyo-root-motion`,
        name: clip.name,
        tracks: clip.tracks.filter((track) => track !== rootTrack),
        markers: clip.markers,
        duration: clip.duration,
      })
      this.rootTracks.set(cloned.id, rootTrack)
      this.ownedClips.push(cloned)
      return cloned
    })
    return changed ? output : clips
  }

  private resolveClip(reference: string): string {
    const clipId = this.byReference.get(reference)
    if (!clipId) throw new Error(`Animation clip "${reference}" is unavailable. Available clips: ${this.availableClips.join(', ') || 'none'}.`)
    return clipId
  }

  private resetRootMotionCursor(): void {
    this.previousTime = null
    this.previousSample = null
    this.pendingRootMotion = [0, 0, 0]
  }

  private emit(event: AnimationBindingEvent): void { for (const listener of [...this.listeners]) listener(event) }
  private assertAlive(): void { if (this.disposed) throw new Error(`Animation binding for "${this.entityId}" is disposed.`) }
}

function rootMotionDelta(
  track: AnimationTrack,
  loop: AnimationAction['loop'],
  previousTime: number,
  currentTime: number,
  previous: Float32Array,
  current: Float32Array,
): [number, number, number] {
  if (loop === 'repeat' && currentTime < previousTime) {
    const start = track.sample(0)
    const end = track.sample(track.times[track.times.length - 1] ?? previousTime)
    return [
      (end[0] ?? 0) - (previous[0] ?? 0) + (current[0] ?? 0) - (start[0] ?? 0),
      (end[1] ?? 0) - (previous[1] ?? 0) + (current[1] ?? 0) - (start[1] ?? 0),
      (end[2] ?? 0) - (previous[2] ?? 0) + (current[2] ?? 0) - (start[2] ?? 0),
    ]
  }
  return [
    (current[0] ?? 0) - (previous[0] ?? 0),
    (current[1] ?? 0) - (previous[1] ?? 0),
    (current[2] ?? 0) - (previous[2] ?? 0),
  ]
}
