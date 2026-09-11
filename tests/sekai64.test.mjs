import test from 'node:test'
import assert from 'node:assert/strict'
import { Sekai64AnimationAdapter, createSekai64AnimationIntegration } from '../dist/esm/sekai64/index.js'
import { GltfLoader } from '@blcklab/sekai64/gltf'
import { createAnimationRendererModule, createGltfAnimationAdapter } from '@blcklab/sekai64/animation'

function animatedGltfDataUri() {
  const bytes = new Uint8Array(68)
  const view = new DataView(bytes.buffer)
  const floats = [
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    0, 1,
    0, 0, 0,
    0, 2, 0,
  ]
  floats.forEach((value, index) => view.setFloat32(index * 4, value, true))
  const buffer = `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`
  const document = {
    asset: { version: '2.0' },
    buffers: [{ uri: buffer, byteLength: bytes.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: 'AnimatedNode', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    animations: [{
      name: 'Bounce',
      samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
    }],
  }
  return `data:model/gltf+json,${encodeURIComponent(JSON.stringify(document))}`
}

test('loads an animated glTF and drives it through the Sekai64 adapter', async () => {
  let installed = false
  let moduleInstance
  const engine = {
    modules: { has: () => installed },
    async installModules(modules) {
      for (const module of modules) {
        moduleInstance = await module.setup({
          renderer: { backend: 'webgl2' },
          diagnostics: { report() {} },
          registerCleanup() { return () => {} },
        })
        installed = true
      }
    },
  }
  const renderer = {
    getNativeAccess() {
      return { engine, scene: {}, camera: {}, getPrimitiveNode() {}, getRoomNode() {} }
    },
  }
  const adapter = new Sekai64AnimationAdapter({ getRenderer: () => renderer })
  const loader = adapter.createAssetLoader()
  const model = await loader.load({
    type: 'animated-model', format: 'gltf', id: 'hero:model', src: animatedGltfDataUri(),
  })
  assert.equal(installed, true)
  assert.ok(moduleInstance)
  const binding = adapter.attachEntity({
    entity: { id: 'hero' },
    primitiveIds: ['hero:model'],
    config: { clips: { bounce: 'Bounce' }, defaultClip: 'bounce', autoplay: true, loop: 'repeat', speed: 1, parameters: {}, markers: [], rootMotion: { mode: 'disabled', source: 'anyo:animation:root-motion', priority: 20 } },
    context: {},
  })
  assert.ok(binding)
  binding.play({ clip: 'bounce', loop: 'repeat', speed: 1 })
  adapter.update(0.5)
  let node
  model.traverse((candidate) => { if (candidate.name === 'AnimatedNode') node = candidate })
  assert.ok(node)
  assert.ok(Math.abs(node.position.y - 1) < 1e-6)
  binding.dispose()
  model.dispose()
  loader.dispose?.()
})


test('extracts root motion without leaving translation on the animated model node', async () => {
  let installed = false
  const engine = {
    modules: { has: () => installed },
    async installModules(modules) {
      for (const module of modules) {
        await module.setup({ renderer: { backend: 'webgl2' }, diagnostics: { report() {} }, registerCleanup() { return () => {} } })
        installed = true
      }
    },
  }
  const renderer = { getNativeAccess() { return { engine, scene: {}, camera: {}, getPrimitiveNode() {}, getRoomNode() {} } } }
  const adapter = new Sekai64AnimationAdapter({ getRenderer: () => renderer })
  const loader = adapter.createAssetLoader()
  const model = await loader.load({ type: 'animated-model', format: 'gltf', id: 'hero:model', src: animatedGltfDataUri() })
  const binding = adapter.attachEntity({
    entity: { id: 'hero' }, primitiveIds: ['hero:model'],
    config: { clips: { bounce: 'Bounce' }, defaultClip: 'bounce', autoplay: true, loop: 'once', speed: 1, parameters: {}, markers: [], rootMotion: { mode: 'extract-only', node: 'AnimatedNode', source: 'anyo:animation:root-motion', priority: 20 } },
    context: {},
  })
  binding.play({ clip: 'bounce', loop: 'once', speed: 1 })
  adapter.update(0.5)
  let node
  model.traverse((candidate) => { if (candidate.name === 'AnimatedNode') node = candidate })
  assert.ok(node)
  assert.ok(Math.abs(node.position.y) < 1e-6)
  const delta = binding.consumeRootMotion()
  assert.ok(Math.abs(delta[1] - 1) < 1e-6)
  binding.dispose(); model.dispose(); loader.dispose?.()
})


test('binds an animated model loaded by another loader when both share the renderer animation module', async () => {
  const module = createAnimationRendererModule()
  let moduleInstallCalls = 0
  let externalModel
  let progressListener
  const engine = {
    modules: { has: (id) => id === module.id },
    async installModules() { moduleInstallCalls += 1 },
  }
  await module.setup({
    renderer: { backend: 'webgl2' },
    diagnostics: { report() {} },
    registerCleanup() { return () => {} },
  })
  const renderer = {
    getNativeAccess() {
      return {
        engine,
        scene: {},
        camera: {},
        getPrimitiveNode(id) { return id === 'hero:model' ? externalModel : undefined },
        getRoomNode() {},
      }
    },
    onAssetProgress(listener) { progressListener = listener; return () => { progressListener = undefined } },
  }

  const adapter = new Sekai64AnimationAdapter({ module })
  let availabilityChanges = 0
  adapter.onAvailabilityChange(() => { availabilityChanges += 1 })
  await adapter.setup({ renderer })
  assert.equal(moduleInstallCalls, 0, 'a renderer-installed shared module must not be installed twice')

  const externalLoader = new GltfLoader()
  externalModel = await externalLoader.loadNode(animatedGltfDataUri(), {
    id: 'hero:model',
    name: 'hero:model',
    animation: createGltfAnimationAdapter(module, { createMixer: true }),
    animatedFallback: 'error',
  })
  progressListener?.({ queued: 0, loading: 0, loaded: 1, failed: 0, total: 1, ratio: 1 })
  assert.equal(availabilityChanges, 1)

  const binding = adapter.attachEntity({
    entity: { id: 'hero' },
    primitiveIds: ['hero:model'],
    config: { clips: { bounce: 'Bounce' }, defaultClip: 'bounce', autoplay: true, loop: 'repeat', speed: 1, parameters: {}, markers: [], rootMotion: { mode: 'disabled', source: 'anyo:animation:root-motion', priority: 20 } },
    context: { renderer },
  })
  assert.ok(binding, 'animation must discover a compatible runtime model outside its own loader')
  binding.play({ clip: 'bounce', loop: 'repeat', speed: 1 })
  adapter.update(0.5)
  let animatedNode
  externalModel.traverse((candidate) => { if (candidate.name === 'AnimatedNode') animatedNode = candidate })
  assert.ok(animatedNode)
  assert.ok(Math.abs(animatedNode.position.y - 1) < 1e-6)

  binding.dispose()
  externalModel.dispose()
  externalLoader.dispose()
  adapter.dispose()
})

test('creates a Player-ready Sekai64 animation composition bundle', () => {
  const integration = createSekai64AnimationIntegration()
  assert.equal(integration.module.id, 'sekai64.animation')
  assert.equal(integration.assetLoader.type, 'animated-model')
  assert.deepEqual(integration.assetLoader.formats, ['gltf', 'glb'])
  assert.equal(integration.plugin.name, 'anyo:animation')
  integration.adapter.dispose()
})
