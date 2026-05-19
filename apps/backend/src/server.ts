import cors from 'cors'
import express from 'express'
import { analyzeUrl, demoResult, streamAnalyzeUrl, type AppErr, type ScanEvent } from './analyze.js'

const app = express()
const port = Number(process.env.PORT ?? 4000)
const origins = process.env.CORS_ORIGIN?.split(',').map((item) => item.trim()).filter(Boolean)

app.use(cors({ origin: origins?.length ? origins : true }))
app.use(express.json({ limit: '20kb' }))

app.get('/', (_req, res) => {
  res.type('text').send('TraceShadow API is running. Try /api/health, /api/demo, or POST /api/analyze.')
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'TraceShadow' })
})

app.get('/api/demo', (_req, res) => {
  res.json(demoResult)
})

app.post('/api/analyze', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url : ''

  try {
    const result = await analyzeUrl(url)
    res.json(result)
  } catch (err) {
    const appErr = err as AppErr
    res.status(appErr.status ?? 500).json({
      error: appErr.message || 'The page could not be scanned.',
      code: appErr.code ?? 'scan_failed',
      demoAvailable: true
    })
  }
})

app.post('/api/analyze-stream', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url : ''

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event: ScanEvent) => {
    res.write(`${JSON.stringify(event)}\n`)
  }

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
})

const server = app.listen(port, () => {
  console.log(`TraceShadow API listening on http://localhost:${port}`)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the old TraceShadow backend or set PORT to another value.`)
    process.exit(1)
  }

  throw err
})
