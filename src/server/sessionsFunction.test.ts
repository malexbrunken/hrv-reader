import { spawnSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { describe, expect, it } from 'vitest'

describe('bundled sessions function', () => {
  it('loads under Node ESM and answers 401 or 503 without crashing', async () => {
    const outfile = join(process.cwd(), 'api', 'sessions.mjs')
    await mkdir(join(process.cwd(), 'api'), { recursive: true })
    await esbuild.build({
      entryPoints: ['src/server/sessionsFunction.ts'],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      external: ['@vercel/blob'],
    })
    const source = await readFile(outfile, 'utf8')
    expect(source).not.toMatch(/from\s+['"]\.\.?\/[^'"]+['"]/)

    const script = `
      const handler = (await import(${JSON.stringify(pathToFileURL(outfile).href)})).default
      const call = (headers) => new Promise((resolve) => {
        const res = { statusCode: 0, setHeader() {}, end() { resolve(res.statusCode) } }
        handler({ method: 'GET', headers }, res)
      })
      delete process.env.BLOB_READ_WRITE_TOKEN
      delete process.env.HRV_PASSPHRASE
      const missing = await call({ 'x-hrv-passphrase': 'secret' })
      process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
      process.env.HRV_PASSPHRASE = 'secret'
      const wrong = await call({ 'x-hrv-passphrase': 'nope' })
      const absent = await call({})
      process.stdout.write(JSON.stringify({ missing, wrong, absent }))
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ missing: 503, wrong: 401, absent: 401 })
  })
})
