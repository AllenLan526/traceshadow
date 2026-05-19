import type { VercelRequest, VercelResponse } from '@vercel/node'
import { analyzeUrl, type AppErr } from '../apps/backend/src/analyze'

export const config = {
  maxDuration: 60
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST /api/analyze.' })
    return
  }

  const url = typeof req.body?.url === 'string' ? req.body.url : ''

  try {
    const result = await analyzeUrl(url)
    res.status(200).json(result)
  } catch (err) {
    const appErr = err as AppErr
    res.status(appErr.status ?? 500).json({
      error: appErr.message || 'The page could not be scanned.',
      code: appErr.code ?? 'scan_failed',
      demoAvailable: true
    })
  }
}
