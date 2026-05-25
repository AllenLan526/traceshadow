import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

import GraphBox from './components/GraphBox.jsx'
import {
  Form,
  Info,
  Intro,
  Live,
  Load,
  Score,
  Table,
  Top
} from './components/Panels.jsx'
import { scanUrl } from './lib/scan.js'
import { pickDoneSel, pickLiveSel, putLiveDom, ZERO } from './lib/view.js'

export default function App() {
  const [url, setUrl] = useState('https://example.com')
  const [res, setRes] = useState(null)
  const [sel, setSel] = useState()
  const [isBusy, setIsBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [doms, setDoms] = useState([])
  const [stats, setStats] = useState(ZERO)

  const hasRes = !!res
  const showLive = isBusy || (!hasRes && doms.length > 0)

  async function run() {
    setIsBusy(true)
    setErr('')
    setRes(null)
    setSel(undefined)
    setMsg('Starting scan...')
    setDoms([])
    setStats(ZERO)

    try {
      const out = await scanUrl(url, onEvt)
      setRes(out)
      setSel((cur) => pickDoneSel(cur, out.domains))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The scan failed.')
    } finally {
      setIsBusy(false)
      setMsg('')
    }
  }

  function onEvt(evt) {
    if (evt.type === 'status') {
      setMsg(evt.message)
      return
    }

    if (evt.type !== 'domain') return

    setStats({
      totalRequests: evt.totalRequests,
      thirdPartyRequestCount: evt.thirdPartyRequestCount,
      uniqueThirdPartyDomains: evt.uniqueThirdPartyDomains
    })

    setDoms((cur) => putLiveDom(cur, evt.domain))
    setSel((cur) => pickLiveSel(cur, evt.domain))
  }

  return (
    <main className="min-h-screen px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <h1 className="text-4xl font-semibold text-slate-50 md:text-5xl">TraceShadow</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Enter a website and reveal the hidden network resources loading beneath the visible page.
          </p>
        </header>

        <Form url={url} isBusy={isBusy} onUrl={setUrl} onScan={run} />

        <div className="mt-5 space-y-5">
          {isBusy && <Load status={msg} n={doms.length} />}

          {showLive && (
            <Live
              domains={doms}
              selected={sel}
              stats={stats}
              onSelect={setSel}
            />
          )}

          {err && (
            <section className="panel border-amber-300/30 bg-amber-300/10 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-200" />
                <div>
                  <h2 className="font-semibold text-amber-100">Scan blocked or failed</h2>
                  <p className="mt-2 text-sm leading-6 text-amber-100/80">{err}</p>
                </div>
              </div>
            </section>
          )}

          {!hasRes && !isBusy && !err && <Intro />}

          {hasRes && (
            <>
              <Top res={res} />

              <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <GraphBox res={res} sel={sel} onSelect={setSel} />
                <Score res={res} />
              </div>

              <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
                <Table domains={res.domains} sel={sel} onSelect={setSel} />
                <Info dom={sel} />
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
