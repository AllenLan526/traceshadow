import cytoscape from 'cytoscape'
import {
  Activity,
  AlertTriangle,
  Clock,
  Code2,
  ExternalLink,
  Eye,
  Globe2,
  Network,
  Play,
  RadioTower,
  Search,
  ShieldCheck
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const api = import.meta.env.VITE_API_BASE || 'http://localhost:4000'
const Z = { totalRequests: 0, thirdPartyRequestCount: 0, uniqueThirdPartyDomains: 0 }

export default function App() {
  const [url, setUrl] = useState('https://example.com')
  const [res, setRes] = useState(null)
  const [sel, setSel] = useState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [doms, setDoms] = useState([])
  const [warns, setWarns] = useState([])
  const [stats, setStats] = useState(Z)

  async function run() {
    setBusy(true)
    setError('')
    setRes(null)
    setSel(undefined)
    setMsg('Starting scan...')
    setDoms([])
    setWarns([])
    setStats(Z)

    try {
      const next = await scan(url, onEvt)
      setRes(next)
      setSel((cur) => {
        if (!next.domains.length) return undefined
        for (const dom of next.domains) {
          if (dom.domain === cur?.domain) return dom
        }
        return next.domains[0]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scan failed.')
    } finally {
      setBusy(false)
      setMsg('')
    }
  }

  function onEvt(evt) {
    if (evt.type === 'status') {
      setMsg(evt.message)
      return
    }

    if (evt.type === 'warning') {
      setWarns((cur) => cur.includes(evt.message) ? cur : [...cur, evt.message])
      return
    }

    if (evt.type === 'domain') {
      setStats({
        totalRequests: evt.totalRequests,
        thirdPartyRequestCount: evt.thirdPartyRequestCount,
        uniqueThirdPartyDomains: evt.uniqueThirdPartyDomains
      })

      setDoms((cur) => {
        const mp = new Map()
        for (const dom of cur) mp.set(dom.domain, dom)
        mp.set(evt.domain.domain, evt.domain)
        const out = [...mp.values()]
        out.sort((a, b) => b.requestCount - a.requestCount)
        return out
      })

      setSel((cur) => {
        if (!cur) return evt.domain
        if (cur.domain === evt.domain.domain) return evt.domain
        return cur
      })
    }
  }

  return (
    <main className="min-h-screen px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-md border border-sea/40 bg-sea/10">
                <ShieldCheck className="h-5 w-5 text-sea" />
              </div>
              <span className="text-sm font-semibold uppercase text-sea">BasisHacks 2026 - Beneath the Surface</span>
            </div>
            <h1 className="text-4xl font-semibold text-slate-50 md:text-5xl">TraceShadow</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
              Enter a website and reveal the hidden network resources loading beneath the visible page.
            </p>
          </div>

          <div className="btn-ghost w-fit" aria-label="Open-source ready status">
            <Code2 className="h-4 w-4" />
            Open-source ready
          </div>
        </header>

        <Form url={url} busy={busy} onUrl={setUrl} onScan={run} />

        <div className="mt-5 space-y-5">
          {busy && <Load status={msg} n={doms.length} />}

          {(busy || (!res && doms.length > 0)) && (
            <Live
              domains={doms}
              selected={sel}
              stats={stats}
              warnings={warns}
              onSelect={setSel}
            />
          )}

          {error && (
            <section className="panel border-amber-300/30 bg-amber-300/10 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-200" />
                <div>
                  <h2 className="font-semibold text-amber-100">Scan blocked or failed</h2>
                  <p className="mt-2 text-sm leading-6 text-amber-100/80">{error}</p>
                </div>
              </div>
            </section>
          )}

          {!res && !busy && !error && (
            <section className="panel p-6">
              <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                <div>
                  <h2 className="text-xl font-semibold text-slate-50">What TraceShadow shows</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    Websites often load analytics scripts, ad networks, CDNs, fonts, and social widgets in the background. This tool maps those domains so judges can understand the hidden systems quickly.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Tag s="Analytics" />
                  <Tag s="Ads" />
                  <Tag s="CDNs" />
                  <Tag s="Social widgets" />
                </div>
              </div>
            </section>
          )}

          {res && (
            <>
              <Top result={res} />

              <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <Graph result={res} selected={sel} onSelect={setSel} />
                <Score result={res} />
              </div>

              {res.warnings.length > 0 && (
                <section className="panel p-4">
                  <h2 className="text-sm font-semibold text-slate-100">Warnings</h2>
                  <ul className="mt-2 space-y-1 text-sm text-slate-400">
                    {res.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </section>
              )}

              <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
                <Table domains={res.domains} selected={sel} onSelect={setSel} />
                <Info domain={sel} />
              </div>

              <Debug result={res} />
            </>
          )}
        </div>
      </div>
    </main>
  )
}

async function scan(url, onEvt) {
  const res = await fetch(`${api}/api/analyze-stream`, {
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
    const { value, done } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      const evt = parse(line)
      if (!evt) continue

      if (evt.type === 'error') {
        throw new Error(evt.error || bad())
      }

      if (evt.type === 'result') out = evt.result
      onEvt(evt)
    }
  }

  const last = parse(buf)
  if (last) {
    if (last.type === 'error') throw new Error(last.error || bad())
    if (last.type === 'result') out = last.result
    onEvt(last)
  }

  if (!out) {
    throw new Error('The scan ended before TraceShadow received a final result.')
  }

  return out
}

function parse(line) {
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

function Form({ url, busy, onUrl, onScan }) {
  return (
    <form
      className="panel p-3"
      onSubmit={(e) => {
        e.preventDefault()
        onScan()
      }}
    >
      <div className="flex flex-col gap-3 md:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Website URL</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
          <input
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            placeholder="Enter a website URL, like https://example.com"
            className="h-12 w-full rounded-md border border-line bg-ink/80 pl-10 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sea"
          />
        </label>

        <button className="btn-main h-12" disabled={busy} type="submit">
          <Play className="h-4 w-4" />
          Analyze
        </button>
      </div>
    </form>
  )
}

function Load({ status, n = 0 }) {
  const steps = ['Opening page...', 'Collecting network requests...', 'Classifying hidden domains...', 'Building graph...']
  const [at, setAt] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAt((x) => Math.min(x + 1, steps.length - 1))
    }, 1200)

    return () => window.clearInterval(timer)
  }, [steps.length])

  return (
    <section className="panel p-5">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-md border border-sea/40 bg-sea/10">
          <span className="h-3 w-3 animate-ping rounded-full bg-sea" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100">{status || steps[at]}</p>
          <p className="mt-1 text-sm text-slate-400">
            {n > 0
              ? `TraceShadow has already found ${n} hidden ${n === 1 ? 'domain' : 'domains'} and will keep updating the evidence below.`
              : 'TraceShadow is watching the page load from beneath the visible surface.'}
          </p>
        </div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-sea transition-all duration-500" style={{ width: `${((at + 1) / steps.length) * 100}%` }} />
      </div>
    </section>
  )
}

function Live({ domains, selected, stats, warnings, onSelect }) {
  return (
    <section className="panel overflow-hidden border-sea/30 bg-sea/5">
      <div className="border-b border-line/80 px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sea">
              <Activity className="h-4 w-4" />
              Live scan evidence
            </div>
            <h2 className="text-lg font-semibold text-slate-50">Found beneath the surface so far</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              These results are provisional. Each row is a network clue TraceShadow has already seen, and the final dashboard will tighten the counts once the browser scan closes.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Num label="Requests" value={stats.totalRequests} />
            <Num label="Third-party" value={stats.thirdPartyRequestCount} />
            <Num label="Domains" value={stats.uniqueThirdPartyDomains} />
          </div>
        </div>
      </div>

      {domains.length === 0 ? (
        <div className="grid gap-4 p-5 md:grid-cols-3">
          <Tip icon={<Eye className="h-4 w-4" />} text="The browser is opening the page and waiting for the first outside request." />
          <Tip icon={<Network className="h-4 w-4" />} text="When a hidden domain appears, it will be classified and added here immediately." />
          <Tip icon={<Activity className="h-4 w-4" />} text="The final graph will use the same evidence, but with complete totals." />
        </div>
      ) : (
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_380px]">
          <Table
            domains={domains}
            selected={selected}
            onSelect={onSelect}
            title="Live detected domains"
            subtitle="Updating as requests arrive."
          />
          <Info domain={selected} />
        </div>
      )}

      {warnings.length > 0 && (
        <div className="border-t border-line/80 px-5 py-4">
          <h3 className="text-sm font-semibold text-amber-100">Live warnings</h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-100/80">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

function Num({ label, value }) {
  return (
    <div className="rounded-md border border-line bg-ink/60 px-3 py-2">
      <p className="text-lg font-semibold text-slate-50">{value}</p>
      <p className="mt-1 text-slate-500">{label}</p>
    </div>
  )
}

function Tip({ icon, text }) {
  return (
    <div className="rounded-md border border-line bg-ink/50 p-4 text-sm leading-6 text-slate-400">
      <div className="mb-3 grid h-8 w-8 place-items-center rounded-md border border-sea/30 bg-sea/10 text-sea">{icon}</div>
      {text}
    </div>
  )
}

function Top({ result: res }) {
  const cards = []
  cards.push({ label: 'Total requests', value: res.totalRequests, icon: Network })
  cards.push({ label: 'Third-party requests', value: res.thirdPartyRequestCount, icon: RadioTower })
  cards.push({ label: 'Hidden domains', value: res.uniqueThirdPartyDomains, icon: Globe2 })
  cards.push({ label: 'Scan time', value: `${res.scanTimeMs}ms`, icon: Clock })

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div className="panel p-4" key={card.label}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">{card.label}</span>
              <Icon className="h-4 w-4 text-sea" />
            </div>
            <strong className="mt-3 block text-2xl font-semibold text-slate-50">{card.value}</strong>
          </div>
        )
      })}
    </section>
  )
}

