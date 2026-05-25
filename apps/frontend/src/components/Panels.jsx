import {
  Activity,
  Clock,
  ExternalLink,
  Eye,
  Globe2,
  Network,
  Play,
  RadioTower,
  Search
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { INTRO_TAGS, LOAD_STEPS } from '../lib/view.js'

export function Form({ url, isBusy, onUrl, onScan }) {
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

        <button className="btn-main h-12" disabled={isBusy} type="submit">
          <Play className="h-4 w-4" />
          Analyze
        </button>
      </div>
    </form>
  )
}

export function Load({ status, n = 0 }) {
  const [at, setAt] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setAt((x) => Math.min(x + 1, LOAD_STEPS.length - 1))
    }, 1200)
    return () => window.clearInterval(id)
  }, [])

  const text = n > 0
    ? `TraceShadow has already found ${n} hidden ${n === 1 ? 'domain' : 'domains'} and will keep updating the evidence below.`
    : 'TraceShadow is watching the page load from beneath the visible surface.'

  return (
    <section className="panel p-5">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-md border border-sea/40 bg-sea/10">
          <span className="h-3 w-3 animate-ping rounded-full bg-sea" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100">{status || LOAD_STEPS[at]}</p>
          <p className="mt-1 text-sm text-slate-400">{text}</p>
        </div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-sea transition-all duration-500" style={{ width: `${((at + 1) / LOAD_STEPS.length) * 100}%` }} />
      </div>
    </section>
  )
}

export function Live({ domains, selected, stats, onSelect }) {
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
          <Tip icon={<Network className="h-4 w-4" />} text="When a hidden domain appears, it will be added here immediately." />
          <Tip icon={<Activity className="h-4 w-4" />} text="The final graph will use the same evidence, but with complete totals." />
        </div>
      ) : (
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_380px]">
          <Table
            domains={domains}
            sel={selected}
            onSelect={onSelect}
            title="Live detected domains"
            subtitle="Updating as requests arrive."
          />
          <Info dom={selected} />
        </div>
      )}
    </section>
  )
}

export function Intro() {
  return (
    <section className="panel p-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-50">What TraceShadow shows</h2>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Websites often load scripts, fonts, images, APIs, and other outside resources in the background. This tool maps those domains so judges can understand the hidden systems quickly.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {INTRO_TAGS.map((s) => <Tag key={s} s={s} />)}
        </div>
      </div>
    </section>
  )
}

export function Top({ res }) {
  const cards = [
    { label: 'Total requests', value: res.totalRequests, icon: Network },
    { label: 'Third-party requests', value: res.thirdPartyRequestCount, icon: RadioTower },
    { label: 'Hidden domains', value: res.uniqueThirdPartyDomains, icon: Globe2 },
    { label: 'Scan time', value: `${res.scanTimeMs}ms`, icon: Clock }
  ]

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((x) => {
        const Icon = x.icon
        return (
          <div className="panel p-4" key={x.label}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">{x.label}</span>
              <Icon className="h-4 w-4 text-sea" />
            </div>
            <strong className="mt-3 block text-2xl font-semibold text-slate-50">{x.value}</strong>
          </div>
        )
      })}
    </section>
  )
}

export function Score({ res }) {
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
    </section>
  )
}

export function Table({ domains, sel, onSelect, title = 'Detected domains', subtitle = 'Sorted by request count.' }) {
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
              <th className="px-5 py-3 font-semibold">Requests</th>
              <th className="px-5 py-3 font-semibold">Types</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((dom) => (
              <tr
                key={dom.domain}
                className={`cursor-pointer border-t border-line/60 transition hover:bg-sea/5 ${sel?.domain === dom.domain ? 'bg-sea/10' : ''}`}
                onClick={() => onSelect(dom)}
              >
                <td className="px-5 py-3 font-medium text-slate-100">{dom.domain}</td>
                <td className="px-5 py-3 text-slate-300">{dom.requestCount}</td>
                <td className="px-5 py-3 text-slate-400">{dom.resourceTypes.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function Info({ dom }) {
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
          <p className="mt-1 text-sm text-slate-400">{dom.requestCount} requests</p>
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

function Tag({ s }) {
  return <div className="rounded-md border border-line bg-ink/50 px-4 py-3 text-slate-300">{s}</div>
}
