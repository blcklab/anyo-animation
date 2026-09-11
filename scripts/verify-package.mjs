import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const publicModule = await import(new URL('../dist/esm/index.js', import.meta.url))
assert.equal(publicModule.ANYO_ANIMATION_VERSION, pkg.version)
assert.equal(pkg.sideEffects, false)
assert.equal(pkg.dependencies, undefined)
assert.ok(pkg.exports['./sekai64'])
assert.ok(pkg.exports['./authoring'])
const destination = await mkdtemp(path.join(tmpdir(), 'anyo-animation-pack-'))
try {
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const args = npmCli
    ? [npmCli, 'pack', '--json', '--pack-destination', destination]
    : ['pack', '--json', '--pack-destination', destination]
  const result = spawnSync(command, args, { cwd: packageRoot, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const packed = JSON.parse(result.stdout)[0]
  assert.equal(packed.id, `${pkg.name}@${pkg.version}`)
  assert.ok(packed.files.some((file) => file.path === 'dist/esm/index.js'))
  assert.ok(packed.files.some((file) => file.path === 'dist/esm/sekai64/index.js'))
  assert.ok(packed.files.some((file) => file.path === 'dist/esm/authoring/index.js'))
  assert.ok(packed.files.some((file) => file.path === 'dist/cjs/authoring/index.js'))
  assert.equal(packed.files.some((file) => file.path === 'dist/cjs/sekai64/index.js'), false)
  assert.equal(packed.files.some((file) => file.path.startsWith('tests/')), false)
  console.log(`Verified packed ${packed.id}.`)
} finally {
  await rm(destination, { recursive: true, force: true })
}