function Graph({ result: res, selected: sel, onSelect }) {
  const ref = useRef(null)
  const cyRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return

    const elements = []
    for (const node of res.graph.nodes) {
      elements.push({
        classes: node.type === 'firstParty' ? 'firstParty' : node.category,
        data: { id: node.id, label: node.label }
      })
    }
    for (const edge of res.graph.edges) {
      const kind = edge.kind || 'direct'
      elements.push({
        classes: kind,
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          kind,
          label: String(edge.requestCount)
        }
      })
    }

    const cy = cytoscape({
      container: ref.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': gc.unknown,
            'border-color': '#d8f7f8',
            'border-opacity': 0.18,
            'border-width': 1,
            color: '#d8f7f8',
            'font-size': 11,
            label: 'data(label)',
            'text-outline-color': '#071016',
            'text-outline-width': 3,
            height: 34,
            width: 34
          }
        },
        { selector: '.firstParty', style: { 'background-color': gc.firstParty, height: 58, width: 58 } },
        { selector: '.analytics', style: { 'background-color': gc.analytics } },
        { selector: '.ads', style: { 'background-color': gc.ads } },
        { selector: '.cdn', style: { 'background-color': gc.cdn } },
        { selector: '.social', style: { 'background-color': gc.social } },
        { selector: '.tagManager', style: { 'background-color': gc.tagManager } },
        { selector: '.unknown', style: { 'background-color': gc.unknown } },
        {
          selector: 'edge',
          style: {
            color: '#8aa7ad',
            'curve-style': 'bezier',
            'font-size': 9,
            label: 'data(label)',
            'line-color': '#2b6a72',
            opacity: 0.75,
            'target-arrow-color': '#2b6a72',
            'target-arrow-shape': 'triangle',
            width: 1.4
          }
        },
        {
          selector: 'edge.direct',
          style: {
            'line-style': 'solid',
            'line-color': '#26d6c5',
            'target-arrow-color': '#26d6c5',
            width: 1.8,
            opacity: 0.85
          }
        },
        {
          selector: 'edge.indirect',
          style: {
            'line-style': 'dashed',
            'line-dash-pattern': [6, 4],
            'line-color': '#c6a0ff',
            'target-arrow-color': '#c6a0ff',
            width: 1.4,
            opacity: 0.85
          }
        },
        { selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 3 } }
      ],
      layout: { name: 'concentric', minNodeSpacing: 58, padding: 42 }
    })

    cyRef.current = cy
    cy.on('tap', 'node', (e) => {
      const id = e.target.id()
      for (const dom of res.domains) {
        if (dom.domain === id) {
          onSelect(dom)
          break
        }
      }
    })

    return () => {
      cyRef.current = null
      cy.destroy()
    }
  }, [res, onSelect])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.nodes().unselect()
    if (sel) cy.getElementById(sel.domain).select()
  }, [sel])

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line/80 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-50">Hidden network map</h2>
        <p className="mt-1 text-sm text-slate-400">Center node is the site. Solid arrows are loaded directly by the page; dashed arrows are loaded by another third-party script, iframe, or HTTP redirect.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-[2px] w-8 rounded-full" style={{ backgroundColor: '#26d6c5' }} />
            Direct (page invoked)
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-0 w-8 rounded-full"
              style={{ borderTop: '2px dashed #c6a0ff' }}
            />
            Indirect (third-party invoked)
          </span>
        </div>
      </div>
      <div ref={ref} className="h-[420px] w-full" />
    </section>
  )
}

