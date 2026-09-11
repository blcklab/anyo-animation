import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AnimationController,
  createAnimationPlugin,
  parseAnimationComponent,
} from '../dist/esm/index.js'

function createFixture({ ready = true, autoplay = true } = {}) {
  const events = []
  const calls = []
  let availability
  let adapterReady = ready
  let disposedBindings = 0
  let bindingAvailable = true
  const binding = {
    entityId: 'hero',
    availableClips: ['Idle', 'Walk'],
    isAvailable() { return bindingAvailable },
    play(request) { calls.push(['play', request]) },
    pause() { calls.push(['pause']) },
    resume() { calls.push(['resume']) },
    stop() { calls.push(['stop']) },
    seek(time) { calls.push(['seek', time]) },
    setSpeed(speed) { calls.push(['speed', speed]) },
    getTime() { return 0.5 },
    dispose() { disposedBindings += 1 },
  }
  const adapter = {
    attachEntity() { return adapterReady ? binding : null },
    update(delta) { calls.push(['update', delta]) },
    onAvailabilityChange(listener) { availability = listener; return () => { availability = undefined } },
    dispose() { calls.push(['adapter-dispose']) },
  }
  const entity = {
    id: 'hero', authoringId: 'hero', type: 'model', childIds: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    sourcePath: '/entities/0', authoring: { id: 'hero', sourcePath: '/entities/0', editable: true },
    primitiveIds: ['hero:model'],
    components: [{
      type: 'anyo.animation', enabled: true, sourcePath: '/entities/0/components/0',
      data: {
        clips: { idle: 'Idle', walk: 'Walk' },
        defaultClip: 'idle', autoplay, loop: 'repeat', speed: 1,
      },
    }],
  }
  let matches = [{ entity, component: entity.components[0] }]
  const query = {
    entity(id) { return id === 'hero' ? entity : null },
    entities() { return matches.length ? [entity] : [] },
    components(type) { return type === 'anyo.animation' ? matches : [] },
    tagged() { return [] },
    primitives(id) { return id === 'hero' ? [{ id: 'hero:model' }] : [] },
  }
  const context = {
    world: { emit(name, payload) { events.push([name, payload]) } },
    renderer: {}, document: {},
    compiled: { entityById: new Map([['hero', entity]]) },
    transforms: {}, query,
  }
  return {
    adapter, binding, calls, events, context,
    setReady(value) { adapterReady = value },
    setBindingAvailable(value) { bindingAvailable = value },
    notify() { availability?.() },
    removeEntity() { matches = [] },
    disposedBindings() { return disposedBindings },
  }
}

test('parses authored animation components', () => {
  const config = parseAnimationComponent({
    type: 'anyo.animation', enabled: true, sourcePath: '/x',
    data: { clips: { idle: 'Idle' }, defaultClip: 'idle', autoplay: true, loop: 'ping-pong', speed: 1.25 },
  })
  assert.equal(config.defaultClip, 'idle')
  assert.equal(config.loop, 'ping-pong')
  assert.equal(config.speed, 1.25)
  assert.throws(() => parseAnimationComponent({
    type: 'anyo.animation', enabled: true, sourcePath: '/x',
    data: { autoplay: true },
  }), /defaultClip/)
})

test('autoplays, controls, updates, and disposes an attached entity', async () => {
  const fixture = createFixture()
  const plugin = createAnimationPlugin({ adapter: fixture.adapter })
  await plugin.setup(fixture.context)
  assert.equal(plugin.get('hero')?.status, 'playing')
  assert.equal(fixture.calls.some(([name]) => name === 'play'), true)
  plugin.pause('hero')
  plugin.resume('hero')
  plugin.seek('hero', 0.25)
  plugin.setSpeed('hero', 1.5)
  plugin.update(1 / 60)
  plugin.stop('hero')
  fixture.removeEntity()
  plugin.applyChanges([], fixture.context)
  assert.equal(fixture.disposedBindings(), 1)
  plugin.dispose(fixture.context)
  assert.equal(fixture.calls.some(([name]) => name === 'adapter-dispose'), true)
})

test('queues playback until an animated asset becomes available', async () => {
  const fixture = createFixture({ ready: false, autoplay: false })
  const plugin = createAnimationPlugin({ adapter: fixture.adapter })
  await plugin.setup(fixture.context)
  assert.equal(plugin.play('hero', 'walk'), false)
  assert.equal(plugin.get('hero')?.status, 'pending')
  fixture.setReady(true)
  fixture.notify()
  assert.equal(plugin.get('hero')?.status, 'playing')
  const play = fixture.calls.find(([name]) => name === 'play')
  assert.equal(play?.[1].clip, 'walk')
})

test('drops a disposed asset binding and waits for its replacement', async () => {
  const fixture = createFixture()
  const plugin = createAnimationPlugin({ adapter: fixture.adapter })
  await plugin.setup(fixture.context)
  fixture.setBindingAvailable(false)
  fixture.setReady(false)
  fixture.notify()
  assert.equal(plugin.get('hero')?.status, 'pending')
  assert.equal(fixture.disposedBindings(), 1)
})

test('controller can be rebound across Anyo world rebuilds', () => {
  const first = createFixture()
  const controller = new AnimationController(first.adapter)
  controller.bind(first.context)
  controller.dispose()
  const second = createFixture()
  controller.bind(second.context)
  assert.equal(controller.get('hero')?.status, 'playing')
})
