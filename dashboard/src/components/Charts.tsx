// Small SVG charts. Thin marks, recessive axes, hover tooltip on every plot.
import { extent, bisector } from 'd3-array'
import { scaleLinear } from 'd3-scale'
import { area as d3area, line as d3line } from 'd3-shape'
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

/** element width that follows layout changes */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/* ---------------- sparkline ---------------- */
export function Sparkline({ values, times, color = 'var(--ink-2)', width = 120, height = 26, fmt, fmtT, domain }: {
  values: (number | null)[]
  times?: (number | string)[]
  color?: string
  width?: number
  height?: number
  fmt?: (v: number) => string
  fmtT?: (t: number | string) => string
  domain?: [number, number]
}) {
  const [hover, setHover] = useState<number | null>(null)
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null && Number.isFinite(p[1]))
  if (pts.length < 2) return <svg width={width} height={height} className="spark" aria-hidden="true"><line x1="0" x2={width} y1={height - 2} y2={height - 2} stroke="var(--line-2)" strokeDasharray="2 3" /></svg>
  const [y0, y1] = domain ?? (extent(pts, (p) => p[1]) as [number, number])
  const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.05 || 1
  const x = scaleLinear().domain([0, values.length - 1]).range([1, width - 3])
  const y = scaleLinear().domain([y0 - pad, y1 + pad]).range([height - 2, 2])
  const path = d3line<readonly [number, number]>().x((p) => x(p[0])).y((p) => y(p[1]))(pts) ?? ''
  const fill = d3area<readonly [number, number]>().x((p) => x(p[0])).y0(height).y1((p) => y(p[1]))(pts) ?? ''
  const last = pts[pts.length - 1]
  const h = hover != null ? pts.reduce((a, p) => (Math.abs(p[0] - hover) < Math.abs(a[0] - hover) ? p : a), pts[0]) : null
  return (
    <span className="spark-wrap" style={{ width }}>
      <svg width={width} height={height} className="spark" role="img" aria-label="趨勢"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(x.invert(e.clientX - r.left))
        }}
        onMouseLeave={() => setHover(null)}>
        <path d={fill} fill={color} opacity={0.1} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
        <circle cx={x(last[0])} cy={y(last[1])} r={2.4} fill={color} stroke="var(--bg-1)" strokeWidth={1.2} />
        {h && <line x1={x(h[0])} x2={x(h[0])} y1={0} y2={height} stroke="var(--ink-3)" strokeWidth={1} />}
        {h && <circle cx={x(h[0])} cy={y(h[1])} r={2.6} fill="var(--ink-1)" />}
      </svg>
      {h && (
        <span className="spark-tip num">
          {times && fmtT ? `${fmtT(times[h[0]])}  ` : ''}
          {fmt ? fmt(h[1]) : h[1]}
        </span>
      )}
    </span>
  )
}

/* ---------------- line chart ---------------- */
export interface Series {
  id: string
  label: string
  color: string
  values: (number | null)[]
  dashed?: boolean
  area?: boolean
  width?: number
}

