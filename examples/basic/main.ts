import { createWorld } from '@blcklab/anyo'
import { entitiesPlugin } from '@blcklab/anyo/entities'
import { createSekai64AnimationRuntime } from '@blcklab/anyo-animation/sekai64'

const canvas = document.querySelector<HTMLCanvasElement>('#world')
if (!canvas) throw new Error('Missing #world canvas.')

const animation = createSekai64AnimationRuntime({ canvas, backend: 'auto' })
const world = createWorld({
  renderer: animation.renderer,
  plugins: [entitiesPlugin(), animation.plugin],
})

await world.load('/world.json')
world.start()

animation.plugin.setNumber('hero', 'speed', 1.5)
animation.plugin.setTrigger('hero', 'jump')

const snapshot = animation.plugin.createSnapshot()
animation.plugin.restoreSnapshot(snapshot)
