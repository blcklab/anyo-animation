import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(pkg.version, '0.1.1')
assert.equal(pkg.version.includes('-'), false, 'Stable version must not contain a prerelease identifier.')
assert.ok(pkg.exports['./sekai64'])
assert.ok(pkg.exports['./authoring'])
const root = await import(new URL('../dist/esm/index.js', import.meta.url))
const authoring = await import(new URL('../dist/esm/authoring/index.js', import.meta.url))
for (const name of [
  'AnimationParameterStore', 'selectAnimationTransition', 'createAnimationPlugin',
  'parseAnimationComponent', 'ANYO_ANIMATION_SNAPSHOT_VERSION',
]) assert.equal(typeof root[name] === 'function' || root[name] !== undefined, true, `Missing stable root export: ${name}`)
for (const name of ['createAnimationComponentDefinition', 'validateAnimationComponentData', 'listAnimationClipReferences']) {
  assert.equal(typeof authoring[name], 'function', `Missing authoring export: ${name}`)
}
console.log(`Verified stable @blcklab/anyo-animation@${pkg.version} contracts.`)
