import type {
  AnimationParameterSnapshot,
  AnimationStateMachineConfig,
  AnimationTransitionCondition,
  AnimationTransitionConfig,
} from './types.js'

export function selectAnimationTransition(
  machine: AnimationStateMachineConfig,
  currentState: string,
  parameters: AnimationParameterSnapshot,
  normalizedTime: number | undefined,
): AnimationTransitionConfig | null {
  const candidates = machine.transitions
    .filter((transition) => transition.from === '*' || transition.from === currentState)
    .filter((transition) => transition.exitTime === undefined || (normalizedTime ?? 0) >= transition.exitTime)
    .filter((transition) => matchesConditions(transition, parameters))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
  return candidates[0] ?? null
}

export function transitionTriggerNames(transition: AnimationTransitionConfig): readonly string[] {
  if (!transition.consumeTriggers) return []
  return transition.conditions
    .filter((condition) => condition.operator === 'triggered')
    .map((condition) => condition.parameter)
}

function matchesConditions(
  transition: AnimationTransitionConfig,
  parameters: AnimationParameterSnapshot,
): boolean {
  if (transition.conditions.length === 0) return true
  const checks = transition.conditions.map((condition) => matchesCondition(condition, parameters))
  return transition.conditionMode === 'any' ? checks.some(Boolean) : checks.every(Boolean)
}

function matchesCondition(
  condition: AnimationTransitionCondition,
  parameters: AnimationParameterSnapshot,
): boolean {
  const triggered = parameters.activeTriggers.includes(condition.parameter)
  const value = parameters.values[condition.parameter]
  switch (condition.operator) {
    case 'triggered': return triggered
    case 'not-triggered': return !triggered
    case 'equals': return value === condition.value
    case 'not-equals': return value !== condition.value
    case 'greater-than': return numeric(value) > numeric(condition.value)
    case 'greater-than-or-equal': return numeric(value) >= numeric(condition.value)
    case 'less-than': return numeric(value) < numeric(condition.value)
    case 'less-than-or-equal': return numeric(value) <= numeric(condition.value)
  }
}

function numeric(value: boolean | number | undefined): number {
  return typeof value === 'number' ? value : Number.NaN
}
