import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = fileURLToPath(new URL('../dist/esm/', import.meta.url))
const files = await walk(rootDirectory)
const rootFiles = files.filter((file) => !file.includes('/sekai64/'))
const rootText = (await Promise.all(rootFiles.map((file) => readFile(file, 'utf8')))).join('\n')
assert.equal(rootText.includes('@blcklab/sekai64'), false, 'Renderer-neutral root must not import Sekai64.')
assert.equal(rootText.includes('Sekai64Renderer'), false, 'Renderer-neutral root must not include Sekai64 adapter code.')
const sekaiText = (await Promise.all(files.filter((file) => file.includes('/sekai64/')).map((file) => readFile(file, 'utf8')))).join('\n')
assert.equal(sekaiText.includes('@blcklab/sekai64/animation'), true, 'Sekai64 subpath must explicitly import animation.')
console.log('Anyo Animation package boundaries verified.')

async function walk(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const value = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await walk(value))
    else if (entry.name.endsWith('.js')) output.push(value.replaceAll('\\', '/'))
  }
  return output
}
