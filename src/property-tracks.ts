import type { CompiledEntityNode, RuntimeTransformInput, Vec3 } from '@blcklab/anyo'
import type {
  AnimationComponentConfig,
  AnimationPropertyTrackConfig,
  AnimationPropertyTrackEasing,
  AnimationPropertyTrackTarget,
  AnimationPropertyTrackValue,
} from './types.js'

export const ANYO_ANIMATION_TRACK_SOURCE = 'anyo:animation:property-tracks' as const
export const ANYO_ANIMATION_TRACK_PRIORITY = 10 as const

const AXIS_INDEX = Object.freeze({ x: 0, y: 1, z: 2 } as const)

type MutableVec3 = [number, number, number]

export function hasPropertyTracks(config: Pick<AnimationComponentConfig, 'tracks'>): boolean {
  return (config.tracks?.length ?? 0) > 0
}

export function requiresAnimationBinding(config: AnimationComponentConfig): boolean {
  return (
    Object.keys(config.clips).length > 0 ||
    Boolean(config.defaultClip) ||
    Boolean(config.stateMachine) ||
    config.rootMotion.mode !== 'disabled' ||
    config.markers.length > 0
  )
}

export function evaluatePropertyTracks(
  tracks: readonly AnimationPropertyTrackConfig[],
  timeSeconds: number,
  entity: CompiledEntityNode,
): RuntimeTransformInput | null {
  if (tracks.length === 0) return null
  const base = entity.localTransform ?? entity.transform
  const position: MutableVec3 = [...base.position]
  const rotation: MutableVec3 = [...base.rotation]
  const scale: MutableVec3 = [...base.scale]
  let positionUsed = false
  let rotationUsed = false
  let scaleUsed = false

  for (const track of tracks) {
    const value = evaluatePropertyTrack(track, timeSeconds)
    const [channel, axis] = parseTarget(track.target)
    const destination = channel === 'position' ? position : channel === 'rotation' ? rotation : scale
    if (axis === null) {
      const vector = value as readonly [number, number, number]
      destination[0] = vector[0]
      destination[1] = vector[1]
      destination[2] = vector[2]
    } else {
      destination[axis] = value as number
    }
    if (channel === 'position') positionUsed = true
    else if (channel === 'rotation') rotationUsed = true
    else scaleUsed = true
  }

  return {
    ...(positionUsed ? { position: position as Vec3 } : {}),
    ...(rotationUsed ? { rotation: rotation as Vec3 } : {}),
    ...(scaleUsed ? { scale: scale as Vec3 } : {}),
  }
}

export function evaluatePropertyTrack(
  track: AnimationPropertyTrackConfig,
  timeSeconds: number,
): AnimationPropertyTrackValue {
  const progress = easedProgress(track, timeSeconds)
  if (typeof track.from === 'number' && typeof track.to === 'number') {
    return lerp(track.from, track.to, progress)
  }
  const from = track.from as readonly [number, number, number]
  const to = track.to as readonly [number, number, number]
  return Object.freeze([
    lerp(from[0], to[0], progress),
    lerp(from[1], to[1], progress),
    lerp(from[2], to[2], progress),
  ]) as readonly [number, number, number]
}

function easedProgress(track: AnimationPropertyTrackConfig, timeSeconds: number): number {
  const time = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0)
  const duration = track.duration
  let progress: number
  if (track.loop === 'once') {
    progress = Math.min(1, time / duration)
  } else if (track.loop === 'repeat') {
    progress = (time % duration) / duration
  } else {
    const phase = (time / duration) % 2
    progress = phase <= 1 ? phase : 2 - phase
  }
  return ease(progress, track.easing)
}

function ease(value: number, easing: AnimationPropertyTrackEasing): number {
  if (easing === 'ease-in') return value * value
  if (easing === 'ease-out') return 1 - (1 - value) * (1 - value)
  if (easing === 'ease-in-out') {
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2
  }
  return value
}

function parseTarget(target: AnimationPropertyTrackTarget): ['position' | 'rotation' | 'scale', 0 | 1 | 2 | null] {
  const [, channel, axis] = target.split('.') as [string, 'position' | 'rotation' | 'scale', keyof typeof AXIS_INDEX | undefined]
  return [channel, axis ? AXIS_INDEX[axis] : null]
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}
