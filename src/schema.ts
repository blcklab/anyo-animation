import type { CompiledComponent, JsonValue } from '@blcklab/anyo'
import {
  ANYO_ANIMATION_COMPONENT,
  type AnimationActionReference,
  type AnimationComponentConfig,
  type AnimationConditionOperator,
  type AnimationLoopMode,
  type AnimationMarkerBinding,
  type AnimationPropertyTrackConfig,
  type AnimationPropertyTrackEasing,
  type AnimationPropertyTrackTarget,
  type AnimationPropertyTrackValue,
  type AnimationParameterDefinition,
  type AnimationParameterDefinitions,
  type AnimationRootMotionConfig,
  type AnimationRootMotionMode,
  type AnimationStateConfig,
  type AnimationStateMachineConfig,
  type AnimationTransitionCondition,
  type AnimationTransitionConfig,
} from './types.js'

const LOOP_MODES = new Set<AnimationLoopMode>(['once', 'repeat', 'ping-pong'])
const PROPERTY_TRACK_TARGETS = new Set<AnimationPropertyTrackTarget>([
  'transform.position', 'transform.position.x', 'transform.position.y', 'transform.position.z',
  'transform.rotation', 'transform.rotation.x', 'transform.rotation.y', 'transform.rotation.z',
  'transform.scale', 'transform.scale.x', 'transform.scale.y', 'transform.scale.z',
])
const PROPERTY_TRACK_EASINGS = new Set<AnimationPropertyTrackEasing>(['linear', 'ease-in', 'ease-out', 'ease-in-out'])
const ROOT_MOTION_MODES = new Set<AnimationRootMotionMode>([
  'disabled', 'extract-only', 'apply-to-entity', 'apply-to-controller', 'horizontal-only',
])

export function parseAnimationComponent(component: CompiledComponent): AnimationComponentConfig {
  if (component.type !== ANYO_ANIMATION_COMPONENT) {
    throw new Error(`Expected ${ANYO_ANIMATION_COMPONENT}; received ${component.type}.`)
  }
  const data = component.data
  const clips = readClips(data.clips)
  const defaultClip = optionalNonEmptyString(data.defaultClip, 'defaultClip')
  const autoplay = optionalBoolean(data.autoplay, true, 'autoplay')
  const loop = optionalLoop(data.loop)
  const speed = optionalPositiveNumber(data.speed, 1, 'speed')
  const parameters = readParameters(data.parameters)
  const stateMachine = readStateMachine(data.stateMachine, clips, parameters)
  const markers = readMarkers(data.markers)
  const rootMotion = readRootMotion(data.rootMotion)
  const tracks = readPropertyTracks(data.tracks)

  if (autoplay && !defaultClip && !stateMachine && tracks.length === 0) {
    throw new Error('Enabled autoplay requires a non-empty defaultClip, stateMachine, or tracks.')
  }
  if (defaultClip) validateClipReference(defaultClip, clips, 'defaultClip')

  return Object.freeze({
    clips: Object.freeze(clips),
    ...(defaultClip ? { defaultClip } : {}),
    autoplay,
    loop,
    speed,
    parameters: Object.freeze(parameters),
    ...(stateMachine ? { stateMachine } : {}),
    markers: Object.freeze(markers),
    rootMotion,
    tracks: Object.freeze(tracks),
  })
}

export function animationConfigKey(config: AnimationComponentConfig): string {
  return JSON.stringify(config, objectKeySorter)
}

function readClips(value: JsonValue | undefined): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('clips must be an object of alias-to-clip-name strings.')
  const clips: Record<string, string> = {}
  for (const [alias, source] of Object.entries(value)) {
    if (!alias.trim()) throw new Error('clips cannot contain an empty alias.')
    if (typeof source !== 'string' || !source.trim()) {
      throw new Error(`clips.${alias} must be a non-empty string.`)
    }
    clips[alias] = source
  }
  return clips
}

