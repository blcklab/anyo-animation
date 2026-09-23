import type { ComponentDefinition, JsonValue } from '@blcklab/anyo'
import { parseAnimationComponent } from '../schema.js'
import { ANYO_ANIMATION_COMPONENT, type AnimationComponentConfig } from '../types.js'

export interface AnimationAuthoringIssue {
  readonly severity: 'error' | 'warning'
  readonly path: string
  readonly message: string
}

export function createAnimationComponentDefinition(
  config: AnimationComponentConfig,
  options: { id?: string; enabled?: boolean } = {},
): ComponentDefinition {
  return {
    type: ANYO_ANIMATION_COMPONENT,
    ...(options.id ? { id: options.id } : {}),
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
    clips: { ...config.clips },
    ...(config.defaultClip ? { defaultClip: config.defaultClip } : {}),
    autoplay: config.autoplay,
    loop: config.loop,
    speed: config.speed,
    parameters: toJsonValue(config.parameters),
    ...(config.stateMachine ? { stateMachine: toJsonValue(config.stateMachine) } : {}),
    markers: toJsonValue(config.markers),
    rootMotion: toJsonValue(config.rootMotion),
    ...(config.tracks?.length ? { tracks: toJsonValue(config.tracks) } : {}),
  }
}

export function validateAnimationComponentData(data: Readonly<Record<string, JsonValue>>): readonly AnimationAuthoringIssue[] {
  try {
    parseAnimationComponent({
      type: ANYO_ANIMATION_COMPONENT,
      enabled: true,
      sourcePath: '/component',
      data,
    })
    return []
  } catch (error) {
    return Object.freeze([{
      severity: 'error',
      path: '/component',
      message: error instanceof Error ? error.message : String(error),
    }])
  }
}

export function listAnimationClipReferences(config: AnimationComponentConfig): readonly string[] {
  const references = new Set<string>()
  if (config.defaultClip) references.add(config.defaultClip)
  for (const clip of Object.values(config.clips)) references.add(clip)
  for (const state of Object.values(config.stateMachine?.states ?? {})) references.add(state.clip)
  return Object.freeze([...references].sort())
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
