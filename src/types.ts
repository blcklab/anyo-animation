import type {
  CompiledEntityNode,
  JsonValue,
  PluginRuntimeContext,
} from '@blcklab/anyo'

export const ANYO_ANIMATION_COMPONENT = 'anyo.animation' as const
export const ANYO_ANIMATION_SNAPSHOT_VERSION = 1 as const

export type AnimationLoopMode = 'once' | 'repeat' | 'ping-pong'
export type AnimationParameterType = 'boolean' | 'number' | 'trigger'
export type AnimationParameterValue = boolean | number

export type AnimationPropertyTrackTarget =
  | 'transform.position'
  | 'transform.position.x'
  | 'transform.position.y'
  | 'transform.position.z'
  | 'transform.rotation'
  | 'transform.rotation.x'
  | 'transform.rotation.y'
  | 'transform.rotation.z'
  | 'transform.scale'
  | 'transform.scale.x'
  | 'transform.scale.y'
  | 'transform.scale.z'

export type AnimationPropertyTrackEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
export type AnimationPropertyTrackValue = number | readonly [number, number, number]

export interface AnimationPropertyTrackConfig {
  readonly id: string
  readonly target: AnimationPropertyTrackTarget
  readonly from: AnimationPropertyTrackValue
  readonly to: AnimationPropertyTrackValue
  readonly duration: number
  readonly loop: AnimationLoopMode
  readonly easing: AnimationPropertyTrackEasing
}

export interface AnimationBooleanParameterDefinition {
  readonly type: 'boolean'
  readonly default?: boolean
}

export interface AnimationNumberParameterDefinition {
  readonly type: 'number'
  readonly default?: number
  readonly min?: number
  readonly max?: number
}

export interface AnimationTriggerParameterDefinition {
  readonly type: 'trigger'
}

export type AnimationParameterDefinition =
  | AnimationBooleanParameterDefinition
  | AnimationNumberParameterDefinition
  | AnimationTriggerParameterDefinition

export type AnimationParameterDefinitions = Readonly<Record<string, AnimationParameterDefinition>>

export interface AnimationActionReference {
  readonly action: string
  readonly params?: Readonly<Record<string, JsonValue>>
}

export type AnimationConditionOperator =
  | 'equals'
  | 'not-equals'
  | 'greater-than'
  | 'greater-than-or-equal'
  | 'less-than'
  | 'less-than-or-equal'
  | 'triggered'
  | 'not-triggered'

export interface AnimationTransitionCondition {
  readonly parameter: string
  readonly operator: AnimationConditionOperator
  readonly value?: boolean | number
}

export interface AnimationStateConfig {
  readonly clip: string
  readonly loop?: AnimationLoopMode
  readonly speed?: number
  readonly startTime?: number
  readonly onEnter: readonly AnimationActionReference[]
  readonly onExit: readonly AnimationActionReference[]
}

export interface AnimationTransitionConfig {
  readonly id: string
  readonly from: string | '*'
  readonly to: string
  readonly conditions: readonly AnimationTransitionCondition[]
  readonly conditionMode: 'all' | 'any'
  readonly exitTime?: number
  readonly duration: number
  readonly priority: number
  readonly interruptible: boolean
  readonly consumeTriggers: boolean
}

export interface AnimationStateMachineConfig {
  readonly initial: string
  readonly states: Readonly<Record<string, AnimationStateConfig>>
  readonly transitions: readonly AnimationTransitionConfig[]
}

export interface AnimationMarkerBinding {
  readonly marker: string
  readonly actions: readonly AnimationActionReference[]
}

export type AnimationRootMotionMode =
  | 'disabled'
  | 'extract-only'
  | 'apply-to-entity'
  | 'apply-to-controller'
  | 'horizontal-only'

export interface AnimationRootMotionConfig {
  readonly mode: AnimationRootMotionMode
  readonly node?: string
  readonly source: string
  readonly priority: number
}

export interface AnimationComponentConfig {
  readonly clips: Readonly<Record<string, string>>
  readonly defaultClip?: string
  readonly autoplay: boolean
  readonly loop: AnimationLoopMode
  readonly speed: number
  readonly parameters: AnimationParameterDefinitions
  readonly stateMachine?: AnimationStateMachineConfig
  readonly markers: readonly AnimationMarkerBinding[]
  readonly rootMotion: AnimationRootMotionConfig
  readonly tracks?: readonly AnimationPropertyTrackConfig[]
}

export type AnimationEntityStatus = 'pending' | 'ready' | 'playing' | 'paused' | 'stopped'

export interface AnimationActiveTransitionSnapshot {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly elapsed: number
  readonly duration: number
}

export interface AnimationParameterSnapshot {
  readonly values: Readonly<Record<string, AnimationParameterValue>>
  readonly activeTriggers: readonly string[]
}