function readParameters(value: JsonValue | undefined): Record<string, AnimationParameterDefinition> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('parameters must be an object.')
  const output: Record<string, AnimationParameterDefinition> = {}
  for (const [name, input] of Object.entries(value)) {
    if (!name.trim()) throw new Error('parameters cannot contain an empty name.')
    if (!isRecord(input)) throw new Error(`parameters.${name} must be an object.`)
    const type = requiredString(input.type, `parameters.${name}.type`)
    if (type === 'boolean') {
      const defaultValue = optionalBooleanValue(input.default, `parameters.${name}.default`)
      output[name] = Object.freeze({ type, ...(defaultValue !== undefined ? { default: defaultValue } : {}) })
    } else if (type === 'number') {
      const defaultValue = optionalFiniteNumber(input.default, `parameters.${name}.default`)
      const min = optionalFiniteNumber(input.min, `parameters.${name}.min`)
      const max = optionalFiniteNumber(input.max, `parameters.${name}.max`)
      if (min !== undefined && max !== undefined && min > max) {
        throw new Error(`parameters.${name}.min cannot exceed max.`)
      }
      if (defaultValue !== undefined && min !== undefined && defaultValue < min) {
        throw new Error(`parameters.${name}.default cannot be below min.`)
      }
      if (defaultValue !== undefined && max !== undefined && defaultValue > max) {
        throw new Error(`parameters.${name}.default cannot exceed max.`)
      }
      output[name] = Object.freeze({
        type,
        ...(defaultValue !== undefined ? { default: defaultValue } : {}),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      })
    } else if (type === 'trigger') {
      output[name] = Object.freeze({ type })
    } else {
      throw new Error(`parameters.${name}.type must be boolean, number, or trigger.`)
    }
  }
  return output
}

function readStateMachine(
  value: JsonValue | undefined,
  clips: Readonly<Record<string, string>>,
  parameters: AnimationParameterDefinitions,
): AnimationStateMachineConfig | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('stateMachine must be an object.')
  if (!isRecord(value.states) || Object.keys(value.states).length === 0) {
    throw new Error('stateMachine.states must contain at least one state.')
  }
  const states: Record<string, AnimationStateConfig> = {}
  for (const [name, input] of Object.entries(value.states)) {
    if (!name.trim()) throw new Error('stateMachine.states cannot contain an empty name.')
    if (!isRecord(input)) throw new Error(`stateMachine.states.${name} must be an object.`)
    const clip = requiredString(input.clip, `stateMachine.states.${name}.clip`)
    validateClipReference(clip, clips, `stateMachine.states.${name}.clip`)
    states[name] = Object.freeze({
      clip,
      ...(input.loop !== undefined ? { loop: optionalLoop(input.loop) } : {}),
      ...(input.speed !== undefined ? { speed: optionalPositiveNumber(input.speed, 1, `stateMachine.states.${name}.speed`) } : {}),
      ...(input.startTime !== undefined ? { startTime: nonNegativeFinite(input.startTime, `stateMachine.states.${name}.startTime`) } : {}),
      onEnter: Object.freeze(readActions(input.onEnter, `stateMachine.states.${name}.onEnter`)),
      onExit: Object.freeze(readActions(input.onExit, `stateMachine.states.${name}.onExit`)),
    })
  }
  const initial = optionalNonEmptyString(value.initial, 'stateMachine.initial') ?? Object.keys(states)[0] as string
  if (!states[initial]) throw new Error(`stateMachine.initial references unknown state "${initial}".`)
  const transitions = readTransitions(value.transitions, states, parameters)
  return Object.freeze({ initial, states: Object.freeze(states), transitions: Object.freeze(transitions) })
}