export function LineChart({ x, series, height = 160, yDomain, yFmt, xFmt, xTicks, marker, markerLabel, bands, yLabel, legend = true, tipExtra, xLabel }: {
  x: number[]
  series: Series[]
  height?: number
  yDomain?: [number, number]
  yFmt: (v: number) => string
  xFmt: (v: number) => string
  xTicks?: number[]
  marker?: number | null
  markerLabel?: string
  bands?: { from: number; to: number; label?: string }[]
  yLabel?: string
  xLabel?: string
  legend?: boolean
  tipExtra?: (i: number) => ReactNode
}) {
  const [ref, w0] = useWidth<HTMLDivElement>()
  const w = w0 || 360
  const [hi, setHi] = useState<number | null>(null)
  const M = { l: 44, r: 12, t: 10, b: 22 }
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null && Number.isFinite(v))
  const [ya, yb] = yDomain ?? [Math.min(0, ...all), Math.max(...all) * 1.08 || 1]
  const xs = scaleLinear().domain([x[0], x[x.length - 1]]).range([M.l, Math.max(M.l + 10, w - M.r)])
  const ys = scaleLinear().domain([ya, yb]).range([height - M.b, M.t]).nice(4)
  const yt = ys.ticks(4)
  // a filled area reads as magnitude from zero, so it is only drawn when the y-axis starts at zero
  const zeroBased = ys.domain()[0] <= 0
  // the x-axis label sits at the right end of the tick row: drop ticks it would cover (~11px per CJK char)
  const xt = (xTicks ?? xs.ticks(5)).filter((t) => !xLabel || xs(t) + 16 < w - M.r - xLabel.length * 11)
  const paths = series.map((s) => {
    const pts = s.values.map((v, i) => [x[i], v] as const).filter((p): p is readonly [number, number] => p[1] != null && Number.isFinite(p[1]))
    return {
      s,
      line: d3line<readonly [number, number]>().x((p) => xs(p[0])).y((p) => ys(p[1]))(pts) ?? '',
      area: s.area && zeroBased ? d3area<readonly [number, number]>().x((p) => xs(p[0])).y0(ys(0)).y1((p) => ys(p[1]))(pts) ?? '' : '',
    }
  })
  const bis = bisector((d: number) => d).center
  return (
    <div className="chart" ref={ref}>
      {legend && series.length > 1 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.id} className="chart-legend-item">
              <svg width="18" height="8" aria-hidden="true">
                <line x1="0" x2="18" y1="4" y2="4" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '4 3' : undefined} />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg width={w} height={height} className="chart-svg"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = bis(x, xs.invert(e.clientX - r.left))
          setHi(i >= 0 && i < x.length ? i : null)
        }}
        onMouseLeave={() => setHi(null)}>
        {bands?.map((b, k) => (
          <g key={k}>
            <rect x={xs(b.from)} width={Math.max(0, xs(b.to) - xs(b.from))} y={M.t} height={height - M.b - M.t} fill="var(--ink-1)" opacity={0.045} />
            {b.label && <text x={xs(b.from) + 4} y={M.t + 10} className="chart-band-label">{b.label}</text>}
          </g>
        ))}
        {yt.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={w - M.r} y1={ys(t)} y2={ys(t)} className="chart-grid" />
            <text x={M.l - 6} y={ys(t) + 3.5} textAnchor="end" className="chart-tick">{yFmt(t)}</text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={t} x={xs(t)} y={height - 6} textAnchor="middle" className="chart-tick">{xFmt(t)}</text>
        ))}
        {yLabel && <text x={M.l} y={M.t - 1} className="chart-axis-label">{yLabel}</text>}
        {xLabel && <text x={w - M.r} y={height - 6} textAnchor="end" className="chart-axis-label">{xLabel}</text>}
        {paths.map(({ s, area }) => area && <path key={`a-${s.id}`} d={area} fill={s.color} opacity={0.12} />)}
        {paths.map(({ s, line }) => (
          <path key={s.id} d={line} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {marker != null && (
          <g>
            <line x1={xs(marker)} x2={xs(marker)} y1={M.t} y2={height - M.b} stroke="var(--ink-1)" strokeWidth={1} strokeDasharray="2 2" />
            {markerLabel && (
              <text x={xs(marker) + (xs(marker) > w - 90 ? -5 : 5)} y={M.t + 10} textAnchor={xs(marker) > w - 90 ? 'end' : 'start'} className="chart-marker-label">{markerLabel}</text>
            )}
          </g>
        )}
        {hi != null && (
          <g>
            <line x1={xs(x[hi])} x2={xs(x[hi])} y1={M.t} y2={height - M.b} stroke="var(--ink-3)" />
            {series.map((s) => {
              const v = s.values[hi]
              return v == null ? null : <circle key={s.id} cx={xs(x[hi])} cy={ys(v)} r={3.5} fill={s.color} stroke="var(--bg-1)" strokeWidth={2} />
            })}
          </g>
        )}
      </svg>
      {hi != null && (
        <div className="tip" style={{ left: Math.min(xs(x[hi]) + 12, w - 190), top: 18 }}>
          <div className="tip-title num">{xFmt(x[hi])}</div>
          {series.map((s) => (
            <div key={s.id} className="tip-row">
              <span className="k"><i className="tip-sw" style={{ background: s.color }} />{s.label}</span>
              <span className="v">{s.values[hi] == null ? '—' : yFmt(s.values[hi] as number)}</span>
            </div>
          ))}
          {tipExtra?.(hi)}
        </div>
      )}
    </div>
  )
}

/* ---------------- horizontal bars (ranked list) ---------------- */
export function BarList({ items, fmt, color = 'var(--ink-3)', max, onClick, selected }: {
  items: { key: string | number; label: ReactNode; value: number; sub?: ReactNode; color?: string }[]
  fmt: (v: number) => string
  color?: string
  max?: number
  onClick?: (key: string | number) => void
  selected?: string | number | null
}) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1e-9)
  return (
    <div className="barlist">
      {items.map((it) => (
        <button key={it.key} className={`barlist-row${selected === it.key ? ' on' : ''}`} onClick={onClick ? () => onClick(it.key) : undefined} disabled={!onClick}
          title={typeof it.label === 'string' ? `${it.label}：${fmt(it.value)}` : undefined}>
          <span className="barlist-label">{it.label}</span>
          <span className="barlist-bar">
            <i style={{ width: `${Math.max(0, Math.min(1, it.value / m)) * 100}%`, background: it.color ?? color }} />
          </span>
          <span className="barlist-v num">{fmt(it.value)}</span>
          {it.sub && <span className="barlist-sub">{it.sub}</span>}
        </button>
      ))}
    </div>
  )
}

/* ---------------- stacked share bar (e.g. LOS A–F) ---------------- */
export function ShareBar({ parts, height = 10 }: { parts: { key: string; value: number; color: string; label: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  const [hover, setHover] = useState<string | null>(null)
  const h = parts.find((p) => p.key === hover)
  return (
    <div className="sharebar-wrap">
      <div className="sharebar" style={{ height }} onMouseLeave={() => setHover(null)}>
        {parts.map((p) =>
          p.value > 0 ? (
            <i key={p.key} style={{ flexGrow: p.value, background: p.color }} onMouseEnter={() => setHover(p.key)} />
          ) : null,
        )}
      </div>
      {h && (
        <div className="tip" style={{ left: 0, top: height + 6 }}>
          <div className="tip-row"><span className="k">{h.label}</span><span className="v">{h.value}（{((h.value / total) * 100).toFixed(1)}%）</span></div>
        </div>
      )}
    </div>
  )
}
