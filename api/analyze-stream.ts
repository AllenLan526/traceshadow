import type { VercelRequest, VercelResponse } from '@vercel/node'
import { streamAnalyzeUrl, type AppErr, type ScanEvent } from '../apps/backend/src/analyze'

export const config = {
  maxDuration: 60
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST /api/analyze-stream.' })
    return
  }

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')

  const send = (event: ScanEvent) => {
    res.write(`${JSON.stringify(event)}\n`)
  }

  const url = typeof req.body?.url === 'string' ? req.body.url : ''

  try {
    await streamAnalyzeUrl(url, send)
  } catch (err) {
    const appErr = err as AppErr
    send({
      type: 'error',
      error: appErr.message || 'The page could not be scanned.',
      code: appErr.code ?? 'scan_failed'
    })
  } finally {
    res.end()
  }
}
