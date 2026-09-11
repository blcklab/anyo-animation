import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANYO_ANIMATION_SNAPSHOT_VERSION,
  createAnimationPlugin,
  parseAnimationComponent,
} from '../dist/esm/index.js'
import {
  createAnimationComponentDefinition,
  listAnimationClipReferences,
  validateAnimationComponentData,
} from '../dist/esm/authoring/index.js'

function createStableFixture() {
  const events = []
  const calls = []
  const actions = []
  const transforms = []
  const eventHandlers = new Map()
  const actionHandlers = new Map()
  let bindingEvent
  let rootMotion = [0, 0, 0]
  let time = 0
  let duration = 1
  let disposed = false
  const binding = {
    entityId: 'hero',
    availableClips: ['Idle', 'Walk', 'Jump'],
    play(request) { calls.push(['play', request]); time = request.startTime ?? 0 },
    crossFade(request) { calls.push(['crossFade', request]); time = request.startTime ?? 0 },
    pause() { calls.push(['pause']) },
    resume() { calls.push(['resume']) },
    stop() { calls.push(['stop']) },
    seek(value) { time = value; calls.push(['seek', value]) },
    setSpeed(value) { calls.push(['speed', value]) },
    getTime() { return time },
    getDuration() { return duration },
    getNormalizedTime() { return duration ? time / duration : 0 },
    onEvent(listener) { bindingEvent = listener; return () => { bindingEvent = undefined } },
    consumeRootMotion() { const value = rootMotion; rootMotion = [0, 0, 0]; return value },
    dispose() { disposed = true },
  }
  const adapter = { attachEntity() { return binding }, update(delta) { time += delta } }
  const component = {
    type: 'anyo.animation', enabled: true, sourcePath: '/entities/0/components/0',
    data: {
      clips: { idle: 'Idle', walk: 'Walk', jump: 'Jump' },
      autoplay: true,
      parameters: {
        moving: { type: 'boolean', default: false },
        speed: { type: 'number', default: 0, min: 0, max: 5 },
        jump: { type: 'trigger' },
      },
      stateMachine: {
        initial: 'idle',
        states: {
          idle: { clip: 'idle', onEnter: { action: 'state-entered', params: { state: 'idle' } } },
          walk: { clip: 'walk' },
          jump: { clip: 'jump', loop: 'once' },
        },
        transitions: [
          { id: 'move', from: 'idle', to: 'walk', when: { speed: { greaterThan: 0.1 } }, duration: 0.25 },
          { id: 'jump', from: '*', to: 'jump', when: { jump: { triggered: true } }, priority: 10, duration: 0.1 },
          { id: 'land', from: 'jump', to: 'idle', exitTime: 1, duration: 0.1 },
        ],
      },
      markers: { footstep: { action: 'footstep', params: { side: 'left' } } },
      rootMotion: { mode: 'apply-to-entity', source: 'animation-root', priority: 25 },
    },
  }
  const entity = {
    id: 'hero', authoringId: 'hero', type: 'model', childIds: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    sourcePath: '/entities/0', authoring: { id: 'hero', sourcePath: '/entities/0', editable: true },
    primitiveIds: ['hero:model'], components: [component],
  }
  let matches = [{ entity, component }]
  const world = {
    emit(name, payload) { events.push([name, payload]); for (const handler of eventHandlers.get(name) ?? []) handler(payload) },
    on(name, handler) { const handlers = eventHandlers.get(name) ?? new Set(); handlers.add(handler); eventHandlers.set(name, handlers); return () => handlers.delete(handler) },
    registerAction(name, handler) { actionHandlers.set(name, handler); return () => actionHandlers.delete(name) },
    async runAction(name, params, source) { actions.push([name, params, source]); await actionHandlers.get(name)?.(params, { world, source }) },
  }
  const context = {
    world, renderer: {}, document: {}, compiled: {},
    transforms: {
      set(entityId, transform, options) { transforms.push(['set', entityId, transform, options]) },
      clear(entityId, source) { transforms.push(['clear', entityId, source]); return true },
    },
    query: {
      entity(id) { return id === 'hero' && matches.length ? entity : null },
      entities() { return matches.length ? [entity] : [] },
      components(type) { return type === 'anyo.animation' ? matches : [] },
      tagged() { return [] },
      primitives(id) { return id === 'hero' ? [{ id: 'hero:model' }] : [] },
    },
  }
  return {
    adapter, binding, component, context, calls, events, actions, transforms,
    emitBinding(event) { bindingEvent?.(event) },
    setRootMotion(value) { rootMotion = value },
    setTime(value) { time = value },
    setDuration(value) { duration = value },
    remove() { matches = [] },
    disposed() { return disposed },
  }
}

