import { createHash, timingSafeEqual } from 'node:crypto'
import { PASSPHRASE_HEADER } from './header'

export { PASSPHRASE_HEADER }

/**
 * Compare two passphrases without leaking which byte differed.
 * Both sides are hashed first so the comparison is always the same length.
 */
export function passphrasesMatch(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided, 'utf8').digest()
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(providedHash, expectedHash)
}

export type AuthResult = 'ok' | 'unconfigured' | 'unauthorized'

export function authorizePassphrase(provided: string | null, expected: string | undefined): AuthResult {
  if (expected == null || expected.trim() === '') return 'unconfigured'
  if (provided == null) return 'unauthorized'
  return passphrasesMatch(provided, expected) ? 'ok' : 'unauthorized'
}

export function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw ?? null
}