function Score({ result: res }) {
  const score = res.score.value

  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-50">Privacy exposure score</h2>
          <p className="mt-1 text-sm text-slate-400">{res.score.label}</p>
        </div>
        <div className="text-right">
          <strong className="text-4xl font-semibold text-sea">{score}</strong>
          <span className="text-sm text-slate-500"> / 100</span>
        </div>
      </div>

      <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-gradient-to-r from-sea via-cyanSoft to-amber-300" style={{ width: `${score}%` }} />
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">{res.score.explanation}</p>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Formula: third-party domains, sensitive categories, total requests, and domain count. This is educational, not a professional audit.
      </p>
    </section>
  )
}

function Table({ domains, selected: sel, onSelect, title, subtitle }) {
  title ??= 'Detected domains'
  subtitle ??= 'Sorted by request count.'

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line/80 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-50">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Domain</th>
              <th className="px-5 py-3 font-semibold">Category</th>
              <th className="px-5 py-3 font-semibold">Requests</th>
              <th className="px-5 py-3 font-semibold">Types</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((domain) => (
              <tr
                key={domain.domain}
                className={`cursor-pointer border-t border-line/60 transition hover:bg-sea/5 ${sel?.domain === domain.domain ? 'bg-sea/10' : ''}`}
                onClick={() => onSelect(domain)}
              >
                <td className="px-5 py-3 font-medium text-slate-100">{domain.domain}</td>
                <td className="px-5 py-3">
                  <span className={`cat-pill ${cc[domain.category]}`}>{cat(domain.category)}</span>
                </td>
                <td className="px-5 py-3 text-slate-300">{domain.requestCount}</td>
                <td className="px-5 py-3 text-slate-400">{domain.resourceTypes.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Info({ domain: dom }) {
  if (!dom) {
    return (
      <section className="panel p-5">
        <h2 className="text-base font-semibold text-slate-50">Domain details</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">Click a graph node or table row to inspect a hidden domain.</p>
      </section>
    )
  }

  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="break-all text-base font-semibold text-slate-50">{dom.domain}</h2>
          <p className="mt-1 text-sm text-slate-400">{cat(dom.category)} - {dom.requestCount} requests</p>
        </div>
        <ExternalLink className="h-4 w-4 flex-none text-sea" />
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">{dom.explanation}</p>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-100">Sample requests</h3>
        <ul className="mt-3 space-y-2">
          {dom.sampleUrls.map((s) => (
            <li key={s} className="break-all rounded-md border border-line bg-ink/60 px-3 py-2 text-xs text-slate-400">
              {s}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Debug({ result: res }) {
  const edges = res.graph?.edges ?? []
  const nodes = res.graph?.nodes ?? []
  const labelById = new Map(nodes.map((n) => [n.id, n.label || n.id]))

  const direct = []
  const indirect = []
  for (const e of edges) {
    if (e.kind === 'indirect') indirect.push(e)
    else direct.push(e)
  }
  direct.sort((a, b) => b.requestCount - a.requestCount)
  indirect.sort((a, b) => b.requestCount - a.requestCount)

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line/80 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-50">Debug: connections</h2>
            <p className="mt-1 text-sm text-slate-400">
              Every edge captured during the scan, classified as direct (page invoked) or indirect (another third party invoked it, including iframes and HTTP redirects).
            </p>
          </div>
          <div className="flex flex-none flex-col items-end gap-1 text-xs text-slate-400">
            <span>
              <span className="font-semibold text-sea">{direct.length}</span> direct
            </span>
            <span>
              <span className="font-semibold" style={{ color: '#c6a0ff' }}>{indirect.length}</span> indirect
            </span>
            <span>
              <span className="font-semibold text-slate-200">{nodes.length}</span> nodes
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-2">
        <DebugList
          title="Direct (solid)"
          accent="#26d6c5"
          edges={direct}
          labelById={labelById}
          empty="No direct edges captured."
        />
        <DebugList
          title="Indirect (dashed)"
          accent="#c6a0ff"
          edges={indirect}
          labelById={labelById}
          empty="No indirect edges captured. The page may not have chained any third-party scripts."
          borderLeft
        />
      </div>
    </section>
  )
}

function DebugList({ title, accent, edges, labelById, empty, borderLeft }) {
  return (
    <div className={`p-5 ${borderLeft ? 'lg:border-l lg:border-line/80' : ''}`}>
      <div className="mb-3 flex items-center gap-2">
        <span
          className="inline-block h-[3px] w-6 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <span className="text-xs text-slate-500">({edges.length})</span>
      </div>

      {edges.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="max-h-[320px] space-y-1 overflow-auto pr-1 font-mono text-xs leading-5 text-slate-300">
          {edges.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded border border-line/40 bg-ink/40 px-2 py-1.5"
            >
              <span className="truncate text-slate-100" title={e.source}>
                {labelById.get(e.source) || e.source}
              </span>
              <span style={{ color: accent }}>→</span>
              <span className="truncate text-slate-100" title={e.target}>
                {labelById.get(e.target) || e.target}
              </span>
              <span className="ml-auto flex-none rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                {e.requestCount} req
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function cat(s) {
  if (s === 'tagManager') return 'Tag Manager'
  if (s === 'cdn') return 'CDN'
  return s[0].toUpperCase() + s.slice(1)
}

function Tag({ s }) {
  return <div className="rounded-md border border-line bg-ink/50 px-4 py-3 text-slate-300">{s}</div>
}

const cc = {
  analytics: 'border-sky-300/40 bg-sky-300/10 text-sky-200',
  ads: 'border-amber-300/40 bg-amber-300/10 text-amber-200',
  cdn: 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200',
  social: 'border-pink-300/40 bg-pink-300/10 text-pink-200',
  tagManager: 'border-violet-300/40 bg-violet-300/10 text-violet-200',
  unknown: 'border-slate-300/30 bg-slate-300/10 text-slate-200'
}

const gc = {
  firstParty: '#26d6c5',
  analytics: '#8ee8ff',
  ads: '#ffb86b',
  cdn: '#7ddf8a',
  social: '#f08bd2',
  tagManager: '#c6a0ff',
  unknown: '#94a3b8'
}
