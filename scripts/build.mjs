import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const run = (config) => {
  const result = spawnSync(process.execPath, [tsc, '-p', config, '--pretty', 'false'], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await import('./clean.mjs')
await import('./generate-version.mjs')
run('tsconfig.esm.json')
run('tsconfig.cjs.json')
run('tsconfig.types.json')
await mkdir(new URL('../dist/cjs', import.meta.url), { recursive: true })
await writeFile(new URL('../dist/cjs/package.json', import.meta.url), '{"type":"commonjs"}\n')
