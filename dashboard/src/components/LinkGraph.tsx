// Six problem domains on a hexagon. Edge width = |Spearman ρ| between the two village-level scores.
// Solid = 資料支持 (|ρ| ≥ 0.2 across 456 里); dashed = 機制推論 (the mechanism is plausible but the
// village-level correlation is weak). Identity is carried by code + label, never color alone.
import { useState, type ReactNode } from 'react'
import { DOMAINS, domain } from '../lib/domains'
import { fmtNum } from '../lib/format'
import type { LinkEdge, Links } from '../lib/types'
import { DOMAIN_ICONS } from './Icons'

export const SUPPORT_RHO = 0.2
export const isSupported = (e: LinkEdge) => Math.abs(e.rho) >= SUPPORT_RHO
export const edgeKey = (e: { a: number; b: number }) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`
export const fmtRho = (r: number) => {
  const s = fmtNum(Math.abs(r), 2).replace(/^0/, '')
  // no "−.00": a value that rounds to zero carries no sign
  return r < 0 && s !== '.00' ? `−${s}` : s
}

export function EdgeTip({ e, hot }: { e: LinkEdge; hot: number }) {
  const A = domain(e.a)
  const B = domain(e.b)
  return (
    <>
      <div className="tip-title">
        {A.code} {A.short} × {B.code} {B.short}
      </div>
      <div className="tip-row"><span className="k">依據</span><span className="v">{isSupported(e) ? '資料支持' : '機制推論'}</span></div>
      <div className="tip-row"><span className="k">里分數 Spearman ρ</span><span className="v">{fmtRho(e.rho)}</span></div>
      <div className="tip-row"><span className="k">熱點重疊 Jaccard</span><span className="v">{fmtNum(e.jaccard, 2)}</span></div>
      <div className="tip-row"><span className="k">共同熱點（≥ {hot}）</span><span className="v">{e.co_hot} 里</span></div>
      <div className="tip-mech">{e.mechanism}</div>
    </>
  )
}

/** stroke width of a link line: thicker = stronger village-level correlation */
const edgeWidth = (rho: number) => 1.2 + 8 * Math.abs(rho)

type Pt = [number, number]
type Anchor = 'start' | 'end' | 'middle'
interface Box { x0: number; y0: number; x1: number; y1: number }
const boxGap = (a: Box, b: Box) => Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.y0 - b.y1, 0, b.y0 - a.y1))
const ptBox = ([x, y]: Pt, b: Box) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1))
const ptSeg = ([x, y]: Pt, [ax, ay]: Pt, [bx, by]: Pt) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(x - ax - t * dx, y - ay - t * dy)
}
/** Liang–Barsky: does the segment a→b pass through the box? */
const segHitsBox = ([ax, ay]: Pt, [bx, by]: Pt, b: Box) => {
  const p = [ax - bx, bx - ax, ay - by, by - ay]
  const q = [ax - b.x0, b.x1 - ax, ay - b.y0, b.y1 - ay]
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false
      continue
    }
    const r = q[i] / p[i]
    if (p[i] < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return false
  }
  return true
}
const segBox = (a: Pt, b: Pt, box: Box) => {
  if (segHitsBox(a, b, box)) return 0
  const corners: Pt[] = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]]
  return Math.min(ptBox(a, box), ptBox(b, box), ...corners.map((c) => ptSeg(c, a, b)))
}

/**
 * ρ labels. Each labelled line tries spots from its middle toward either end, outside the hexagon first, and keeps
 * the first one that stays clear of the other lines, the nodes, the node captions and the labels placed before it
 * (strongest |ρ| is placed first); if none is clear it takes the roomiest spot.
 */
function placeRhoLabels({ lines, nodes, center: [cx, cy], width, height }: {
  lines: { key: string; a: Pt; b: Pt; w: number; rho: number; label: boolean }[]
  nodes: Pt[]
  center: Pt
  width: number
  height: number
}) {
  const out = new Map<string, { x: number; y: number; anchor: Anchor }>()
  // caption blocks (code + name, hot count) beside each node, matching the node loop in LinkGraph
  const captions: Box[] = nodes.map(([x, y], k) => {
    if (k === 0) return { x0: x - 34, x1: x + 34, y0: y - 47, y1: y - 21 }
    if (k === 3) return { x0: x - 34, x1: x + 34, y0: y + 23, y1: y + 49 }
    return x > cx ? { x0: x + 21, x1: x + 86, y0: y - 13, y1: y + 14 } : { x0: x - 86, x1: x - 21, y0: y - 13, y1: y + 14 }
  })
  const placed: Box[] = []
  const spots = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]
  for (const l of lines.filter((x) => x.label).sort((p, q) => Math.abs(q.rho) - Math.abs(p.rho))) {
    const [ax, ay] = l.a
    const [bx, by] = l.b
    const len = Math.hypot(bx - ax, by - ay) || 1
    let nx = -(by - ay) / len
    let ny = (bx - ax) / len
    if (((ax + bx) / 2 - cx) * nx + ((ay + by) / 2 - cy) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    const tw = 6.2 * (fmtRho(l.rho).length + 2)
    let best: { x: number; y: number; anchor: Anchor; box: Box; score: number } | null = null
    search: for (const t of spots) {
      for (const side of [1, -1]) {
        const ux = nx * side
        const uy = ny * side
        const anchor: Anchor = ux > 0.3 ? 'start' : ux < -0.3 ? 'end' : 'middle'
        const off = 7 + l.w / 2 + (anchor === 'middle' ? 4 : 0)
        const px = ax + (bx - ax) * t + ux * off
        const py = ay + (by - ay) * t + uy * off
        const x0 = anchor === 'start' ? px : anchor === 'end' ? px - tw : px - tw / 2
        const box = { x0, x1: x0 + tw, y0: py - 5, y1: py + 5 }
        const score = Math.min(
          box.x0, width - box.x1, box.y0, height - box.y1,
          ...lines.filter((o) => o.key !== l.key).map((o) => segBox(o.a, o.b, box) - o.w / 2),
          ...nodes.map((n) => ptBox(n, box) - 21),
          ...captions.map((c) => boxGap(c, box)),
          ...placed.map((p) => boxGap(p, box)),
        )
        if (!best || score > best.score) best = { x: px, y: py + 3.5, anchor, box, score }
        if (score >= 4) break search
      }
    }
    if (best) {
      out.set(l.key, { x: best.x, y: best.y, anchor: best.anchor })
      placed.push(best.box)
    }
  }
  return out
}

export function LinkGraph({ links, width = 288, height = 242, selected, onSelect, onNode, activeNode, ghost }: {
  links: Links
  width?: number
  height?: number
  selected?: string | null
  onSelect?: (e: LinkEdge | null) => void
  onNode?: (id: number) => void
  activeNode?: number | null
  /** a selected pair that has no mechanism edge: drawn as a thin dotted line so the selection stays visible */
  ghost?: { a: number; b: number; rho: number } | null
}) {
  const [hoverEdge, setHoverEdge] = useState<{ e: LinkEdge; x: number; y: number } | null>(null)
  const [hoverNode, setHoverNode] = useState<number | null>(null)
  // room for labels: 46px above the top node, 48px below the bottom node, ~75px beside the side nodes
  const R = Math.min((width / 2 - 82) / 0.866, (height - 94) / 2)
  const cx = width / 2
  const cy = 46 + R
  const pos = (id: number): [number, number] => {
    const a = ((-90 + 60 * (id - 1)) * Math.PI) / 180
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)]
  }
  const focus = hoverNode ?? activeNode ?? null
  const edges = [...links.edges].sort((a, b) => Math.abs(a.rho) - Math.abs(b.rho))
  const showGhost = ghost && !links.edges.some((e) => edgeKey(e) === edgeKey(ghost)) ? ghost : null
  const labels = placeRhoLabels({
    lines: [
      ...links.edges.map((e) => ({ key: edgeKey(e), a: pos(e.a), b: pos(e.b), w: edgeWidth(e.rho), rho: e.rho, label: isSupported(e) })),
      ...(showGhost ? [{ key: edgeKey(showGhost), a: pos(showGhost.a), b: pos(showGhost.b), w: 1.5, rho: showGhost.rho, label: true }] : []),
    ],
    nodes: DOMAINS.map((d) => pos(d.id)),
    center: [cx, cy],
    width,
    height,
  })
  let ghostLine: ReactNode = null
  if (showGhost) {
    const [x1, y1] = pos(showGhost.a)
    const [x2, y2] = pos(showGhost.b)
    const lb = labels.get(edgeKey(showGhost))
    ghostLine = (
      <g className="lg-ghost">
        <path d={`M${x1},${y1} L${x2},${y2}`} />
        {lb && <text x={lb.x} y={lb.y} className="lg-rho num" textAnchor={lb.anchor}>ρ {fmtRho(showGhost.rho)}</text>}
      </g>
    )
  }
  return (
    <div className="lg" style={{ width, height }}>
      <svg width={width} height={height} className="lg-svg" role="img" aria-label="六題關聯圖">
        <defs>
          <radialGradient id="lg-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8abbff" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#8abbff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={R + 18} fill="url(#lg-core)" />
        <polygon
          points={DOMAINS.map((d) => pos(d.id).join(',')).join(' ')}
          fill="none" stroke="var(--line-1)" strokeDasharray="1 4" />
        {edges.map((e) => {
          const [x1, y1] = pos(e.a)
          const [x2, y2] = pos(e.b)
          const k = edgeKey(e)
          const on = selected === k || hoverEdge?.e === e
          const dim = focus != null && e.a !== focus && e.b !== focus
          const sup = isSupported(e)
          const w = edgeWidth(e.rho)
          const path = `M${x1},${y1} L${x2},${y2}`
          const lb = labels.get(k)
          return (
            <g key={k} className={`lg-edge${on ? ' on' : ''}${dim ? ' dim' : ''}`}>
              <path d={path} className="lg-line" strokeWidth={w} strokeDasharray={sup ? undefined : '4 4'} />
              {sup && (
                <circle r={2.2} className="lg-pulse">
                  <animateMotion dur={`${2.6 - Math.abs(e.rho) * 1.6}s`} repeatCount="indefinite" path={path} />
                </circle>
              )}
              {sup && lb && (
                <text x={lb.x} y={lb.y} className="lg-rho num" textAnchor={lb.anchor}>
                  ρ {fmtRho(e.rho)}
                </text>
              )}
              {/* fat invisible hit target */}
              <path d={path} className="lg-hit"
                onMouseMove={(ev) => {
                  const r = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setHoverEdge({ e, x: ev.clientX - r.left, y: ev.clientY - r.top })
                }}
                onMouseLeave={() => setHoverEdge(null)}
                onClick={() => onSelect?.(selected === k ? null : e)} />
            </g>
          )
        })}
        {ghostLine}
        {DOMAINS.map((d) => {
          const [x, y] = pos(d.id)
          const Icon = DOMAIN_ICONS[d.id - 1]
          const out = d.id === 1 ? 'up' : d.id === 4 ? 'down' : x > cx ? 'right' : 'left'
          const lx = out === 'right' ? x + 23 : out === 'left' ? x - 23 : x
          const ly = out === 'up' ? y - 36 : out === 'down' ? y + 34 : y - 2
          const anchor = out === 'right' ? 'start' : out === 'left' ? 'end' : 'middle'
          const dim = focus != null && focus !== d.id && !links.edges.some((e) => (e.a === focus && e.b === d.id) || (e.b === focus && e.a === d.id))
          return (
            <g key={d.id} className={`lg-node${focus === d.id ? ' on' : ''}${dim ? ' dim' : ''}`} style={{ ['--c' as string]: d.color }}
              onMouseEnter={() => setHoverNode(d.id)} onMouseLeave={() => setHoverNode(null)}
              onClick={() => onNode?.(d.id)} role="button" aria-label={`${d.code} ${d.short}`}>
              <circle cx={x} cy={y} r={20} className="lg-halo" />
              <circle cx={x} cy={y} r={15} className="lg-dot" />
              <Icon x={x - 8} y={y - 8} size={16} className="lg-icon" />
              <text x={lx} y={ly} textAnchor={anchor} className="lg-label">
                <tspan className="num lg-code">{d.code}</tspan> {d.short}
              </text>
              <text x={lx} y={ly + 12} textAnchor={anchor} className="lg-sub num">
                熱點 {links.hot_counts[String(d.id)] ?? 0}
              </text>
            </g>
          )
        })}
      </svg>
      {hoverEdge && (
        <div className="tip" style={{ left: Math.min(hoverEdge.x + 12, width - 220), top: hoverEdge.y + 14, width: 230 }}>
          <EdgeTip e={hoverEdge.e} hot={links.hot_threshold} />
        </div>
      )}
    </div>
  )
}

export function LinkLegend() {
  return (
    <div className="lg-legend">
      <span><svg width="20" height="6" aria-hidden="true"><line x1="0" x2="20" y1="3" y2="3" stroke="var(--ink-2)" strokeWidth="2.5" /></svg>資料支持（|ρ| ≥ {SUPPORT_RHO}）</span>
      <span><svg width="20" height="6" aria-hidden="true"><line x1="0" x2="20" y1="3" y2="3" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>機制推論</span>
      <span>線寬 = |ρ|</span>
    </div>
  )
}