function readTransitions(
  value: JsonValue | undefined,
  states: Readonly<Record<string, AnimationStateConfig>>,
  parameters: AnimationParameterDefinitions,
): AnimationTransitionConfig[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('stateMachine.transitions must be an array.')
  return value.map((input, index) => {
    if (!isRecord(input)) throw new Error(`stateMachine.transitions[${index}] must be an object.`)
    const from = requiredString(input.from, `stateMachine.transitions[${index}].from`)
    const to = requiredString(input.to, `stateMachine.transitions[${index}].to`)
    if (from !== '*' && !states[from]) throw new Error(`Transition ${index} references unknown from state "${from}".`)
    if (!states[to]) throw new Error(`Transition ${index} references unknown to state "${to}".`)
    if (from === to) throw new Error(`Transition ${index} cannot target its own state.`)
    const conditions = input.conditions !== undefined
      ? readConditionArray(input.conditions, parameters, index)
      : readWhen(input.when, parameters, index)
    const conditionMode = input.conditionMode === undefined ? 'all' : requiredString(input.conditionMode, `transition ${index}.conditionMode`)
    if (conditionMode !== 'all' && conditionMode !== 'any') throw new Error(`Transition ${index} conditionMode must be all or any.`)
    const exitTime = input.exitTime === undefined ? undefined : normalized(input.exitTime, `transition ${index}.exitTime`)
    const duration = input.duration === undefined ? 0.2 : nonNegativeFinite(input.duration, `transition ${index}.duration`)
    const priority = input.priority === undefined ? 0 : finiteNumber(input.priority, `transition ${index}.priority`)
    const interruptible = optionalBoolean(input.interruptible, true, `transition ${index}.interruptible`)
    const consumeTriggers = optionalBoolean(input.consumeTriggers, true, `transition ${index}.consumeTriggers`)
    const id = optionalNonEmptyString(input.id, `transition ${index}.id`) ?? `${from}->${to}:${index}`
    return Object.freeze({
      id, from, to, conditions: Object.freeze(conditions), conditionMode,
      ...(exitTime !== undefined ? { exitTime } : {}),
      duration, priority, interruptible, consumeTriggers,
    })
  })
}

function readConditionArray(
  value: JsonValue,
  parameters: AnimationParameterDefinitions,
  transitionIndex: number,
): AnimationTransitionCondition[] {
  if (!Array.isArray(value)) throw new Error(`Transition ${transitionIndex} conditions must be an array.`)
  return value.map((input, conditionIndex) => {
    if (!isRecord(input)) throw new Error(`Transition ${transitionIndex} condition ${conditionIndex} must be an object.`)
    const parameter = requiredString(input.parameter, `transition ${transitionIndex} condition ${conditionIndex}.parameter`)
    const operator = requiredString(input.operator, `transition ${transitionIndex} condition ${conditionIndex}.operator`) as AnimationConditionOperator
    const conditionValue = scalarConditionValue(input.value)
    return validateCondition({ parameter, operator, ...(conditionValue !== undefined ? { value: conditionValue } : {}) }, parameters)
  })
}

function readWhen(
  value: JsonValue | undefined,
  parameters: AnimationParameterDefinitions,
  transitionIndex: number,
): AnimationTransitionCondition[] {
  if (value === undefined) return []
  if (!isRecord(value)) throw new Error(`Transition ${transitionIndex} when must be an object.`)
  const output: AnimationTransitionCondition[] = []
  for (const [parameter, expression] of Object.entries(value)) {
    if (typeof expression === 'boolean' || typeof expression === 'number') {
      output.push(validateCondition({ parameter, operator: 'equals', value: expression }, parameters))
      continue
    }
    if (!isRecord(expression)) throw new Error(`Transition ${transitionIndex} when.${parameter} is invalid.`)
    const entries = Object.entries(expression)
    if (entries.length !== 1) throw new Error(`Transition ${transitionIndex} when.${parameter} must contain one operator.`)
    const [rawOperator, rawValue] = entries[0] as [string, JsonValue]
    const operator = shorthandOperator(rawOperator)
    const conditionValue = scalarConditionValue(rawValue)
    output.push(validateCondition({ parameter, operator, ...(conditionValue !== undefined ? { value: conditionValue } : {}) }, parameters))
  }
  return output
}

