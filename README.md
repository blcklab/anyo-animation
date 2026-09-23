# @blcklab/anyo-animation

Optional, renderer-neutral animation behavior for Anyo worlds.

The package owns authored playback rules: typed parameters, state machines, deterministic transitions, crossfades, marker actions, snapshots, lifecycle handling, and root-motion ownership. Low-level clip sampling, skeletons, morph targets, and mixers remain in the renderer adapter.

```txt
Anyo JSON
   ↓
@blcklab/anyo-animation
   ↓
renderer-neutral animation adapter
   ↓
@blcklab/anyo-animation/sekai64
   ↓
@blcklab/sekai64/animation
```

The root entry has zero runtime dependencies and never imports Sekai64.

## Install

```bash
npm install @blcklab/anyo-animation @blcklab/anyo
```

For the official Sekai64 integration:

```bash
npm install @blcklab/sekai64
```

## Quick start

```ts
import { createWorld } from '@blcklab/anyo'
import { entitiesPlugin } from '@blcklab/anyo/entities'
import { createSekai64AnimationRuntime } from '@blcklab/anyo-animation/sekai64'

const animation = createSekai64AnimationRuntime({
  canvas: document.querySelector('#world') as HTMLCanvasElement,
  backend: 'auto',
})

const world = createWorld({
  renderer: animation.renderer,
  plugins: [entitiesPlugin(), animation.plugin],
})

await world.load('/world.json')
world.start()
```

The Sekai64 integration installs its optional animation renderer module lazily and registers the explicit `animated-model` asset loader. Static Anyo projects remain unchanged.

### Player / shared VRM integration

Hosts that install renderer modules directly can use `createSekai64AnimationIntegration()` and pass the same `module` to the Avatar VRM loader. The animation adapter can then bind a compatible animated `GltfModelNode` even when that model was loaded by the VRM loader rather than by Animation's own `animated-model` loader.

```ts
import { createSekai64AnimationIntegration } from '@blcklab/anyo-animation/sekai64'
import { createSekai64VrmAssetLoader } from '@blcklab/anyo-avatar/vrm/sekai64'

const animation = createSekai64AnimationIntegration()

const renderer = {
  modules: [animation.module],
  assetLoaders: [
    animation.assetLoader,
    createSekai64VrmAssetLoader({ animationModule: animation.module }),
  ],
}

const plugins = [animation.plugin]
```

This is additive: `createSekai64AnimationRuntime()` and the existing `animated-model` workflow remain supported.

## Authored component

```json
{
  "type": "anyo.animation",
  "clips": {
    "idle": "Idle",
    "walk": "Walk",
    "run": "Run",
    "jump": "Jump"
  },
  "autoplay": true,
  "parameters": {
    "moving": { "type": "boolean", "default": false },
    "speed": { "type": "number", "default": 0, "min": 0, "max": 5 },
    "jump": { "type": "trigger" }
  },
  "stateMachine": {
    "initial": "idle",
    "states": {
      "idle": { "clip": "idle" },
      "walk": { "clip": "walk" },
      "run": { "clip": "run" },
      "jump": { "clip": "jump", "loop": "once" }
    },
    "transitions": [
      {
        "from": "idle",
        "to": "walk",
        "when": { "speed": { "greaterThan": 0.1 } },
        "duration": 0.2
      },
      {
        "from": "*",
        "to": "jump",
        "when": { "jump": { "triggered": true } },
        "priority": 100,
        "duration": 0.1
      },
      {
        "from": "jump",
        "to": "idle",
        "exitTime": 1,
        "duration": 0.15
      }
    ]
  },
  "markers": {
    "footstep-left": {
      "action": "audio.play",
      "params": { "clip": "footstep-left" }
    }
  },
  "rootMotion": {
    "mode": "horizontal-only",
    "node": "Hips"
  }
}
```

## Runtime control

```ts
animation.plugin.play('hero', 'walk')
animation.plugin.transitionTo('hero', 'run', 0.25)
animation.plugin.pause('hero')
animation.plugin.resume('hero')
animation.plugin.seek('hero', 0.5)
animation.plugin.setSpeed('hero', 1.25)
animation.plugin.stop('hero')
```

Commands issued before an animated asset finishes loading are retained and applied after the binding becomes available.

## Parameters

```ts
animation.plugin.setBoolean('hero', 'moving', true)
animation.plugin.setNumber('hero', 'speed', 2.5)
animation.plugin.setTrigger('hero', 'jump')
animation.plugin.resetTrigger('hero', 'jump')

const speed = animation.plugin.getParameter('hero', 'speed')
```

