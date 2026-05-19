import { lookup } from 'node:dns/promises'
import net from 'node:net'
import serverlessChromium from '@sparticuz/chromium'
import type { Browser, Request } from 'playwright-core'
import { getDomain } from 'tldts'

export type Cat = 'analytics' | 'ads' | 'cdn' | 'social' | 'tagManager' | 'unknown'

export type ResType =
  | 'script'
  | 'image'
  | 'stylesheet'
  | 'document'
  | 'xhr'
  | 'fetch'
  | 'font'
  | 'media'
  | 'other'

export type CatCounts = Record<Cat, number>

export interface ReqInfo {
  url: string
  domain: string
  resourceType: ResType
  thirdParty: boolean
}

export interface DomainInfo {
  domain: string
  category: Cat
  requestCount: number
  resourceTypes: ResType[]
  sampleUrls: string[]
  explanation: string
}

export interface ScoreInfo {
  value: number
  label: string
  explanation: string
}

export interface GraphNode {
  id: string
  label: string
  type: 'firstParty' | 'thirdParty'
  category?: Cat
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  requestCount: number
}

export interface ScanResult {
  inputUrl: string
  finalUrl: string
  firstPartyDomain: string
  scanTimeMs: number
  totalRequests: number
  thirdPartyRequestCount: number
  uniqueThirdPartyDomains: number
  categories: CatCounts
  score: ScoreInfo
  domains: DomainInfo[]
  graph: {
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
  warnings: string[]
}

export type ScanEvent =
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

export type AppErr = Error & { status?: number; code?: string }

const defaultTimeout = Number(process.env.SCAN_TIMEOUT_MS ?? 15000)
const sampleLimit = 5
type SendEvent = (event: ScanEvent) => void

export async function analyzeUrl(inputUrl: string): Promise<ScanResult> {
  return runScan(inputUrl)
}

export async function streamAnalyzeUrl(inputUrl: string, send: SendEvent): Promise<ScanResult> {
  return runScan(inputUrl, send)
}

export const demoResult = makeDemoResult()

async function runScan(inputUrl: string, send?: SendEvent): Promise<ScanResult> {
  const start = Date.now()
  send?.({ type: 'status', message: 'Validating URL...' })
  const targetUrl = await normalizeUrl(inputUrl)
  const reqs: ReqInfo[] = []
  const warnings: string[] = []
  const liveDomains = new Map<string, DomainInfo>()
  const startingDomain = siteDomain(targetUrl)
  let liveThirdPartyCount = 0

  send?.({ type: 'status', message: 'Opening page...' })
  const browser = await launchBrowser()

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'TraceShadow/0.1 educational scanner'
    })

    await context.route('**/*', async (route) => {
      const url = route.request().url()
      if (!isHttpUrl(url)) return route.abort()

      try {
        const host = new URL(url).hostname
        if (isBlockedHost(host)) return route.abort()
      } catch {
        return route.abort()
      }

      return route.continue()
    })

    const page = await context.newPage()
    page.setDefaultTimeout(defaultTimeout)

    send?.({ type: 'status', message: 'Collecting network requests...' })
    page.on('request', (req) => {
      const info = readReq(req)
      if (!info) return

      reqs.push(info)

      if (siteDomain(info.url) !== startingDomain) {
        liveThirdPartyCount += 1
        const domain = upsertDomain(liveDomains, info)
        send?.({
          type: 'domain',
          domain,
          totalRequests: reqs.length,
          thirdPartyRequestCount: liveThirdPartyCount,
          uniqueThirdPartyDomains: liveDomains.size
        })
      }
    })

    let res = null
    let timedOut = false

    try {
      res = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: defaultTimeout
      })
    } catch (err) {
      if (!isTimeoutErr(err) || reqs.length === 0) throw err

      timedOut = true
      addWarning(warnings, 'The page did not finish loading during the scan window, so TraceShadow is showing a partial scan from the requests it captured.', send)
    }

    if (!res && !timedOut) {
      addWarning(warnings, 'The page opened, but Playwright did not receive a normal document response.', send)
    }

    await page.waitForLoadState('networkidle', { timeout: timedOut ? 1000 : 3500 }).catch(() => {
      addWarning(warnings, 'Some requests were still loading after the scan window closed.', send)
    })

    send?.({ type: 'status', message: 'Classifying hidden domains...' })
    const finalUrl = page.url()
    const result = buildResult(inputUrl, finalUrl, reqs, warnings, Date.now() - start)
    send?.({ type: 'status', message: 'Building graph...' })
    send?.({ type: 'result', result })
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'The page could not be scanned.'
    throw new Error(`Scan failed: ${msg}. Some sites block automated browsers; try demo mode if needed.`)
  } finally {
    await browser.close()
  }
}