function validateCondition(
  condition: AnimationTransitionCondition,
  parameters: AnimationParameterDefinitions,
): AnimationTransitionCondition {
  const definition = parameters[condition.parameter]
  if (!definition) throw new Error(`Transition references unknown parameter "${condition.parameter}".`)
  const triggerOperator = condition.operator === 'triggered' || condition.operator === 'not-triggered'
  if (definition.type === 'trigger' && !triggerOperator) {
    throw new Error(`Trigger parameter "${condition.parameter}" requires triggered or not-triggered.`)
  }
  if (definition.type !== 'trigger' && triggerOperator) {
    throw new Error(`Parameter "${condition.parameter}" is not a trigger.`)
  }
  if (definition.type === 'number' && condition.value !== undefined && typeof condition.value !== 'number') {
    throw new Error(`Number parameter "${condition.parameter}" requires a numeric condition value.`)
  }
  if (definition.type === 'boolean' && condition.value !== undefined && typeof condition.value !== 'boolean') {
    throw new Error(`Boolean parameter "${condition.parameter}" requires a boolean condition value.`)
  }
  return Object.freeze(condition)
}


function readPropertyTracks(value: JsonValue | undefined): AnimationPropertyTrackConfig[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('tracks must be an array.')
  const claimed = new Set<string>()
  return value.map((input, index) => {
    if (!isRecord(input)) throw new Error(`tracks[${index}] must be an object.`)
    const target = requiredString(input.target, `tracks[${index}].target`) as AnimationPropertyTrackTarget
    if (!PROPERTY_TRACK_TARGETS.has(target)) throw new Error(`tracks[${index}].target is not supported.`)
    for (const key of propertyTrackClaims(target)) {
      if (claimed.has(key)) throw new Error(`tracks[${index}].target overlaps another track at ${key}.`)
      claimed.add(key)
    }
    const from = readPropertyTrackValue(input.from, target, `tracks[${index}].from`)
    const to = readPropertyTrackValue(input.to, target, `tracks[${index}].to`)
    const duration = optionalPositiveNumber(input.duration, Number.NaN, `tracks[${index}].duration`)
    if (!Number.isFinite(duration)) throw new Error(`tracks[${index}].duration is required.`)
    const loop = input.loop === undefined ? 'once' : optionalLoop(input.loop)
    const easing = input.easing === undefined ? 'linear' : requiredString(input.easing, `tracks[${index}].easing`) as AnimationPropertyTrackEasing
    if (!PROPERTY_TRACK_EASINGS.has(easing)) throw new Error(`tracks[${index}].easing is not supported.`)
    const id = optionalNonEmptyString(input.id, `tracks[${index}].id`) ?? `track:${index}`
    return Object.freeze({ id, target, from, to, duration, loop, easing })
  })
}

function readPropertyTrackValue(
  value: JsonValue | undefined,
  target: AnimationPropertyTrackTarget,
  field: string,
): AnimationPropertyTrackValue {
  if (target.split('.').length === 3) return finiteNumber(value, field)
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error(`${field} must contain three finite numbers.`)
  }
  return Object.freeze([value[0], value[1], value[2]]) as readonly [number, number, number]
}

function propertyTrackClaims(target: AnimationPropertyTrackTarget): readonly string[] {
  const parts = target.split('.')
  if (parts.length === 3) return [target]
  const prefix = target
  return [`${prefix}.x`, `${prefix}.y`, `${prefix}.z`]
}

function readMarkers(value: JsonValue | undefined): AnimationMarkerBinding[] {
  if (value === undefined) return []
  const output: AnimationMarkerBinding[] = []
  if (Array.isArray(value)) {
    for (const [index, input] of value.entries()) {
      if (!isRecord(input)) throw new Error(`markers[${index}] must be an object.`)
      const marker = requiredString(input.marker, `markers[${index}].marker`)
      output.push(Object.freeze({ marker, actions: Object.freeze(readActions(input.actions, `markers[${index}].actions`)) }))
    }
    return output
  }
  if (!isRecord(value)) throw new Error('markers must be an object or array.')
  for (const [marker, actions] of Object.entries(value)) {
    output.push(Object.freeze({ marker, actions: Object.freeze(readActions(actions, `markers.${marker}`)) }))
  }
  return output
}

