## 0.1.2+dev.28 — direct clip crossfade control

- Add `AnimationController.crossFade()` and `plugin.crossFade()` for hosts that dynamically register clips instead of authoring a static state machine.
- Add host action `animation.crossfade`.
- Preserve existing state-machine transition crossfades and all stable 0.1.2 contracts.

## 0.1.2+dev.22

- Add `Sekai64AnimationAdapter.registerExternalClips()` so another package can prepare/retarget clips for an already-loaded Sekai64 model while Anyo Animation remains the playback/state owner.
- External clip registrations are discovered through the renderer's existing primitive node, avoiding a second model load or second animation module.
- Allow external registrations to provide a pose-restoration callback used before playback and when animation releases the rig.
- Keep clip ownership with the caller; unregistering only removes the adapter registration and reconciles bindings.

## 0.1.2

- Added loader-independent Sekai64 animation binding so `anyo.animation` can control compatible animated GLB/VRM runtime models created by another asset loader.
- Added `createSekai64AnimationIntegration()` for host/player composition around one shared Sekai64 animation module.
- Reuse an already-installed `sekai64.animation` module, allowing the Anyo Player and VRM loader to share skinning/mixer state without a duplicate-module error.
- Added Anyo 0.10 world `teardown()` handling so world replacement releases per-world bindings without permanently disposing the reusable adapter.
- Kept all existing 0.1.x APIs, component JSON, asset type defaults, and peer ranges compatible.

## 0.1.1

- Publish-prep: accept Anyo 0.10 prereleases in the peer range.
- Validate development against Anyo 0.10.0-rc.1 and Sekai64 0.8.0-rc.33.

- Fixed TypeScript self-resolution for the shipped root, authoring, and Sekai64 examples.
- Refreshed development validation to Anyo `0.9.1-rc.7` and Sekai64 `0.8.0-rc.17`.
- Kept the Animation JSON and public runtime contract unchanged.

# Changelog

## 0.1.0

- Promoted the optional renderer-neutral Anyo animation runtime to stable.
- Added isolated boolean, number, and trigger parameters per animated entity.
- Added subscriptions, host bindings, parameter snapshots, and world-level snapshots.
- Added authored state machines with any-state transitions, conditions, exit time, priority, interruption, and trigger consumption.
- Added renderer-neutral transition decisions and Sekai64 crossfade execution.
- Added state entry/exit actions and clip-marker action mappings using data-only Anyo action references.
- Added root-motion extraction policies: disabled, extract-only, apply-to-entity, apply-to-controller, and horizontal-only.
- Added Sekai64 root-track removal so extracted root motion is not rendered twice.
- Added Player/world pause-resume integration, recovery reconciliation, awaited explicit disposal, and replacement cleanup.
- Added the renderer-neutral `@blcklab/anyo-animation/authoring` entry for Editor and generator integrations.
- Added stable package verification, examples, packed ESM/CJS/TypeScript consumers, and a documented 0.1.x compatibility contract.

## 0.1.0-rc.1

- Added the optional renderer-neutral Anyo animation plugin and controller.
- Added authored `anyo.animation` component parsing with clip aliases, autoplay, loop mode, and speed.
- Added queued playback commands for assets that are still loading.
- Added the explicit `@blcklab/anyo-animation/sekai64` integration.
- Added a dedicated `animated-model` loader so Anyo's static model path remains unchanged.
- Added lazy Sekai64 animation-module installation and animated glTF/GLB mixer discovery.
- Added entity removal, model replacement, world replacement, pause, resume, stop, seek, speed, and disposal handling.
