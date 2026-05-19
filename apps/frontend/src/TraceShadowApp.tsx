import cytoscape from 'cytoscape'
import {
  Activity,
  AlertTriangle,
  Clock,
  Code2,
  Database,
  ExternalLink,
  Eye,
  Globe2,
  Network,
  Play,
  RadioTower,
  Search,
  ShieldCheck
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

type Cat = 'analytics' | 'ads' | 'cdn' | 'social' | 'tagManager' | 'unknown'
type ResType = 'script' | 'image' | 'stylesheet' | 'document' | 'xhr' | 'fetch' | 'font' | 'media' | 'other'
type CatCounts = Record<Cat, number>

interface DomainInfo {
  domain: string
  category: Cat
  requestCount: number
  resourceTypes: ResType[]
  sampleUrls: string[]
  explanation: string
}

interface ScanResult {
  inputUrl: string
  finalUrl: string
  firstPartyDomain: string
  scanTimeMs: number
  totalRequests: number
  thirdPartyRequestCount: number
  uniqueThirdPartyDomains: number
  categories: CatCounts
  score: {
    value: number
    label: string
    explanation: string
  }
  domains: DomainInfo[]
  graph: {
    nodes: {
      id: string
      label: string
      type: 'firstParty' | 'thirdParty'
      category?: Cat
    }[]
    edges: {
      id: string
      source: string
      target: string
      requestCount: number
    }[]
  }
  warnings: string[]
}

type ScanEvent =
  | { type: 'status'; message: string }
  | {
      type: 'domain'
      domain: DomainInfo
      totalRequests: number
      thirdPartyRequestCount: number
      uniqueThirdPartyDomains: number
    }
  | { type: 'warning'; message: string }
  | { type: 'result'; result: ScanResult }
  | { type: 'error'; error: string; code?: string }

const apiBase = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:4000' : '')
const emptyLiveStats = { totalRequests: 0, thirdPartyRequestCount: 0, uniqueThirdPartyDomains: 0 }

export default function TraceShadowApp() {
  const [url, setUrl] = useState('https://example.com')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [selected, setSelected] = useState<DomainInfo | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [liveStatus, setLiveStatus] = useState('')
  const [liveDomains, setLiveDomains] = useState<DomainInfo[]>([])
  const [liveWarnings, setLiveWarnings] = useState<string[]>([])
  const [liveStats, setLiveStats] = useState(emptyLiveStats)

  async function runScan() {
    setBusy(true)
    setError('')
    setResult(null)
    setSelected(undefined)
    setLiveStatus('Starting scan...')
    setLiveDomains([])
    setLiveWarnings([])
    setLiveStats(emptyLiveStats)

    try {
      const next = await analyzeUrl(url, handleScanEvent)
      setResult(next)
      setSelected((current) => {
        if (!next.domains.length) return undefined
        return next.domains.find((item) => item.domain === current?.domain) ?? next.domains[0]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scan failed.')
    } finally {
      setBusy(false)
      setLiveStatus('')
    }
  }

  async function runDemo() {
    setBusy(true)
    setError('')
    setLiveStatus('')
    setLiveDomains([])
    setLiveWarnings([])
    setLiveStats(emptyLiveStats)

    const next = await loadDemoScan()
    setResult(next)
    setSelected(next.domains[0])
    setBusy(false)
  }

  function handleScanEvent(event: ScanEvent) {
    if (event.type === 'status') {
      setLiveStatus(event.message)
      return
    }

    if (event.type === 'warning') {
      setLiveWarnings((current) => current.includes(event.message) ? current : [...current, event.message])
      return
    }

    if (event.type === 'domain') {
      setLiveStats({
        totalRequests: event.totalRequests,
        thirdPartyRequestCount: event.thirdPartyRequestCount,
        uniqueThirdPartyDomains: event.uniqueThirdPartyDomains
      })

      setLiveDomains((current) => {
        const map = new Map(current.map((item) => [item.domain, item]))
        map.set(event.domain.domain, event.domain)
        return [...map.values()].sort((a, b) => b.requestCount - a.requestCount)
      })

      setSelected((current) => {
        if (!current) return event.domain
        if (current.domain === event.domain.domain) return event.domain
        return current
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

        <UrlForm url={url} busy={busy} onUrl={setUrl} onScan={runScan} onDemo={runDemo} />

        <div className="mt-5 space-y-5">
          {busy && <LoadingPanel status={liveStatus} foundCount={liveDomains.length} />}

          {(busy || (!result && liveDomains.length > 0)) && (
            <LiveFindings
              domains={liveDomains}
              selected={selected}
              stats={liveStats}
              warnings={liveWarnings}
              onSelect={setSelected}
            />
          )}

          {error && (
            <section className="panel border-amber-300/30 bg-amber-300/10 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-200" />
                <div>
                  <h2 className="font-semibold text-amber-100">Scan blocked or failed</h2>
                  <p className="mt-2 text-sm leading-6 text-amber-100/80">{error}</p>
                  <button className="btn-main mt-4" onClick={runDemo} type="button">Load Demo Scan</button>
                </div>
              </div>
            </section>
          )}

          {!result && !busy && !error && (
            <section className="panel p-6">
              <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                <div>
                  <h2 className="text-xl font-semibold text-slate-50">What TraceShadow shows</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    Websites often load analytics scripts, ad networks, CDNs, fonts, and social widgets in the background. This tool maps those domains so judges can understand the hidden systems quickly.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {['Analytics', 'Ads', 'CDNs', 'Social widgets'].map((item) => (
                    <div className="rounded-md border border-line bg-ink/50 px-4 py-3 text-slate-300" key={item}>{item}</div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {result && (
            <>
              <SummaryCards result={result} />

              <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <TrackerGraph result={result} selected={selected} onSelect={setSelected} />
                <ExposureScore result={result} />
              </div>

              {result.warnings.length > 0 && (
                <section className="panel p-4">
                  <h2 className="text-sm font-semibold text-slate-100">Warnings</h2>
                  <ul className="mt-2 space-y-1 text-sm text-slate-400">
                    {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </section>
              )}

              <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
                <DomainTable domains={result.domains} selected={selected} onSelect={setSelected} />
                <DomainDetails domain={selected} />
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

async function analyzeUrl(url: string, onEvent: (event: ScanEvent) => void): Promise<ScanResult> {
  const res = await fetch(`${apiBase}/api/analyze-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })

  if (!res.ok || !res.body) return analyzeUrlOnce(url)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: ScanResult | null = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const event = parseScanEvent(line)
      if (!event) continue

      if (event.type === 'error') {
        throw new Error(event.error || 'TraceShadow could not scan that page.')
      }

      if (event.type === 'result') finalResult = event.result
      onEvent(event)
    }
  }

  const last = parseScanEvent(buffer)
  if (last) {
    if (last.type === 'error') throw new Error(last.error || 'TraceShadow could not scan that page.')
    if (last.type === 'result') finalResult = last.result
    onEvent(last)
  }

  if (!finalResult) {
    throw new Error('The scan ended before TraceShadow received a final result.')
  }

  return finalResult
}

async function analyzeUrlOnce(url: string): Promise<ScanResult> {
  const res = await fetch(`${apiBase}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || 'TraceShadow could not scan that page.')
  }

  return data
}

function parseScanEvent(line: string): ScanEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed) as ScanEvent
  } catch {
    return null
  }
}

async function loadDemoScan(): Promise<ScanResult> {
  try {
    const res = await fetch(`${apiBase}/api/demo`)
    if (res.ok) return res.json()
  } catch {
    // The local demo keeps the button useful even when the backend is offline.
  }

  return localDemo
}

function UrlForm(props: {
  url: string
  busy: boolean
  onUrl: (url: string) => void
  onScan: () => void
  onDemo: () => void
}) {
  return (
    <form
      className="panel p-3"
      onSubmit={(event) => {
        event.preventDefault()
        props.onScan()
      }}
    >
      <div className="flex flex-col gap-3 md:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Website URL</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
          <input
            value={props.url}
            onChange={(event) => props.onUrl(event.target.value)}
            placeholder="Enter a website URL, like https://example.com"
            className="h-12 w-full rounded-md border border-line bg-ink/80 pl-10 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sea"
          />
        </label>

        <button className="btn-main h-12" disabled={props.busy} type="submit">
          <Play className="h-4 w-4" />
          Analyze
        </button>

        <button className="btn-ghost h-12" disabled={props.busy} type="button" onClick={props.onDemo}>
          <Database className="h-4 w-4" />
          Load Demo Scan
        </button>
      </div>
    </form>
  )
}

function LoadingPanel({ status, foundCount = 0 }: { status?: string; foundCount?: number }) {
  const steps = ['Opening page...', 'Collecting network requests...', 'Classifying hidden domains...', 'Building graph...']
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, steps.length - 1))
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
          <p className="text-sm font-semibold text-slate-100">{status || steps[step]}</p>
          <p className="mt-1 text-sm text-slate-400">
            {foundCount > 0
              ? `TraceShadow has already found ${foundCount} hidden ${foundCount === 1 ? 'domain' : 'domains'} and will keep updating the evidence below.`
              : 'TraceShadow is watching the page load from beneath the visible surface.'}
          </p>
        </div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-sea transition-all duration-500" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>
    </section>
  )
}

function LiveFindings(props: {
  domains: DomainInfo[]
  selected?: DomainInfo
  stats: typeof emptyLiveStats
  warnings: string[]
  onSelect: (domain: DomainInfo) => void
}) {
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
            <LiveStat label="Requests" value={props.stats.totalRequests} />
            <LiveStat label="Third-party" value={props.stats.thirdPartyRequestCount} />
            <LiveStat label="Domains" value={props.stats.uniqueThirdPartyDomains} />
          </div>
        </div>
      </div>

      {props.domains.length === 0 ? (
        <div className="grid gap-4 p-5 md:grid-cols-3">
          <LiveHint icon={<Eye className="h-4 w-4" />} text="The browser is opening the page and waiting for the first outside request." />
          <LiveHint icon={<Network className="h-4 w-4" />} text="When a hidden domain appears, it will be classified and added here immediately." />
          <LiveHint icon={<Activity className="h-4 w-4" />} text="The final graph will use the same evidence, but with complete totals." />
        </div>
      ) : (
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_380px]">
          <DomainTable
            domains={props.domains}
            selected={props.selected}
            onSelect={props.onSelect}
            title="Live detected domains"
            subtitle="Updating as requests arrive."
          />
          <DomainDetails domain={props.selected} />
        </div>
      )}

      {props.warnings.length > 0 && (
        <div className="border-t border-line/80 px-5 py-4">
          <h3 className="text-sm font-semibold text-amber-100">Live warnings</h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-100/80">
            {props.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

function LiveStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-ink/60 px-3 py-2">
      <p className="text-lg font-semibold text-slate-50">{value}</p>
      <p className="mt-1 text-slate-500">{label}</p>
    </div>
  )
}

function LiveHint({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="rounded-md border border-line bg-ink/50 p-4 text-sm leading-6 text-slate-400">
      <div className="mb-3 grid h-8 w-8 place-items-center rounded-md border border-sea/30 bg-sea/10 text-sea">{icon}</div>
      {text}
    </div>
  )
}

function SummaryCards({ result }: { result: ScanResult }) {
  const cards = [
    { label: 'Total requests', value: result.totalRequests, icon: Network },
    { label: 'Third-party requests', value: result.thirdPartyRequestCount, icon: RadioTower },
    { label: 'Hidden domains', value: result.uniqueThirdPartyDomains, icon: Globe2 },
    { label: 'Scan time', value: `${result.scanTimeMs}ms`, icon: Clock }
  ]

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

function TrackerGraph({ result, selected, onSelect }: { result: ScanResult; selected?: DomainInfo; onSelect: (domain: DomainInfo) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)

  useEffect(() => {
    if (!ref.current) return

    const elements = [
      ...result.graph.nodes.map((node) => ({
        classes: node.type === 'firstParty' ? 'firstParty' : node.category,
        data: { id: node.id, label: node.label }
      })),
      ...result.graph.edges.map((edge) => ({
        data: { id: edge.id, source: edge.source, target: edge.target, label: String(edge.requestCount) }
      }))
    ]

    const cy = cytoscape({
      container: ref.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': graphColors.unknown,
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
        { selector: '.firstParty', style: { 'background-color': graphColors.firstParty, height: 58, width: 58 } },
        { selector: '.analytics', style: { 'background-color': graphColors.analytics } },
        { selector: '.ads', style: { 'background-color': graphColors.ads } },
        { selector: '.cdn', style: { 'background-color': graphColors.cdn } },
        { selector: '.social', style: { 'background-color': graphColors.social } },
        { selector: '.tagManager', style: { 'background-color': graphColors.tagManager } },
        { selector: '.unknown', style: { 'background-color': graphColors.unknown } },
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
        { selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 3 } }
      ],
      layout: { name: 'concentric', minNodeSpacing: 58, padding: 42 }
    })

    cyRef.current = cy
    cy.on('tap', 'node', (event) => {
      const id = event.target.id()
      const domain = result.domains.find((item) => item.domain === id)
      if (domain) onSelect(domain)
    })

    return () => {
      cyRef.current = null
      cy.destroy()
    }
  }, [result, onSelect])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.nodes().unselect()
    if (selected) cy.getElementById(selected.domain).select()
  }, [selected])

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line/80 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-50">Hidden network map</h2>
        <p className="mt-1 text-sm text-slate-400">Center node is the site. Outer nodes are third-party domains loaded by the page.</p>
      </div>
      <div ref={ref} className="h-[420px] w-full" />
    </section>
  )
}

function ExposureScore({ result }: { result: ScanResult }) {
  const score = result.score.value

  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-50">Privacy exposure score</h2>
          <p className="mt-1 text-sm text-slate-400">{result.score.label}</p>
        </div>
        <div className="text-right">
          <strong className="text-4xl font-semibold text-sea">{score}</strong>
          <span className="text-sm text-slate-500"> / 100</span>
        </div>
      </div>

      <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-gradient-to-r from-sea via-cyanSoft to-amber-300" style={{ width: `${score}%` }} />
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">{result.score.explanation}</p>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Formula: third-party domains, sensitive categories, total requests, and domain count. This is educational, not a professional audit.
      </p>
    </section>
  )
}

function DomainTable(props: {
  domains: DomainInfo[]
  selected?: DomainInfo
  onSelect: (domain: DomainInfo) => void
  title?: string
  subtitle?: string
}) {
  const title = props.title ?? 'Detected domains'
  const subtitle = props.subtitle ?? 'Sorted by request count.'

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
            {props.domains.map((domain) => (
              <tr
                key={domain.domain}
                className={`cursor-pointer border-t border-line/60 transition hover:bg-sea/5 ${props.selected?.domain === domain.domain ? 'bg-sea/10' : ''}`}
                onClick={() => props.onSelect(domain)}
              >
                <td className="px-5 py-3 font-medium text-slate-100">{domain.domain}</td>
                <td className="px-5 py-3">
                  <span className={`cat-pill ${catPill[domain.category]}`}>{catName(domain.category)}</span>
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

function DomainDetails({ domain }: { domain?: DomainInfo }) {
  if (!domain) {
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
          <h2 className="break-all text-base font-semibold text-slate-50">{domain.domain}</h2>
          <p className="mt-1 text-sm text-slate-400">{catName(domain.category)} - {domain.requestCount} requests</p>
        </div>
        <ExternalLink className="h-4 w-4 flex-none text-sea" />
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">{domain.explanation}</p>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-100">Sample requests</h3>
        <ul className="mt-3 space-y-2">
          {domain.sampleUrls.map((sampleUrl) => (
            <li key={sampleUrl} className="break-all rounded-md border border-line bg-ink/60 px-3 py-2 text-xs text-slate-400">
              {sampleUrl}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function catName(cat: Cat) {
  if (cat === 'tagManager') return 'Tag Manager'
  if (cat === 'cdn') return 'CDN'
  return cat[0].toUpperCase() + cat.slice(1)
}

const catPill: Record<Cat, string> = {
  analytics: 'border-sky-300/40 bg-sky-300/10 text-sky-200',
  ads: 'border-amber-300/40 bg-amber-300/10 text-amber-200',
  cdn: 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200',
  social: 'border-pink-300/40 bg-pink-300/10 text-pink-200',
  tagManager: 'border-violet-300/40 bg-violet-300/10 text-violet-200',
  unknown: 'border-slate-300/30 bg-slate-300/10 text-slate-200'
}

const graphColors: Record<Cat | 'firstParty', string> = {
  firstParty: '#26d6c5',
  analytics: '#8ee8ff',
  ads: '#ffb86b',
  cdn: '#7ddf8a',
  social: '#f08bd2',
  tagManager: '#c6a0ff',
  unknown: '#94a3b8'
}

const localDemo: ScanResult = {
  inputUrl: 'https://news-example.test',
  finalUrl: 'https://news-example.test/',
  firstPartyDomain: 'news-example.test',
  scanTimeMs: 1380,
  totalRequests: 43,
  thirdPartyRequestCount: 35,
  uniqueThirdPartyDomains: 5,
  categories: {
    analytics: 1,
    ads: 1,
    cdn: 2,
    social: 1,
    tagManager: 0,
    unknown: 0
  },
  score: {
    value: 63,
    label: 'High exposure',
    explanation: 'This page loads 5 third-party domains, analytics tools, advertising domains, and social widgets. This score is an educational approximation, not a professional privacy audit.'
  },
  domains: [
    {
      domain: 'cdn.newsexample.test',
      category: 'cdn',
      requestCount: 14,
      resourceTypes: ['script', 'stylesheet', 'image'],
      sampleUrls: ['https://cdn.newsexample.test/app-shell.js', 'https://cdn.newsexample.test/styles/home.css'],
      explanation: 'CDNs serve shared files such as scripts, images, fonts, and styles from external infrastructure.'
    },
    {
      domain: 'analytics.examplemetrics.test',
      category: 'analytics',
      requestCount: 6,
      resourceTypes: ['script', 'xhr'],
      sampleUrls: ['https://analytics.examplemetrics.test/track.js', 'https://analytics.examplemetrics.test/collect?page=front'],
      explanation: 'Analytics services measure visits, page views, clicks, and other user behavior.'
    },
    {
      domain: 'ads.adnetwork.test',
      category: 'ads',
      requestCount: 8,
      resourceTypes: ['script', 'image', 'xhr'],
      sampleUrls: ['https://ads.adnetwork.test/bid.js', 'https://ads.adnetwork.test/pixel.gif'],
      explanation: 'Advertising domains can load ad slots, bidding scripts, targeting pixels, or conversion trackers.'
    },
    {
      domain: 'social.sharewidget.test',
      category: 'social',
      requestCount: 4,
      resourceTypes: ['script', 'image'],
      sampleUrls: ['https://social.sharewidget.test/widget.js', 'https://social.sharewidget.test/icons/x.svg'],
      explanation: 'Social widgets can load share buttons, embeds, login tools, or tracking pixels from social platforms.'
    },
    {
      domain: 'fonts.fastcdn.test',
      category: 'cdn',
      requestCount: 3,
      resourceTypes: ['font', 'stylesheet'],
      sampleUrls: ['https://fonts.fastcdn.test/inter.css', 'https://fonts.fastcdn.test/inter-var.woff2'],
      explanation: 'CDNs serve shared files such as scripts, images, fonts, and styles from external infrastructure.'
    }
  ],
  graph: {
    nodes: [
      { id: 'news-example.test', label: 'news-example.test', type: 'firstParty' },
      { id: 'cdn.newsexample.test', label: 'News CDN', type: 'thirdParty', category: 'cdn' },
      { id: 'analytics.examplemetrics.test', label: 'Example Metrics', type: 'thirdParty', category: 'analytics' },
      { id: 'ads.adnetwork.test', label: 'Ad Network', type: 'thirdParty', category: 'ads' },
      { id: 'social.sharewidget.test', label: 'Share Widget', type: 'thirdParty', category: 'social' },
      { id: 'fonts.fastcdn.test', label: 'Fast Fonts', type: 'thirdParty', category: 'cdn' }
    ],
    edges: [
      { id: 'news-example.test-cdn.newsexample.test', source: 'news-example.test', target: 'cdn.newsexample.test', requestCount: 14 },
      { id: 'news-example.test-analytics.examplemetrics.test', source: 'news-example.test', target: 'analytics.examplemetrics.test', requestCount: 6 },
      { id: 'news-example.test-ads.adnetwork.test', source: 'news-example.test', target: 'ads.adnetwork.test', requestCount: 8 },
      { id: 'news-example.test-social.sharewidget.test', source: 'news-example.test', target: 'social.sharewidget.test', requestCount: 4 },
      { id: 'news-example.test-fonts.fastcdn.test', source: 'news-example.test', target: 'fonts.fastcdn.test', requestCount: 3 }
    ]
  },
  warnings: ['Demo scan uses fictional domains for a reliable presentation workflow.']
}