test('parses parameters, state machines, marker actions, and root motion', () => {
  const fixture = createStableFixture()
  const config = parseAnimationComponent(fixture.component)
  assert.equal(config.parameters.speed.max, 5)
  assert.equal(config.stateMachine.initial, 'idle')
  assert.equal(config.stateMachine.transitions[0].duration, 0.25)
  assert.equal(config.markers[0].marker, 'footstep')
  assert.equal(config.rootMotion.mode, 'apply-to-entity')
})

test('drives typed parameters, subscriptions, bindings, and deterministic snapshots', async () => {
  const fixture = createStableFixture()
  const plugin = createAnimationPlugin({ adapter: fixture.adapter })
  await plugin.setup(fixture.context)
  assert.equal(plugin.getParameter('hero', 'moving'), false)
  const values = []
  const unsubscribe = plugin.subscribeParameter('hero', 'speed', (value) => values.push(value))
  plugin.setNumber('hero', 'speed', 99)
  assert.equal(plugin.getParameter('hero', 'speed'), 5)
  assert.deepEqual(values, [5])
  plugin.setNumber('hero', 'speed', 5)
  assert.deepEqual(values, [5])
  let bound = 2
  const unbind = plugin.bindParameter('hero', 'speed', () => bound)
  plugin.update(0.016)
  assert.equal(plugin.getParameter('hero', 'speed'), 2)
  const snapshot = plugin.createSnapshot()
  assert.equal(snapshot.version, ANYO_ANIMATION_SNAPSHOT_VERSION)
  assert.doesNotThrow(() => JSON.stringify(snapshot))
  plugin.setBoolean('hero', 'moving', true)
  plugin.restoreSnapshot(snapshot)
  assert.equal(plugin.getParameter('hero', 'moving'), false)
  unsubscribe(); unbind(); await plugin.disposeAsync()
})

test('evaluates transitions, crossfades, consumes triggers, and runs marker actions', async () => {
  const fixture = createStableFixture()
  const plugin = createAnimationPlugin({ adapter: fixture.adapter })
  await plugin.setup(fixture.context)
  assert.equal(plugin.get('hero').currentState, 'idle')
  plugin.setNumber('hero', 'speed', 1)
  plugin.update(0.016)
  assert.equal(plugin.get('hero').currentState, 'walk')
  assert.equal(fixture.calls.some(([name, request]) => name === 'crossFade' && request.clip === 'walk'), true)
  plugin.setTrigger('hero', 'jump')
  plugin.update(0.016)
  assert.equal(plugin.get('hero').currentState, 'jump')
  assert.equal(plugin.getParameter('hero', 'jump'), false)
  fixture.emitBinding({ type: 'marker', name: 'footstep', time: 0.2 })
  await Promise.resolve()
  assert.equal(fixture.actions.some(([name, params]) => name === 'footstep' && params.side === 'left'), true)
  fixture.setTime(1)
  plugin.update(0.016)
  assert.equal(plugin.get('hero').currentState, 'idle')
  await plugin.disposeAsync()
})

test('extracts and applies root motion through Anyo transient transforms', async () => {
  const fixture = createStableFixture()
  const plugin = createAnimationPlugin({ adapter: fixture.adapter })
  await plugin.setup(fixture.context)
  fixture.setRootMotion([1, 2, 3])
  plugin.update(0.016)
  assert.deepEqual(plugin.get('hero').rootMotion, [1, 2, 3])
  const write = fixture.transforms.find(([name]) => name === 'set')
  assert.deepEqual(write[2].position, [1, 2, 3])
  assert.equal(write[3].source, 'animation-root')
  fixture.remove()
  plugin.applyChanges([], fixture.context)
  assert.equal(fixture.disposed(), true)
  assert.equal(fixture.transforms.some(([name]) => name === 'clear'), true)
  await plugin.disposeAsync()
})

test('integrates host pause/resume events and world actions', async () => {
  const fixture = createStableFixture()
  const plugin = createAnimationPlugin({ adapter: fixture.adapter })
  await plugin.setup(fixture.context)
  fixture.context.world.emit('player:pause')
  fixture.context.world.emit('player:resume')
  await fixture.context.world.runAction('animation.parameter', { entityId: 'hero', parameter: 'moving', value: true })
  await fixture.context.world.runAction('animation.trigger', { entityId: 'hero', parameter: 'jump' })
  assert.equal(plugin.getParameter('hero', 'moving'), true)
  assert.equal(plugin.getParameter('hero', 'jump'), true)
  assert.equal(fixture.calls.some(([name]) => name === 'pause'), true)
  assert.equal(fixture.calls.some(([name]) => name === 'resume'), true)
  await plugin.disposeAsync()
})

test('provides editor-safe authoring helpers without renderer imports', () => {
  const fixture = createStableFixture()
  const config = parseAnimationComponent(fixture.component)
  const definition = createAnimationComponentDefinition(config)
  assert.equal(definition.type, 'anyo.animation')
  assert.deepEqual(validateAnimationComponentData(definition), [])
  assert.deepEqual(listAnimationClipReferences(config), ['Idle', 'Jump', 'Walk', 'idle', 'jump', 'walk'])
})
