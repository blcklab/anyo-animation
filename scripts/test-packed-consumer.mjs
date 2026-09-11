import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const sourcePackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const destination = await mkdtemp(path.join(tmpdir(), 'anyo-animation-consumer-'))
const packages = path.join(destination, 'packages')
const consumer = path.join(destination, 'consumer')
await mkdir(packages, { recursive: true })
await mkdir(consumer, { recursive: true })

try {
  const animationTarball = pack(root, packages)
  const anyoTarball = pack(path.join(root, 'node_modules', '@blcklab', 'anyo'), packages)
  const sekaiTarball = pack(path.join(root, 'node_modules', '@blcklab', 'sekai64'), packages)
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'anyo-animation-packed-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@blcklab/anyo-animation': localSpec(consumer, animationTarball),
      '@blcklab/anyo': localSpec(consumer, anyoTarball),
      '@blcklab/sekai64': localSpec(consumer, sekaiTarball),
    },
  }, null, 2))
  runNpm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], consumer)
  await writeFile(path.join(consumer, 'consumer.mjs'), `
    import { ANYO_ANIMATION_VERSION, createAnimationPlugin } from '@blcklab/anyo-animation'
    import { createSekai64AnimationRuntime } from '@blcklab/anyo-animation/sekai64'
    import { validateAnimationComponentData } from '@blcklab/anyo-animation/authoring'
    if (ANYO_ANIMATION_VERSION !== ${JSON.stringify(sourcePackage.version)}) throw new Error('version mismatch')
    if (typeof createAnimationPlugin !== 'function') throw new Error('missing root export')
    if (typeof createSekai64AnimationRuntime !== 'function') throw new Error('missing sekai64 export')
    if (typeof validateAnimationComponentData !== 'function') throw new Error('missing authoring export')
  `)
  const runtime = spawnSync(process.execPath, ['consumer.mjs'], { cwd: consumer, stdio: 'inherit' })
  assert.equal(runtime.status, 0)
  await writeFile(path.join(consumer, 'consumer.cjs'), `
    const pkg = require('@blcklab/anyo-animation')
    const authoring = require('@blcklab/anyo-animation/authoring')
    if (pkg.ANYO_ANIMATION_VERSION !== ${JSON.stringify(sourcePackage.version)}) throw new Error('cjs version mismatch')
    if (typeof pkg.createAnimationPlugin !== 'function') throw new Error('missing cjs root export')
    if (typeof authoring.createAnimationComponentDefinition !== 'function') throw new Error('missing cjs authoring export')
  `)
  const cjs = spawnSync(process.execPath, ['consumer.cjs'], { cwd: consumer, stdio: 'inherit' })
  assert.equal(cjs.status, 0)
  await writeFile(path.join(consumer, 'consumer.ts'), `
    import type { AnimationEntitySnapshot } from '@blcklab/anyo-animation'
    import { createAnimationPlugin } from '@blcklab/anyo-animation'
    import { createSekai64AnimationRuntime } from '@blcklab/anyo-animation/sekai64'
    import { createAnimationComponentDefinition } from '@blcklab/anyo-animation/authoring'
    void createAnimationPlugin
    void createSekai64AnimationRuntime
    void createAnimationComponentDefinition
    const snapshot: AnimationEntitySnapshot | null = null
    void snapshot
  `)
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: false,
    },
    include: ['consumer.ts'],
  }, null, 2))
  const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
  const types = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--pretty', 'false'], { cwd: consumer, stdio: 'inherit' })
  assert.equal(types.status, 0)
  const installed = JSON.parse(await readFile(path.join(consumer, 'node_modules/@blcklab/anyo-animation/package.json'), 'utf8'))
  assert.equal(installed.dependencies, undefined)
  console.log('Verified packed ESM, CJS, strict TypeScript, and zero-dependency consumers.')
} finally {
  await rm(destination, { recursive: true, force: true })
}

function pack(cwd, target) {
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const args = npmCli
    ? [npmCli, 'pack', '--json', '--pack-destination', target]
    : ['pack', '--json', '--pack-destination', target]
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const entry = JSON.parse(result.stdout)[0]
  return path.join(target, entry.filename)
}

function runNpm(args, cwd) {
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const finalArgs = npmCli ? [npmCli, ...args] : args
  const result = spawnSync(command, finalArgs, { cwd, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed.`)
}

function localSpec(from, target) {
  return `file:${path.relative(from, target).replaceAll('\\', '/')}`
}
