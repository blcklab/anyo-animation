import type {
  AnimationParameterBinding,
  AnimationParameterBindingContext,
  AnimationParameterDefinition,
  AnimationParameterDefinitions,
  AnimationParameterSnapshot,
  AnimationParameterValue,
} from './types.js'

interface BindingRecord {
  readonly parameter: string
  readonly binding: AnimationParameterBinding
}

export class AnimationParameterStore {
  private definitions: AnimationParameterDefinitions
  private readonly values = new Map<string, AnimationParameterValue>()
  private readonly activeTriggers = new Set<string>()
  private readonly subscribers = new Map<string, Set<(value: AnimationParameterValue) => void>>()
  private readonly bindings = new Set<BindingRecord>()

  constructor(definitions: AnimationParameterDefinitions) {
    this.definitions = definitions
    this.initialize(definitions)
  }

  reconfigure(definitions: AnimationParameterDefinitions): void {
    const previous = this.snapshot()
    this.definitions = definitions
    this.values.clear()
    this.activeTriggers.clear()
    this.initialize(definitions)
    for (const [name, value] of Object.entries(previous.values)) {
      const definition = definitions[name]
      if (!definition || definition.type === 'trigger') continue
      if (definition.type === 'boolean' && typeof value === 'boolean') {
        this.values.set(name, value)
      } else if (definition.type === 'number' && typeof value === 'number') {
        this.values.set(name, Math.max(definition.min ?? -Infinity, Math.min(definition.max ?? Infinity, value)))
      }
    }
    for (const name of previous.activeTriggers) {
      if (definitions[name]?.type === 'trigger') this.activeTriggers.add(name)
    }
    for (const record of [...this.bindings]) {
      if (!definitions[record.parameter] || definitions[record.parameter]?.type === 'trigger') {
        this.bindings.delete(record)
      }
    }
  }

  has(name: string): boolean {
    return Boolean(this.definitions[name])
  }

  definition(name: string): AnimationParameterDefinition | undefined {
    return this.definitions[name]
  }

  get(name: string): AnimationParameterValue | undefined {
    const definition = this.definitions[name]
    if (!definition) return undefined
    if (definition.type === 'trigger') return this.activeTriggers.has(name)
    return this.values.get(name)
  }

  setBoolean(name: string, value: boolean): boolean {
    this.assertType(name, 'boolean')
    return this.set(name, value)
  }

  setNumber(name: string, value: number): boolean {
    const definition = this.assertType(name, 'number')
    if (!Number.isFinite(value)) throw new Error(`Animation parameter "${name}" must be a finite number.`)
    const resolved = Math.max(definition.min ?? -Infinity, Math.min(definition.max ?? Infinity, value))
    return this.set(name, resolved)
  }

  setTrigger(name: string): boolean {
    this.assertType(name, 'trigger')
    if (this.activeTriggers.has(name)) return false
    this.activeTriggers.add(name)
    this.notify(name, true)
    return true
  }

  resetTrigger(name: string): boolean {
    this.assertType(name, 'trigger')
    if (!this.activeTriggers.delete(name)) return false
    this.notify(name, false)
    return true
  }

  consumeTrigger(name: string): boolean {
    return this.resetTrigger(name)
  }

  setParameter(name: string, value: AnimationParameterValue): boolean {
    const definition = this.requireDefinition(name)
    if (definition.type === 'trigger') {
      if (typeof value !== 'boolean') throw new Error(`Animation trigger "${name}" expects a boolean.`)
      return value ? this.setTrigger(name) : this.resetTrigger(name)
    }
    if (definition.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Animation parameter "${name}" expects a boolean.`)
      return this.setBoolean(name, value)
    }
    if (typeof value !== 'number') throw new Error(`Animation parameter "${name}" expects a number.`)
    return this.setNumber(name, value)
  }

  subscribe(name: string, listener: (value: AnimationParameterValue) => void): () => void {
    this.requireDefinition(name)
    const listeners = this.subscribers.get(name) ?? new Set()
    listeners.add(listener)
    this.subscribers.set(name, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.subscribers.delete(name)
    }
  }

  bind(parameter: string, binding: AnimationParameterBinding): () => void {
    const definition = this.requireDefinition(parameter)
    if (definition.type === 'trigger') throw new Error('Trigger parameters cannot use continuous bindings.')
    const record = { parameter, binding }
    this.bindings.add(record)
    return () => { this.bindings.delete(record) }
  }

  updateBindings(context: AnimationParameterBindingContext): void {
    for (const record of [...this.bindings]) {
      const definition = this.definitions[record.parameter]
      if (!definition || definition.type === 'trigger') {
        this.bindings.delete(record)
        continue
      }
      const value = record.binding(context)
      this.setParameter(record.parameter, value)
    }
  }

  snapshot(): AnimationParameterSnapshot {
    const values: Record<string, AnimationParameterValue> = {}
    for (const [name, definition] of Object.entries(this.definitions)) {
      if (definition.type === 'trigger') continue
      const value = this.values.get(name)
      if (value !== undefined) values[name] = value
    }
    return Object.freeze({
      values: Object.freeze(values),
      activeTriggers: Object.freeze([...this.activeTriggers].sort()),
    })
  }

  restore(snapshot: AnimationParameterSnapshot): void {
    for (const [name, value] of Object.entries(snapshot.values)) {
      if (!this.definitions[name]) continue
      this.setParameter(name, value)
    }
    for (const name of [...this.activeTriggers]) this.resetTrigger(name)
    for (const name of snapshot.activeTriggers) {
      if (this.definitions[name]?.type === 'trigger') this.setTrigger(name)
    }
  }

  dispose(): void {
    this.values.clear()
    this.activeTriggers.clear()
    this.subscribers.clear()
    this.bindings.clear()
  }

  private initialize(definitions: AnimationParameterDefinitions): void {
    for (const [name, definition] of Object.entries(definitions)) {
      if (definition.type === 'boolean') this.values.set(name, definition.default ?? false)
      else if (definition.type === 'number') this.values.set(name, clampDefault(definition))
    }
  }

  private set(name: string, value: AnimationParameterValue, notify = true): boolean {
    if (Object.is(this.values.get(name), value)) return false
    this.values.set(name, value)
    if (notify) this.notify(name, value)
    return true
  }

  private notify(name: string, value: AnimationParameterValue): void {
    for (const listener of [...(this.subscribers.get(name) ?? [])]) listener(value)
  }

  private requireDefinition(name: string): AnimationParameterDefinition {
    const definition = this.definitions[name]
    if (!definition) throw new Error(`Unknown animation parameter "${name}".`)
    return definition
  }

  private assertType<T extends AnimationParameterDefinition['type']>(
    name: string,
    type: T,
  ): Extract<AnimationParameterDefinition, { type: T }> {
    const definition = this.requireDefinition(name)
    if (definition.type !== type) {
      throw new Error(`Animation parameter "${name}" is ${definition.type}; expected ${type}.`)
    }
    return definition as Extract<AnimationParameterDefinition, { type: T }>
  }
}

function clampDefault(definition: Extract<AnimationParameterDefinition, { type: 'number' }>): number {
  const value = definition.default ?? 0
  return Math.max(definition.min ?? -Infinity, Math.min(definition.max ?? Infinity, value))
}

