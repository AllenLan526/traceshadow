const API = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

export async function scanUrl(url, onEvt) {
  const res = await fetch(`${API}/api/analyze-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || bad())
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let out = null

  while (true) {
    const cur = await reader.read()
    if (cur.done) break

    buf += decoder.decode(cur.value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      const evt = parseLine(line)
      if (!evt) continue
      if (evt.type === 'error') throw new Error(evt.error || bad())
      if (evt.type === 'result') out = evt.result
      onEvt(evt)
    }
  }

  const last = parseLine(buf)
  if (last) {
    if (last.type === 'error') throw new Error(last.error || bad())
    if (last.type === 'result') out = last.result
    onEvt(last)
  }

  if (!out) throw new Error('The scan ended before TraceShadow received a final result.')
  return out
}

function parseLine(line) {
  const s = line.trim()
  if (!s) return null

  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function bad() {
  return 'TraceShadow could not scan that page.'
}
