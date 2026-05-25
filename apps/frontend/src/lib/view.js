export const ZERO = {
  totalRequests: 0,
  thirdPartyRequestCount: 0,
  uniqueThirdPartyDomains: 0
}

export const LOAD_STEPS = [
  'Opening page...',
  'Collecting network requests...',
  'Summarizing hidden domains...',
  'Building graph...'
]

export const INTRO_TAGS = ['Scripts', 'Fonts', 'Images', 'APIs']

export const GC = {
  firstParty: '#26d6c5',
  thirdParty: '#94a3b8'
}

export function putLiveDom(cur, next) {
  const mp = new Map()
  for (const dom of cur) mp.set(dom.domain, dom)
  mp.set(next.domain, next)
  const out = [...mp.values()]
  out.sort((a, b) => b.requestCount - a.requestCount)
  return out
}

export function pickLiveSel(cur, next) {
  if (!cur) return next
  if (cur.domain === next.domain) return next
  return cur
}

export function pickDoneSel(cur, doms) {
  if (!doms.length) return undefined
  if (!cur) return doms[0]
  for (const dom of doms) {
    if (dom.domain === cur.domain) return dom
  }
  return doms[0]
}

export function mkGraphEls(graph) {
  const out = []

  for (const node of graph.nodes) {
    out.push({
      classes: node.type === 'firstParty' ? 'firstParty' : 'thirdParty',
      data: { id: node.id, label: node.label }
    })
  }

  for (const edge of graph.edges) {
    const kind = edge.kind || 'direct'
    out.push({
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

  return out
}

export function findDom(doms, id) {
  for (const dom of doms) {
    if (dom.domain === id) return dom
  }
  return null
}