Number parameters are clamped to their authored minimum and maximum. Triggers are one-shot values and are consumed automatically by matching transitions.

### Subscriptions and host bindings

```ts
const unsubscribe = animation.plugin.subscribeParameter(
  'hero',
  'speed',
  (speed) => console.log(speed),
)

const unbind = animation.plugin.bindParameter(
  'hero',
  'speed',
  () => movementController.speed,
)
```

Bindings are renderer-neutral and do not import controls, physics, Player, or Editor packages.

## State machines

Transitions support:

```txt
equals
notEquals
greaterThan
greaterThanOrEqual
lessThan
lessThanOrEqual
triggered
notTriggered
```

Additional policies:

```txt
all / any condition mode
any-state transitions with "*"
normalized exit time
priority
interruptible transitions
trigger consumption
crossfade duration
state entry and exit actions
```

Sekai64 executes the blend. Anyo Animation determines when and why a state changes.

## Marker actions

Sekai64 clip markers are forwarded as `animation:marker` events. Authored marker bindings run existing Anyo actions using JSON-compatible parameters. Executable JavaScript is never stored in world JSON.

## Root motion

Supported modes:

```txt
disabled
extract-only
apply-to-entity
apply-to-controller
horizontal-only
```

For Sekai64, the selected root translation track is removed from the rendered clip and sampled separately. This prevents double motion when the extracted delta is written into Anyo's transient transform store.

`apply-to-controller` and `extract-only` emit `animation:root-motion`; applications can also use `onRootMotion`.

## Snapshots

```ts
const entityParameters = animation.plugin.createParameterSnapshot('hero')
animation.plugin.restoreParameterSnapshot('hero', entityParameters)

const session = animation.plugin.createSnapshot()
localStorage.setItem('animation', JSON.stringify(session))
animation.plugin.restoreSnapshot(JSON.parse(localStorage.getItem('animation')!))
```

Snapshots contain plain JSON-compatible values and never revive entities that are no longer present.

## Player and recovery lifecycle

The plugin reacts to Player/world pause and resume events and reconciles after renderer recovery or world replacement. It cleans up bindings, subscriptions, parameter bindings, root-motion transform layers, cloned root-motion clips, and mixer listeners.

For explicit teardown:

```ts
await animation.plugin.disposeAsync()
```

## World actions

The plugin registers:

```txt
animation.play
animation.state
animation.parameter
animation.trigger
```

These make animation control available to other data-driven Anyo systems without direct package coupling.

## Authoring integration

Editor and generator tools should import the optional authoring subpath:

```ts
import {
  createAnimationComponentDefinition,
  listAnimationClipReferences,
  validateAnimationComponentData,
} from '@blcklab/anyo-animation/authoring'
```

This entry is renderer-neutral and safe for Editor forms, prefab validation, inspectors, and schema-driven tooling.

## Custom renderer adapters

```ts
import { createAnimationPlugin } from '@blcklab/anyo-animation'

const animation = createAnimationPlugin({
  adapter: myAnimationAdapter,
  strict: true,
  onDiagnostic(diagnostic) {
    console.warn(diagnostic.code, diagnostic.message)
  },
})
```

Implement `AnimationRuntimeAdapter` and `AnimationEntityBinding`. Crossfades, events, normalized time, and root-motion extraction are optional capabilities; basic playback remains supported.

## Package boundaries

```txt
@blcklab/anyo-animation
  parameters, state machines, actions, snapshots, lifecycle

@blcklab/anyo-animation/authoring
  editor-safe component creation and validation

@blcklab/anyo-animation/sekai64
  animated glTF/GLB loader, mixers, crossfades, markers, root motion
```

## Stable guarantees

See [Compatibility](docs/COMPATIBILITY.md) for the `0.1.x` compatibility contract.

### Externally prepared clips

Renderer-specific importers/retargeters can prepare Sekai64 `AnimationClip` objects for an already-loaded model and hand playback ownership to Anyo Animation:

```ts
const unregister = integration.adapter.registerExternalClips(model, clips, {
  restorePose,
})
```

This hook does not parse or retarget animation data. The producer owns the clips and must dispose them after unregistering. Anyo Animation owns mixer/play/stop/crossfade behavior while the registration is active. This is intended for integrations such as VRMA humanoid retargeting without duplicating the renderer animation runtime.
