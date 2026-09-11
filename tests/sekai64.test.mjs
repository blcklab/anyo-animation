import test from 'node:test'
import assert from 'node:assert/strict'
import { Sekai64AnimationAdapter } from '../dist/esm/sekai64/index.js'

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
