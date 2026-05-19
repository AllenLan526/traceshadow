import type { VercelRequest, VercelResponse } from '@vercel/node'
import { demoResult } from '../apps/backend/src/analyze'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json(demoResult)
}