function readReq(req: Request): ReqInfo | null {
  const url = req.url()
  if (!isHttpUrl(url)) return null

  let domain = ''
  try {
    domain = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }

  return {
    url,
    domain,
    resourceType: mapResource(req.resourceType()),
    thirdParty: false
  }
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const { chromium } = await import('playwright-core')

    return chromium.launch({
      args: serverlessChromium.args,
      executablePath: await serverlessChromium.executablePath(),
      headless: true
    })
  }

  const { chromium } = await import('playwright')
  return chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
}

export function makeErr(message: string, status = 400, code = 'bad_request'): AppErr {
  const err = new Error(message) as AppErr
  err.status = status
  err.code = code
  return err
}

async function normalizeUrl(input: string) {
  const raw = input.trim()
  if (!raw) throw makeErr('Enter a URL to scan.')
  if (raw.startsWith('file:')) throw makeErr('file:// URLs are not allowed.')

  const withProto = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`
  let parsed: URL

  try {
    parsed = new URL(withProto)
  } catch {
    throw makeErr('That does not look like a valid URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw makeErr('Only http:// and https:// URLs are allowed.')
  }

  if (parsed.username || parsed.password) {
    throw makeErr('URLs with usernames or passwords are not allowed.')
  }

  assertHostAllowed(parsed.hostname)

  if (net.isIP(cleanHost(parsed.hostname)) === 0) {
    await assertDnsAllowed(parsed.hostname)
  }

  parsed.hash = ''
  return parsed.toString()
}

function assertHostAllowed(hostname: string) {
  const host = cleanHost(hostname)

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw makeErr('Localhost URLs are blocked for safety.')
  }

  if (net.isIP(host) && isPrivateIp(host)) {
    throw makeErr('Private network addresses are blocked for safety.')
  }
}

async function assertDnsAllowed(hostname: string) {
  let addresses: { address: string }[]

  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    throw makeErr('Could not resolve that host.')
  }

  for (const item of addresses) {
    if (isPrivateIp(item.address)) {
      throw makeErr('This host resolves to a private network address, so it was blocked.')
    }
  }
}

function isBlockedHost(hostname: string) {
  try {
    assertHostAllowed(hostname)
    return false
  } catch {
    return true
  }
}

function cleanHost(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

function isPrivateIp(ip: string) {
  const host = cleanHost(ip)

  if (net.isIPv4(host)) {
    const parts = host.split('.').map(Number)
    const [a, b] = parts

    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    return false
  }

  if (net.isIPv6(host)) {
    if (host === '::1') return true
    if (host.startsWith('fc') || host.startsWith('fd')) return true
    if (host.startsWith('fe80:')) return true
  }

  return false
}

function upsertDomain(map: Map<string, DomainInfo>, req: ReqInfo) {
  const current = map.get(req.domain)
  if (current) {
    current.requestCount += 1
    if (!current.resourceTypes.includes(req.resourceType)) current.resourceTypes.push(req.resourceType)
    if (current.sampleUrls.length < sampleLimit && !current.sampleUrls.includes(req.url)) {
      current.sampleUrls.push(req.url)
    }
    return current
  }

  const category = classifyDomain(req.domain)
  const next: DomainInfo = {
    domain: req.domain,
    category,
    requestCount: 1,
    resourceTypes: [req.resourceType],
    sampleUrls: [req.url],
    explanation: explainCat(category)
  }

  map.set(req.domain, next)
  return next
}

const rules: Record<Exclude<Cat, 'unknown'>, string[]> = {
  tagManager: ['googletagmanager.com', 'tagmanager'],
  analytics: [
    'google-analytics.com',
    'plausible.io',
    'segment.com',
    'amplitude.com',
    'mixpanel.com',
    'hotjar.com',
    'examplemetrics.test'
  ],
  ads: [
    'doubleclick.net',
    'googlesyndication.com',
    'adservice.google.com',
    'adsystem.com',
    'taboola.com',
    'outbrain.com',
    'adnetwork.test'
  ],
  cdn: [
    'cloudflare.com',
    'cloudfront.net',
    'akamai',
    'jsdelivr.net',
    'unpkg.com',
    'cdnjs.cloudflare.com',
    'fastcdn.test',
    'cdn.newsexample.test'
  ],
  social: [
    'facebook.net',
    'facebook.com',
    'instagram.com',
    'twitter.com',
    'x.com',
    'tiktok.com',
    'linkedin.com',
    'sharewidget.test'
  ]
}

function classifyDomain(domain: string): Cat {
  const name = domain.toLowerCase()

  for (const cat of Object.keys(rules) as Exclude<Cat, 'unknown'>[]) {
    for (const rule of rules[cat]) {
      if (name.includes(rule)) return cat
    }
  }

  return 'unknown'
}

function explainCat(cat: Cat) {
  if (cat === 'analytics') {
    return 'Analytics services measure visits, page views, clicks, and other user behavior.'
  }

  if (cat === 'ads') {
    return 'Advertising domains can load ad slots, bidding scripts, targeting pixels, or conversion trackers.'
  }

  if (cat === 'cdn') {
    return 'CDNs serve shared files such as scripts, images, fonts, and styles from external infrastructure.'
  }

  if (cat === 'social') {
    return 'Social widgets can load share buttons, embeds, login tools, or tracking pixels from social platforms.'
  }

  if (cat === 'tagManager') {
    return 'Tag managers can load and control other marketing, analytics, and tracking scripts from one place.'
  }

  return 'This third-party domain did not match the simple local rules, so TraceShadow marks it as unknown.'
}

function shortLabel(domain: string) {
  const known: Record<string, string> = {
    'www.google-analytics.com': 'Google Analytics',
    'google-analytics.com': 'Google Analytics',
    'www.googletagmanager.com': 'Google Tag Manager',
    'googletagmanager.com': 'Google Tag Manager',
    'connect.facebook.net': 'Facebook',
    'cdn.newsexample.test': 'News CDN',
    'analytics.examplemetrics.test': 'Example Metrics',
    'ads.adnetwork.test': 'Ad Network',
    'social.sharewidget.test': 'Share Widget',
    'fonts.fastcdn.test': 'Fast Fonts'
  }

  return known[domain] ?? domain.replace(/^www\./, '')
}

function buildResult(inputUrl: string, finalUrl: string, allReqs: ReqInfo[], warnings: string[], scanTimeMs: number): ScanResult {
  const firstPartyDomain = siteDomain(finalUrl)
  const reqs = allReqs.map((req) => ({
    ...req,
    thirdParty: siteDomain(req.url) !== firstPartyDomain
  }))
  const thirdParty = reqs.filter((req) => req.thirdParty)
  const domains = groupDomains(thirdParty)
  const categories = countCats(domains)
  const score = calcScore({
    totalRequests: reqs.length,
    uniqueThirdPartyDomains: domains.length,
    categories
  })

  if (domains.length === 0) {
    warnings.push('No third-party domains were detected during this scan window.')
  }

  const nodes = [
    {
      id: firstPartyDomain,
      label: firstPartyDomain,
      type: 'firstParty' as const
    },
    ...domains.map((item) => ({
      id: item.domain,
      label: shortLabel(item.domain),
      type: 'thirdParty' as const,
      category: item.category
    }))
  ]

  const edges = domains.map((item) => ({
    id: `${firstPartyDomain}-${item.domain}`,
    source: firstPartyDomain,
    target: item.domain,
    requestCount: item.requestCount
  }))

  return {
    inputUrl,
    finalUrl,
    firstPartyDomain,
    scanTimeMs,
    totalRequests: reqs.length,
    thirdPartyRequestCount: thirdParty.length,
    uniqueThirdPartyDomains: domains.length,
    categories,
    score,
    domains,
    graph: { nodes, edges },
    warnings
  }
}

function groupDomains(reqs: ReqInfo[]) {
  const map = new Map<string, DomainInfo>()

  for (const req of reqs) {
    upsertDomain(map, req)
  }

  return [...map.values()].sort((a, b) => b.requestCount - a.requestCount)
}

function countCats(domains: DomainInfo[]): CatCounts {
  const counts: CatCounts = {
    analytics: 0,
    ads: 0,
    cdn: 0,
    social: 0,
    tagManager: 0,
    unknown: 0
  }

  for (const item of domains) {
    counts[item.category] += 1
  }

  return counts
}

interface ScoreInput {
  totalRequests: number
  uniqueThirdPartyDomains: number
  categories: CatCounts
}

function calcScore(input: ScoreInput): ScoreInfo {
  let value = 0

  value += Math.min(input.uniqueThirdPartyDomains * 5, 40)
  if (input.categories.analytics > 0) value += 8
  if (input.categories.ads > 0) value += 12
  if (input.categories.social > 0) value += 8
  if (input.categories.tagManager > 0) value += 5
  if (input.totalRequests > 30) value += 10
  if (input.uniqueThirdPartyDomains > 10) value += 10

  value = Math.min(value, 100)

  let label = 'Low exposure'
  if (value > 75) label = 'Very high exposure'
  else if (value > 50) label = 'High exposure'
  else if (value > 25) label = 'Moderate exposure'

  const parts: string[] = []
  if (input.uniqueThirdPartyDomains > 0) parts.push(`${input.uniqueThirdPartyDomains} third-party domains`)
  if (input.categories.analytics > 0) parts.push('analytics tools')
  if (input.categories.ads > 0) parts.push('advertising domains')
  if (input.categories.social > 0) parts.push('social widgets')
  if (input.categories.tagManager > 0) parts.push('tag managers')

  let explanation = 'This page has limited third-party activity in this scan.'
  if (parts.length > 0) {
    explanation = `This page loads ${parts.join(', ')}. This score is an educational approximation, not a professional privacy audit.`
  }

  return { value, label, explanation }
}

function siteDomain(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return getDomain(host) ?? host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function mapResource(type: string): ResType {
  if (type === 'script') return 'script'
  if (type === 'image') return 'image'
  if (type === 'stylesheet') return 'stylesheet'
  if (type === 'document') return 'document'
  if (type === 'xhr') return 'xhr'
  if (type === 'fetch') return 'fetch'
  if (type === 'font') return 'font'
  if (type === 'media') return 'media'
  return 'other'
}

function isHttpUrl(url: string) {
  return url.startsWith('http://') || url.startsWith('https://')
}

function isTimeoutErr(err: unknown) {
  return err instanceof Error && err.message.toLowerCase().includes('timeout')
}

function addWarning(warnings: string[], message: string, send?: SendEvent) {
  warnings.push(message)
  send?.({ type: 'warning', message })
}

function makeDemoResult(): ScanResult {
  const firstPartyDomain = 'news-example.test'
  const domains: DomainInfo[] = [
    demoDomain('cdn.newsexample.test', 'cdn', 14, ['script', 'stylesheet', 'image'], [
      'https://cdn.newsexample.test/app-shell.js',
      'https://cdn.newsexample.test/styles/home.css',
      'https://cdn.newsexample.test/images/hero.webp'
    ]),
    demoDomain('analytics.examplemetrics.test', 'analytics', 6, ['script', 'xhr'], [
      'https://analytics.examplemetrics.test/track.js',
      'https://analytics.examplemetrics.test/collect?page=front'
    ]),
    demoDomain('ads.adnetwork.test', 'ads', 8, ['script', 'image', 'xhr'], [
      'https://ads.adnetwork.test/bid.js',
      'https://ads.adnetwork.test/pixel.gif'
    ]),
    demoDomain('social.sharewidget.test', 'social', 4, ['script', 'image'], [
      'https://social.sharewidget.test/widget.js',
      'https://social.sharewidget.test/icons/x.svg'
    ]),
    demoDomain('fonts.fastcdn.test', 'cdn', 3, ['font', 'stylesheet'], [
      'https://fonts.fastcdn.test/inter.css',
      'https://fonts.fastcdn.test/inter-var.woff2'
    ])
  ]

  const categories: CatCounts = {
    analytics: 1,
    ads: 1,
    cdn: 2,
    social: 1,
    tagManager: 0,
    unknown: 0
  }

  return {
    inputUrl: 'https://news-example.test',
    finalUrl: 'https://news-example.test/',
    firstPartyDomain,
    scanTimeMs: 1380,
    totalRequests: 43,
    thirdPartyRequestCount: 35,
    uniqueThirdPartyDomains: domains.length,
    categories,
    score: calcScore({
      totalRequests: 43,
      uniqueThirdPartyDomains: domains.length,
      categories
    }),
    domains,
    graph: {
      nodes: [
        { id: firstPartyDomain, label: firstPartyDomain, type: 'firstParty' },
        ...domains.map((domain) => ({
          id: domain.domain,
          label: shortLabel(domain.domain),
          type: 'thirdParty' as const,
          category: domain.category
        }))
      ],
      edges: domains.map((domain) => ({
        id: `${firstPartyDomain}-${domain.domain}`,
        source: firstPartyDomain,
        target: domain.domain,
        requestCount: domain.requestCount
      }))
    },
    warnings: ['Demo scan uses fictional domains for a reliable presentation workflow.']
  }
}

function demoDomain(domain: string, category: Cat, requestCount: number, resourceTypes: ResType[], sampleUrls: string[]): DomainInfo {
  return {
    domain,
    category,
    requestCount,
    resourceTypes,
    sampleUrls,
    explanation: explainCat(category)
  }
}
