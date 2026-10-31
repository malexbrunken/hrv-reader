import { get, put } from '@vercel/blob'
import { CLOUD_BLOB_PATH, handleSessionsRequest, type BlobStore } from '../src/cloud/sessionsApi'

interface NodeRequest extends AsyncIterable<Uint8Array | string> {
  method?: string
  headers: Record<string, string | string[] | undefined>
}

interface NodeResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

const store: BlobStore = {
  async read() {
    const result = await get(CLOUD_BLOB_PATH, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      useCache: false,
    })
    if (result == null || result.statusCode !== 200 || result.stream == null) return null
    return new Response(result.stream).text()
  },
  async write(body) {
    await put(CLOUD_BLOB_PATH, body, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
  },
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  const chunks: Uint8Array[] = []
  if (req.method === 'PUT') {
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
    }
  }
  const body = chunks.length > 0 ? new TextDecoder().decode(concatBytes(chunks)) : null
  const result = await handleSessionsRequest({
    method: req.method,
    headers: req.headers,
    body,
    expectedPassphrase: process.env.HRV_PASSPHRASE,
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    store,
  })
  res.statusCode = result.status
  res.setHeader('content-type', result.status === 200 ? 'application/json; charset=utf-8' : 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(result.body)
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}