function readRootMotion(value: JsonValue | undefined): AnimationRootMotionConfig {
  if (value === undefined) return Object.freeze({ mode: 'disabled', source: 'anyo:animation:root-motion', priority: 20 })
  if (typeof value === 'string') {
    if (!ROOT_MOTION_MODES.has(value as AnimationRootMotionMode)) throw new Error('rootMotion mode is invalid.')
    return Object.freeze({ mode: value as AnimationRootMotionMode, source: 'anyo:animation:root-motion', priority: 20 })
  }
  if (!isRecord(value)) throw new Error('rootMotion must be a mode string or object.')
  const mode = requiredString(value.mode, 'rootMotion.mode') as AnimationRootMotionMode
  if (!ROOT_MOTION_MODES.has(mode)) throw new Error('rootMotion.mode is invalid.')
  const node = optionalNonEmptyString(value.node, 'rootMotion.node')
  const source = optionalNonEmptyString(value.source, 'rootMotion.source') ?? 'anyo:animation:root-motion'
  const priority = value.priority === undefined ? 20 : finiteNumber(value.priority, 'rootMotion.priority')
  return Object.freeze({ mode, ...(node ? { node } : {}), source, priority })
}

function readActions(value: JsonValue | undefined, field: string): AnimationActionReference[] {
  if (value === undefined) return []
  const inputs = Array.isArray(value) ? value : [value]
  return inputs.map((input, index) => {
    if (typeof input === 'string' && input.trim()) return Object.freeze({ action: input })
    if (!isRecord(input)) throw new Error(`${field}[${index}] must be an action name or object.`)
    const action = requiredString(input.action, `${field}[${index}].action`)
    const params = input.params
    if (params !== undefined && !isRecord(params)) throw new Error(`${field}[${index}].params must be an object.`)
    return Object.freeze({ action, ...(params ? { params: Object.freeze({ ...params }) } : {}) })
  })
}

function validateClipReference(reference: string, clips: Readonly<Record<string, string>>, field: string): void {
  if (Object.keys(clips).length === 0) return
  if (reference in clips || new Set(Object.values(clips)).has(reference)) return
  throw new Error(`${field} "${reference}" is not present in clips.`)
}

function shorthandOperator(value: string): AnimationConditionOperator {
  const operators: Record<string, AnimationConditionOperator> = {
    equals: 'equals', notEquals: 'not-equals', greaterThan: 'greater-than',
    greaterThanOrEqual: 'greater-than-or-equal', lessThan: 'less-than',
    lessThanOrEqual: 'less-than-or-equal', triggered: 'triggered', notTriggered: 'not-triggered',
  }
  const operator = operators[value]
  if (!operator) throw new Error(`Unknown transition condition operator "${value}".`)
  return operator
}

function scalarConditionValue(value: JsonValue | undefined): boolean | number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean' || typeof value === 'number') return value
  throw new Error('Transition condition values must be boolean or number.')
}

function optionalNonEmptyString(value: JsonValue | undefined, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`)
  return value
}

function requiredString(value: JsonValue | undefined, field: string): string {
  const result = optionalNonEmptyString(value, field)
  if (!result) throw new Error(`${field} is required.`)
  return result
}

function optionalBoolean(value: JsonValue | undefined, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`)
  return value
}

function optionalBooleanValue(value: JsonValue | undefined, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`)
  return value
}

function optionalLoop(value: JsonValue | undefined): AnimationLoopMode {
  if (value === undefined) return 'repeat'
  if (typeof value !== 'string' || !LOOP_MODES.has(value as AnimationLoopMode)) {
    throw new Error('loop must be one of: once, repeat, ping-pong.')
  }
  return value as AnimationLoopMode
}

function optionalPositiveNumber(value: JsonValue | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number.`)
  }
  return value
}

function optionalFiniteNumber(value: JsonValue | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  return finiteNumber(value, field)
}

function finiteNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number.`)
  return value
}

function nonNegativeFinite(value: JsonValue | undefined, field: string): number {
  const output = finiteNumber(value, field)
  if (output < 0) throw new Error(`${field} must be non-negative.`)
  return output
}

function normalized(value: JsonValue | undefined, field: string): number {
  const output = finiteNumber(value, field)
  if (output < 0 || output > 1) throw new Error(`${field} must be between 0 and 1.`)
  return output
}

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function objectKeySorter(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
}
