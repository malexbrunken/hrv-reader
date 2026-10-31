import { mkdir } from 'node:fs/promises'
import * as esbuild from 'esbuild'

await mkdir(new URL('../api/', import.meta.url), { recursive: true })

await esbuild.build({
  entryPoints: ['src/server/sessionsFunction.ts'],
  outfile: 'api/sessions.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // The installed package resolves at runtime. Everything else is inlined so
  // Node ESM never has to follow an extensionless relative import.
  external: ['@vercel/blob'],
})