export interface AnimationEntityRuntimeSnapshot {
  readonly entityId: string
  readonly parameters: AnimationParameterSnapshot
  readonly currentState?: string
  readonly activeClip?: string
  readonly status: AnimationEntityStatus
  readonly speed: number
  readonly time?: number
  readonly rootMotion: readonly [number, number, number]
  readonly trackTime?: number
}

export interface AnimationRuntimeSnapshot {
  readonly version: typeof ANYO_ANIMATION_SNAPSHOT_VERSION
  readonly entities: readonly AnimationEntityRuntimeSnapshot[]
}

export interface AnimationEntitySnapshot {
  readonly entityId: string
  readonly status: AnimationEntityStatus
  readonly configuredClips: Readonly<Record<string, string>>
  readonly availableClips: readonly string[]
  readonly activeClip?: string
  readonly speed: number
  readonly time?: number
  readonly currentState?: string
  readonly transition?: AnimationActiveTransitionSnapshot
  readonly parameters: AnimationParameterSnapshot
  readonly rootMotion: readonly [number, number, number]
  readonly trackTime: number
}

export type AnimationDiagnosticCode =
  | 'ANYO_ANIMATION_COMPONENT_INVALID'
  | 'ANYO_ANIMATION_ENTITY_NOT_FOUND'
  | 'ANYO_ANIMATION_COMPONENT_NOT_FOUND'
  | 'ANYO_ANIMATION_ASSET_PENDING'
  | 'ANYO_ANIMATION_CLIP_NOT_FOUND'
  | 'ANYO_ANIMATION_ADAPTER_ERROR'
  | 'ANYO_ANIMATION_PARAMETER_NOT_FOUND'
  | 'ANYO_ANIMATION_PARAMETER_TYPE_MISMATCH'
  | 'ANYO_ANIMATION_PARAMETER_VALUE_INVALID'
  | 'ANYO_ANIMATION_STATE_NOT_FOUND'
  | 'ANYO_ANIMATION_SNAPSHOT_INVALID'
  | 'ANYO_ANIMATION_ACTION_ERROR'
  | 'ANYO_ANIMATION_ROOT_MOTION_UNAVAILABLE'

export interface AnimationDiagnostic {
  readonly severity: 'info' | 'warning' | 'error'
  readonly code: AnimationDiagnosticCode
  readonly message: string
  readonly entityId?: string
  readonly details?: Readonly<Record<string, unknown>>
}

export interface AnimationPlayRequest {
  readonly clip: string
  readonly loop: AnimationLoopMode
  readonly speed: number
  readonly startTime?: number
}

export interface AnimationCrossFadeRequest extends AnimationPlayRequest {
  readonly duration: number
}

export type AnimationBindingEvent =
  | {
      readonly type: 'marker'
      readonly name: string
      readonly time: number
      readonly data?: unknown
    }
  | {
      readonly type: 'complete'
      readonly clip: string
    }

export interface AnimationEntityBinding {
  readonly entityId: string
  readonly availableClips: readonly string[]
  isAvailable?(): boolean
  play(request: AnimationPlayRequest): void
  crossFade?(request: AnimationCrossFadeRequest): void
  pause(): void
  resume(): void
  stop(): void
  seek(time: number): void
  setSpeed(speed: number): void
  getTime?(): number | undefined
  getDuration?(): number | undefined
  getNormalizedTime?(): number | undefined
  onEvent?(listener: (event: AnimationBindingEvent) => void): () => void
  consumeRootMotion?(): readonly [number, number, number] | undefined
  dispose(): void
}

export interface AnimationAttachRequest {
  readonly entity: CompiledEntityNode
  readonly primitiveIds: readonly string[]
  readonly config: AnimationComponentConfig
  readonly context: PluginRuntimeContext
}

export interface AnimationRuntimeAdapter {
  setup?(context: PluginRuntimeContext): void | Promise<void>
  attachEntity(request: AnimationAttachRequest): AnimationEntityBinding | null
  update?(deltaSeconds: number): void
  onAvailabilityChange?(listener: () => void): () => void
  dispose?(): void | Promise<void>
}

export interface AnimationParameterBindingContext {
  readonly entityId: string
  readonly deltaSeconds: number
  readonly elapsedSeconds: number
}

export type AnimationParameterBinding = (
  context: AnimationParameterBindingContext,
) => AnimationParameterValue

export interface AnimationRootMotionEvent {
  readonly entityId: string
  readonly delta: readonly [number, number, number]
  readonly accumulated: readonly [number, number, number]
  readonly mode: AnimationRootMotionMode
}

export interface AnimationPluginOptions {
  readonly adapter: AnimationRuntimeAdapter
  readonly onDiagnostic?: (diagnostic: AnimationDiagnostic) => void
  readonly onRootMotion?: (event: AnimationRootMotionEvent) => void
  readonly strict?: boolean
}
