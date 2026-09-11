import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = fileURLToPath(new URL('../dist/esm/', import.meta.url))
const rootFiles = await collect(rootDirectory, false)
const sekaiFiles = await collect(rootDirectory, true)
const rootSize = gzipSync(Buffer.concat(await Promise.all(rootFiles.map((file) => readFile(file))))).byteLength
const sekaiSize = gzipSync(Buffer.concat(await Promise.all(sekaiFiles.map((file) => readFile(file))))).byteLength
assert.ok(rootSize <= 16 * 1024, `Root gzip budget exceeded: ${rootSize}`)
assert.ok(sekaiSize <= 28 * 1024, `Sekai64 entry gzip budget exceeded: ${sekaiSize}`)
console.log(`PASS root ${format(rootSize)} gzip · budget 16.0 kB`)
console.log(`PASS sekai64 ${format(sekaiSize)} gzip · budget 28.0 kB`)

async function collect(directory, includeSekai) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if ((entry.name === 'sekai64') !== includeSekai) continue
      files.push(...await collect(full, includeSekai))
    } else if (entry.name.endsWith('.js')) {
      const normalized = full.replaceAll('\\', '/')
      if (includeSekai ? normalized.includes('/sekai64/') : !normalized.includes('/sekai64/')) files.push(full)
    }
  }
  return files
}
function format(bytes) { return `${(bytes / 1024).toFixed(1)} kB` }
