import { readFile, writeFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await writeFile(
  new URL('../src/version.ts', import.meta.url),
  `/** Generated from package.json. Do not edit manually. */\nexport const ANYO_ANIMATION_VERSION = ${JSON.stringify(packageJson.version)} as const\n`,
)
console.log(`Generated ANYO_ANIMATION_VERSION ${packageJson.version}.`)
