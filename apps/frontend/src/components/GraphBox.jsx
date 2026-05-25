import cytoscape from 'cytoscape'
import { useEffect, useRef } from 'react'

import { findDom, GC, mkGraphEls } from '../lib/view.js'

const style = [
  {
    selector: 'node',
    style: {
      'background-color': GC.thirdParty,
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
  { selector: '.firstParty', style: { 'background-color': GC.firstParty, height: 58, width: 58 } },
  { selector: '.thirdParty', style: { 'background-color': GC.thirdParty } },
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
]

export default function GraphBox({ res, sel, onSelect }) {
  const boxRef = useRef(null)
  const cyRef = useRef(null)

  useEffect(() => {
    if (!boxRef.current) return

    const cy = cytoscape({
      container: boxRef.current,
      elements: mkGraphEls(res.graph),
      style,
      layout: { name: 'concentric', minNodeSpacing: 58, padding: 42 }
    })

    cyRef.current = cy
    cy.on('tap', 'node', (e) => {
      const dom = findDom(res.domains, e.target.id())
      if (dom) onSelect(dom)
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
        <p className="mt-1 text-sm text-slate-400">
          Center node is the site. Lines show the connections between the page and the outside domains found during the scan.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-[2px] w-8 rounded-full" style={{ backgroundColor: '#26d6c5' }} />
            Network link
          </span>
        </div>
      </div>
      <div ref={boxRef} className="h-[420px] w-full" />
    </section>
  )
}
