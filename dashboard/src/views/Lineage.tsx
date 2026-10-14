// DL 資料血緣：原始資料 → pipeline 輸出檔 → 儀表板畫面。
// Sources and outputs come from catalog.json (written by pipeline.build); which files each screen reads is SCREENS below.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useWidth } from '../components/Charts'
import { IconArrow, IconClose, IconLineage, IconTarget, StatusGlyph } from '../components/Icons'
import { MockBadge, Panel } from '../components/Panel'
import { STATE_TEXT, feedState, type FeedState } from '../components/Shell'
import { useCatalog, useLive, useNow } from '../lib/data'
import { DOMAINS, domain, type DomainId } from '../lib/domains'
import { ageSec, fmtAge, fmtBytes, fmtDateTime, fmtHM, fmtInt, fmtWan, rocMonth } from '../lib/format'
import { href, type Route } from '../lib/router'
import type { Catalog, CatalogMock, CatalogOutput, CatalogSource, LiveStatus } from '../lib/types'

/* ---------------- screens: which files each one reads ---------------- */

interface Screen {
  key: string
  code: string
  name: string
  color: string
  route: Route
  files: string[]
}

/** every MapView loads these for its base map */
const BASEMAP = ['districts.geojson', 'lines/mrt.geojson', 'lines/bus_routes.geojson']
/** every 01–06 page: the shared frame (map, ranking, related problems) + the module's KPI and trend charts */
const MODULE = ['villages.geojson', 'links.json', 'impact.json', 'timeseries.json']
const MODULE_FILES: Record<DomainId, string[]> = {
  1: ['layers/trees.json', 'layers/tree_holes.json', 'lines/sidewalks.geojson'],
  2: ['layers/bins.json', 'layers/bin_candidates.json', 'layers/bus_stops.json'],
  3: ['layers/rats.json', 'layers/restaurants.json', 'layers/garbage_truck.json', 'layers/markets.json', 'layers/manholes.json'],
  4: ['lines/road_sections.geojson', 'layers/vd.json', 'live/traffic.json', 'live/series.json'],
  5: ['bus_routes.json', 'layers/bus_stops.json', 'layers/mrt.json', 'live/bus.json', 'live/series.json'],
  6: ['layers/hydrants.json', 'poly/liquefaction.geojson'],
}
/** keep in sync with the views' useData / useLayer / useLive calls */
const SCREENS: Screen[] = [
  {
    key: 'ov', code: 'OV', name: '全市總覽', color: 'var(--ink-2)', route: { name: 'overview' },
    files: ['villages.geojson', 'impact.json', 'links.json', 'live/traffic.json', 'live/bus.json', 'live/series.json', ...BASEMAP],
  },
  ...DOMAINS.map((d): Screen => ({
    key: `d${d.id}`, code: d.code, name: d.short, color: d.color, route: { name: 'domain', id: d.id },
    files: [...MODULE, ...MODULE_FILES[d.id], ...BASEMAP],
  })),
  { key: 'lx', code: 'LX', name: '跨題關聯', color: 'var(--focus)', route: { name: 'links' }, files: ['villages.geojson', 'links.json', ...BASEMAP] },
]

const CORE = ['villages.geojson', 'links.json', 'impact.json', 'timeseries.json']
const LIVE_OUT = ['live/traffic.json', 'live/bus.json', 'live/rain.json', 'live/series.json']

const PLATFORM: Record<string, string> = {
  data_taipei: '臺北市資料大平臺',
  tdx: '交通部 TDX',
  tcgbusfs: '臺北市交通局開放資料',
  tppkl: '公園處開放資料',
  tsis: '臺北市統計資料庫',
  parks: '公園處公園資訊 API',
  ratdar: '見鼠地圖',
  soil: '大地處地質資料',
  wic: '水利處防災資訊',
}

/* ---------------- formatting ---------------- */

/** node labels drop the city prefix (every source is Taipei); the full title is in the tooltip and the inspector */
const shortTitle = (t: string) => t.replace(/^(TDX )?大?臺北(市|地區)/, '$1').trim()
const shortUrl = (u: string) => u.replace(/^https?:\/\//, '')
const fmtCount = (n: number | null) => (n == null ? '—' : fmtWan(n))
const fmtInterval = (s: number | null) => (s == null ? '—' : s < 120 ? `${s} 秒` : `${Math.round(s / 60)} 分鐘`)
const outType = (f: string) =>
  f.startsWith('live/') ? '即時資料' : f.startsWith('layers/') ? '點圖層' : f.startsWith('lines/') ? '線圖層'
    : f.startsWith('poly/') ? '面圖層' : f.endsWith('.geojson') ? '里／行政區面資料' : '分析結果表'
const producer = (f: string) =>
  f === 'live/series.json' ? 'pipeline.collect_live 每分鐘追加一列（保留最近數小時）'
    : f.startsWith('live/') ? 'pipeline.collect_live 每分鐘重算' : 'pipeline.build 離線建置'

/* ---------------- graph ---------------- */

interface Group {
  key: string
  title: string
  agency: string
  platform: string
  problems: number[]
  files: CatalogSource[]
  live: boolean
  interval: number | null
  records: number | null
  bytes: number | null
  t0: string | null
  t1: string | null
  period: string | null
}

type Kind = 'src' | 'mock' | 'out' | 'scr'
interface GNode {
  id: string
  kind: Kind
  label: string
  ins: string[]
  outs: string[]
  live: boolean
  group?: Group
  mock?: CatalogMock
  out?: CatalogOutput
  screen?: Screen
}
type EKind = 'in' | 'derive' | 'use'
interface GEdge {
  id: string
  a: string
  b: string
  kind: EKind
  /** base-map file -> every screen (drawn faint) */
  base: boolean
  mock: boolean
  /** refreshed every minute while the screen is open */
  live: boolean
}
interface Graph {
  nodes: Map<string, GNode>
  edges: GEdge[]
  groups: Group[]
}
type Lineage = { up: Set<string>; down: Set<string> }

function groupSources(src: CatalogSource[]): Group[] {
  const by = new Map<string, CatalogSource[]>()
  for (const s of src) by.set(s.group, [...(by.get(s.group) ?? []), s])
  return [...by.entries()].map(([key, files]) => {
    const f = files[0]
    const sum = (k: 'record_count' | 'bytes') => (files.some((x) => x[k] != null) ? files.reduce((a, x) => a + (x[k] ?? 0), 0) : null)
    const ts = files.map((x) => x.fetched_at).filter((t): t is string => !!t).sort()
    const ps = files.filter((x) => x.period != null).map((x) => String(x.period)).sort()
    const monthly = ps.every((p) => /^\d{5}$/.test(p))
    return {
      key, title: f.title, agency: f.agency, platform: PLATFORM[f.source] ?? f.source, problems: f.problems, files,
      live: f.live, interval: f.interval, records: sum('record_count'), bytes: sum('bytes'),
      t0: ts[0] ?? null, t1: ts[ts.length - 1] ?? null,
      period: !ps.length ? null : ps.length === 1 ? rocMonth(ps[0])
        : `${rocMonth(ps[0])}–${rocMonth(ps[ps.length - 1])}（${ps.length} ${monthly ? '個月' : '期'}）`,
    }
  })
}

function buildGraph(cat: Catalog): Graph {
  const groups = groupSources(cat.sources)
  const nodes = new Map<string, GNode>()
  const put = (n: Omit<GNode, 'ins' | 'outs'>) => nodes.set(n.id, { ...n, ins: [], outs: [] })
  for (const g of groups) put({ id: `s:${g.key}`, kind: 'src', label: shortTitle(g.title), live: g.live, group: g })
  for (const m of cat.mock) put({ id: `m:${m.key}`, kind: 'mock', label: m.title, live: false, mock: m })
  for (const o of cat.outputs) put({ id: `o:${o.file}`, kind: 'out', label: o.file, live: o.file.startsWith('live/'), out: o })
  for (const s of SCREENS) put({ id: `v:${s.key}`, kind: 'scr', label: s.name, live: false, screen: s })
  const edges: GEdge[] = []
  const link = (a: string, b: string, kind: EKind) => {
    const A = nodes.get(a)
    const B = nodes.get(b)
    if (!A || !B || A.outs.includes(b)) return
    A.outs.push(b)
    B.ins.push(a)
    edges.push({ id: `${a}>${b}`, a, b, kind, base: kind === 'use' && BASEMAP.includes(A.label), mock: A.kind === 'mock', live: A.live && (B.live || B.kind === 'scr') })
  }
  for (const o of cat.outputs)
    for (const i of o.inputs) {
      if (nodes.has(`o:${i}`)) link(`o:${i}`, `o:${o.file}`, 'derive')
      else link(`s:${i}`, `o:${o.file}`, 'in')
    }
  // older catalogs stored used_in as a single file name
  for (const m of cat.mock) for (const f of ([] as string[]).concat(m.used_in)) link(`m:${m.key}`, `o:${f}`, 'in')
  for (const s of SCREENS) for (const f of s.files) link(`o:${f}`, `v:${s.key}`, 'use')
  return { nodes, edges, groups }
}

/** every ancestor (up) and descendant (down) of a node, both including the node itself */
function lineage(G: Graph, id: string): Lineage {
  const walk = (k: string, set: Set<string>, dir: 'ins' | 'outs') => {
    for (const n of G.nodes.get(k)?.[dir] ?? [])
      if (!set.has(n)) {
        set.add(n)
        walk(n, set, dir)
      }
  }
  const up = new Set([id])
  const down = new Set([id])
  walk(id, up, 'ins')
  walk(id, down, 'outs')
  return { up, down }
}

/** an edge belongs to the lineage only when it lies on a path through the focused node */
const edgeOn = (e: GEdge, L: Lineage) => (L.up.has(e.a) && L.up.has(e.b)) || (L.down.has(e.a) && L.down.has(e.b))

/* ---------------- layout ---------------- */

const RH = 18 // row height
const GAP = 3
const SEC = 20 // section label
const TOP = 50 // column headers
const PAD = 12
const COLW = [252, 240, 150] as const
/** narrower panels scroll the graph sideways */
const MIN_W = 900

interface Box {
  x: number
  y: number
  w: number
  h: number
}
interface Layout {
  W: number
  H: number
  box: Map<string, Box>
  paths: Map<string, string>
  labels: { x: number; y: number; text: string }[]
  cols: number[]
}

/** taller nodes for hubs, so their edges can fan out (Sankey-like) */
const nodeH = (n: GNode) => Math.max(RH, 6 + 2 * Math.max(n.ins.length, n.outs.length))
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : Infinity)

function layoutGraph(G: Graph, width: number): Layout {
  const gap = Math.max(120, (width - 2 * PAD - COLW[0] - COLW[1] - COLW[2]) / 2)
  const cols = [PAD, PAD + COLW[0] + gap, PAD + COLW[0] + gap + COLW[1] + gap]
  const W = cols[2] + COLW[2] + PAD
  const all = [...G.nodes.values()]
  const get = (id: string) => G.nodes.get(id)!
  const scr = SCREENS.map((s) => `v:${s.key}`).filter((id) => G.nodes.has(id))
  const scrIdx = new Map(scr.map((id, i) => [id, i]))
  const bary = (n: GNode, pos: Map<string, number>) => mean(n.outs.map((o) => pos.get(o)).filter((v): v is number => v != null))
  const labels: Layout['labels'] = []

  // column 2 (outputs): fixed sections; the middle one is ordered by the screens it feeds, to cut crossings
  const outs = all.filter((n) => n.kind === 'out')
  const fixed = new Set([...CORE, ...BASEMAP])
  const sections: [string, string[]][] = [
    ['分析結果', CORE.map((f) => `o:${f}`).filter((id) => G.nodes.has(id))],
    ['共用底圖（每張地圖都載入）', BASEMAP.map((f) => `o:${f}`).filter((id) => G.nodes.has(id))],
    ['圖層與明細', outs.filter((n) => !n.live && !fixed.has(n.label))
      .sort((a, b) => bary(a, scrIdx) - bary(b, scrIdx) || a.label.localeCompare(b.label)).map((n) => n.id)],
    ['即時（每分鐘重算）', [...LIVE_OUT.map((f) => `o:${f}`).filter((id) => G.nodes.has(id)),
      ...outs.filter((n) => n.live && !LIVE_OUT.includes(n.label)).map((n) => n.id)]],
  ]
  const col1: [string, number][] = []
  const lab1: [string, number][] = []
  let y = 0
  for (const [text, ids] of sections) {
    if (!ids.length) continue
    lab1.push([text, y])
    y += SEC
    for (const id of ids) {
      col1.push([id, y])
      y += nodeH(get(id)) + GAP
    }
    y += 10
  }
  const h1 = y - 10 - GAP

  // column 1 (sources + mocks): ordered by the mean position of the outputs they feed; unused ones last
  const c1 = new Map(col1.map(([id, yy]) => [id, yy + nodeH(get(id)) / 2]))
  const srcs = all.filter((n) => n.kind === 'src' || n.kind === 'mock')
  const used = srcs.filter((n) => n.outs.length).sort((a, b) => bary(a, c1) - bary(b, c1) || a.label.localeCompare(b.label, 'zh-TW'))
  const unused = srcs.filter((n) => !n.outs.length)
  const col0: [string, number][] = []
  const lab0: [string, number][] = []
  y = 0
  for (const n of used) {
    col0.push([n.id, y])
    y += nodeH(n) + GAP
  }
  if (unused.length) {
    y += 10
    lab0.push([`已擷取、尚未使用 · ${unused.length}`, y])
    y += SEC
    for (const n of unused) {
      col0.push([n.id, y])
      y += nodeH(n) + GAP
    }
  }
  const h0 = y - GAP

  const Hc = Math.max(h0, h1)
  const box = new Map<string, Box>()
  const place = (list: [string, number][], labs: [string, number][], c: number, off: number) => {
    for (const [id, yy] of list) box.set(id, { x: cols[c], y: off + yy, w: COLW[c], h: nodeH(get(id)) })
    for (const [text, yy] of labs) labels.push({ x: cols[c], y: off + yy, text })
  }
  place(col0, lab0, 0, TOP + (Hc - h0) / 2)
  place(col1, lab1, 1, TOP + (Hc - h1) / 2)

  // column 3 (screens): spread over the middle 80 % of the canvas
  const hs = scr.map((id) => nodeH(get(id)))
  const sum = hs.reduce((a, b) => a + b, 0)
  const span = Math.min(Hc, Math.max(sum + 6 * (scr.length - 1), Hc * 0.8))
  const g2 = scr.length > 1 ? (span - sum) / (scr.length - 1) : 0
  let y2 = TOP + (Hc - span) / 2
  scr.forEach((id, i) => {
    box.set(id, { x: cols[2], y: y2, w: COLW[2], h: hs[i] })
    y2 += hs[i] + g2
  })

  // edge end points are spread over the node height, ordered by the other end, so bundles don't cross inside a node
  const cy = (id: string) => {
    const b = box.get(id)!
    return b.y + b.h / 2
  }
  const slot = (b: Box, k: number, n: number) => b.y + 3 + ((b.h - 6) * (k + 0.5)) / n
  const outSlot = new Map<string, number>()
  const inSlot = new Map<string, number>()
  for (const n of all) {
    const b = box.get(n.id)
    if (!b) continue
    const o = G.edges.filter((e) => e.a === n.id && e.kind !== 'derive').sort((p, q) => cy(p.b) - cy(q.b))
    o.forEach((e, k) => outSlot.set(e.id, slot(b, k, o.length)))
    const i = G.edges.filter((e) => e.b === n.id).sort((p, q) => cy(p.a) - cy(q.a))
    i.forEach((e, k) => inSlot.set(e.id, slot(b, k, i.length)))
  }
  const paths = new Map<string, string>()
  for (const e of G.edges) {
    const A = box.get(e.a)
    const B = box.get(e.b)
    if (!A || !B) continue
    const yb = inSlot.get(e.id)!
    if (e.kind === 'derive') {
      // output -> output in the same column: an arc on the left, from the parent's lower corner into the child
      const ya = A.y + A.h - 3
      const bend = 12 + Math.min(26, Math.abs(yb - ya) * 0.3)
      paths.set(e.id, `M${A.x},${ya} C${A.x - bend},${ya} ${B.x - bend},${yb} ${B.x - 5},${yb}`)
    } else {
      const ya = outSlot.get(e.id)!
      const x0 = A.x + A.w
      const m = (x0 + B.x) / 2
      paths.set(e.id, `M${x0},${ya} C${m},${ya} ${m},${yb} ${B.x},${yb}`)
    }
  }
  return { W, H: TOP + Hc + PAD, box, paths, labels, cols }
}

/* ---------------- page ---------------- */

export default function Lineage() {
  const cat = useCatalog()
  const { status } = useLive()
  const now = useNow(5000)
  const G = useMemo(() => (cat ? buildGraph(cat) : null), [cat])
  const [gref, gw] = useWidth<HTMLDivElement>()
  const lay = useMemo(() => (G ? layoutGraph(G, Math.max(gw, MIN_W)) : null), [G, gw])
  const [sel, setSel] = useState<string | null>(null)
  const [hov, setHov] = useState<string | null>(null)
  const focus = hov ?? sel
  const L = useMemo(() => (G && focus && G.nodes.has(focus) ? lineage(G, focus) : null), [G, focus])
  const upCount = useMemo(() => {
    const m = new Map<string, number>()
    if (G) for (const s of SCREENS) m.set(`v:${s.key}`, [...lineage(G, `v:${s.key}`).up].filter((id) => id.startsWith('s:')).length)
    return m
  }, [G])
  const nodeEls = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const locate = (id: string) => nodeEls.current.get(id)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })

  return (
    <div className="view ln">
      <DlHeader cat={cat} G={G} status={status} now={now} />
      <div className="ln-main scroll">
        <Panel tag="DL" title="資料血緣圖" right={<span className="lx-hint">滑鼠移到節點預覽上下游 · 點一下固定 · Esc 取消</span>} foot={<EdgeLegend />}>
          {/* the canvas is laid out to the panel width (scrolls only below its minimum); hidden avoids a scrollbar from sub-pixel widths */}
          <div className="ln-graph scroll" ref={gref} style={{ overflowX: gw && gw < MIN_W ? 'auto' : 'hidden' }}>
            {G && lay ? (
              <Canvas G={G} lay={lay} L={L} sel={sel} status={status} now={now} upCount={upCount} nodeEls={nodeEls}
                onHover={setHov} onPick={(id) => setSel((s) => (id && s === id ? null : id))} />
            ) : (
              <div className="ln-loading">載入 catalog.json …</div>
            )}
          </div>
        </Panel>
        {cat && G && (
          <Panel tag="CT" title={`資料清冊 · ${cat.sources.length} 個原始檔`} right={<span className="lx-hint">點一列在右側檢視；原始網址在新分頁開啟</span>}>
            <CatalogTable cat={cat} G={G} sel={sel} status={status} now={now} onPick={setSel} />
          </Panel>
        )}
      </div>
      <div className="ln-right scroll stagger">
        {G && <Inspector G={G} id={sel} status={status} now={now} upCount={upCount} onPick={setSel} onLocate={locate} />}
        {G && <LivePanel G={G} status={status} now={now} sel={sel} onPick={setSel} />}
        {G && <MockPanel G={G} sel={sel} onPick={setSel} />}
      </div>
    </div>
  )
}

/* ---------------- header ---------------- */

function DlHeader({ cat, G, status, now }: { cat?: Catalog; G: Graph | null; status?: LiveStatus; now: number }) {
  const src = cat?.sources ?? []
  const units = new Set(src.flatMap((s) => s.agency.split('／')))
  const platforms = new Set(src.map((s) => s.source))
  const records = src.reduce((a, s) => a + (s.record_count ?? 0), 0)
  const bytes = src.reduce((a, s) => a + (s.bytes ?? 0), 0)
  const live = G?.groups.filter((g) => g.live) ?? []
  const states = live.map((g) => feedState(status?.feeds[g.key], now))
  const worst: FeedState = (['critical', 'warning', 'idle'] as const).find((s) => states.includes(s)) ?? 'good'
  return (
    <header className="dp-head lx-head" style={{ ['--c' as string]: 'var(--ink-3)' }}>
      <span className="dp-code num">DL</span>
      <IconLineage size={24} className="dp-icon" />
      <div className="dp-titles">
        <h1 className="dp-title">
          資料血緣
          <span className="dp-kind">LINEAGE · {src.length || '—'} 檔 → {cat?.outputs.length ?? '—'} 個輸出 → {SCREENS.length} 個畫面</span>
        </h1>
        <p className="dp-q">畫面上的每個數字從哪裡來？資料多新？哪些是模擬？</p>
      </div>
      <div className="dp-meta">
        <span className="dp-k">原始資料</span>
        <span><b className="num">{G?.groups.length ?? '—'}</b><small>組 · {src.length} 檔</small></span>
      </div>
      <div className="dp-meta" title={[...units].join('、')}>
        <span className="dp-k">提供單位</span>
        <span><b className="num">{units.size || '—'}</b><small>個 · {platforms.size} 個平台</small></span>
      </div>
      <div className="dp-meta" title="原始檔的筆數與大小（不含即時串流的歷史快照）">
        <span className="dp-k">原始資料量</span>
        <span><b className="num">{fmtWan(records)}</b><small>筆 · {fmtBytes(bytes)}</small></span>
      </div>
      <div className="dp-meta">
        <span className="dp-k">即時串流</span>
        <span>
          <StatusGlyph status={worst} />
          <b className="num">{states.filter((s) => s === 'good').length}/{live.length}</b>
          <small>{STATE_TEXT.good}</small>
        </span>
      </div>
      <div className="dp-meta" title={cat?.mock.map((m) => `${m.title}：${m.reason}`).join('\n')}>
        <span className="dp-k">模擬資料</span>
        <span><b className="num">{cat?.mock.length ?? '—'}</b><small>項（虛線標示）</small></span>
      </div>
      <div className="dp-meta" title={`pipeline.build 執行時間 ${fmtDateTime(cat?.built_at)}`}>
        <span className="dp-k">資料建置</span>
        <span><b className="num">{cat ? fmtHM(cat.built_at) : '—'}</b><small>{cat ? `${fmtDateTime(cat.built_at).slice(5, 10)} · ${fmtAge(ageSec(cat.built_at, now))}` : ''}</small></span>
      </div>
    </header>
  )
}

/* ---------------- graph canvas ---------------- */

function Pips({ problems }: { problems: number[] }) {
  return (
    <span className="ln-pips" aria-hidden="true">
      {problems.filter((p) => p > 0).map((p) => <i key={p} style={{ background: domain(p).color }} />)}
    </span>
  )
}

function NodeLabel({ n }: { n: GNode }) {
  if (n.kind === 'src')
    return (
      <>
        <Pips problems={n.group!.problems} />
        <span className="ln-t">{n.label}</span>
      </>
    )
  if (n.kind === 'mock')
    return (
      <>
        <span className="mock-swatch" />
        <span className="ln-t">{n.label}</span>
      </>
    )
  if (n.kind === 'out') {
    const k = n.label.lastIndexOf('/') + 1
    return (
      <span className="ln-t ln-file">
        {k > 0 && <span className="ln-dir">{n.label.slice(0, k)}</span>}
        {n.label.slice(k)}
      </span>
    )
  }
  return (
    <>
      <span className="ln-code">{n.screen!.code}</span>
      <span className="ln-t">{n.label}</span>
    </>
  )
}

function tip(n: GNode, up: number): string {
  if (n.group) {
    const g = n.group
    return `${g.title}｜${g.agency}｜${g.platform}\n擷取 ${fmtDateTime(g.t1)}${g.records != null ? `｜${fmtInt(g.records)} 筆` : ''}${g.period ? `｜期間 ${g.period}` : ''}`
  }
  if (n.mock) return `模擬資料：${n.mock.title}\n${n.mock.reason}`
  if (n.out) return `public/data/${n.out.file}｜${fmtBytes(n.out.bytes)}\n輸入 ${n.ins.length} 項 → 下游 ${n.outs.length} 項`
  return `${n.screen!.code} ${n.screen!.name}｜讀取 ${n.ins.length} 個檔案、上游 ${up} 組原始資料`
}

function Canvas({ G, lay, L, sel, status, now, upCount, nodeEls, onHover, onPick }: {
  G: Graph
  lay: Layout
  L: Lineage | null
  sel: string | null
  status?: LiveStatus
  now: number
  upCount: Map<string, number>
  nodeEls: RefObject<Map<string, HTMLButtonElement>>
  onHover: (id: string | null) => void
  onPick: (id: string | null) => void
}) {
  const collectorOk = ageSec(status?.updated_at, now) < 600
  const feed = (n: GNode) => (n.group?.live ? feedState(status?.feeds[n.group.key], now) : null)
  // a live edge only animates while its feed (or the collector, for live/* files) is actually delivering
  const flowing = (e: GEdge) => {
    if (!e.live) return false
    const A = G.nodes.get(e.a)!
    const st = feed(A)
    return st ? st === 'good' || st === 'warning' : collectorOk
  }
  const edges = L ? [...G.edges].sort((a, b) => Number(edgeOn(a, L)) - Number(edgeOn(b, L))) : G.edges
  const heads: [string, string][] = [
    ['原始資料', `${G.groups.length} 組 · 右：筆數`],
    ['Pipeline 輸出', `${[...G.nodes.values()].filter((n) => n.kind === 'out').length} 個檔案 · 右：大小`],
    ['儀表板畫面', `${SCREENS.length} 個 · 右：上游資料組數`],
  ]
  return (
    <div className={`ln-canvas${L ? ' has-focus' : ''}`} style={{ width: lay.W, height: lay.H }}
      onClick={(e) => e.target === e.currentTarget && onPick(null)}>
      <svg className="ln-edges" width={lay.W} height={lay.H} aria-hidden="true">
        <defs>
          <marker id="ln-arr" viewBox="0 0 6 6" refX="1" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0L6,3L0,6Z" className="ln-arr" />
          </marker>
          <marker id="ln-arr-on" viewBox="0 0 6 6" refX="1" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0L6,3L0,6Z" className="ln-arr on" />
          </marker>
        </defs>
        {edges.map((e) => {
          const on = !!L && edgeOn(e, L)
          const d = lay.paths.get(e.id)
          if (!d) return null
          return (
            <path key={e.id} d={d}
              className={`ln-e ${e.kind}${e.base ? ' base' : ''}${e.mock ? ' mock' : ''}${flowing(e) ? ' live' : ''}${on ? ' on' : ''}`}
              markerEnd={e.kind === 'derive' ? `url(#ln-arr${on ? '-on' : ''})` : undefined} />
          )
        })}
      </svg>
      {heads.map(([t, s], i) => (
        <div key={t} className="ln-colh" style={{ left: lay.cols[i], width: COLW[i] }}>
          <b>{t}</b>
          <span>{s}</span>
        </div>
      ))}
      {lay.labels.map((l) => (
        <div key={l.text} className="ln-sec" style={{ left: l.x, top: l.y }}>{l.text}</div>
      ))}
      {[...G.nodes.values()].map((n) => {
        const b = lay.box.get(n.id)
        if (!b) return null
        const st = feed(n)
        const up = upCount.get(n.id) ?? 0
        const on = !!L && (L.up.has(n.id) || L.down.has(n.id))
        return (
          <button key={n.id}
            ref={(el) => {
              if (el) nodeEls.current.set(n.id, el)
              else nodeEls.current.delete(n.id)
            }}
            className={`ln-n ln-${n.kind}${n.kind === 'src' && !n.outs.length ? ' unused' : ''}${on ? ' on' : ''}${sel === n.id ? ' sel' : ''}`}
            style={{ left: b.x, top: b.y, width: b.w, height: b.h, ['--c' as string]: n.screen?.color }}
            onMouseEnter={() => onHover(n.id)} onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(n.id)} onBlur={() => onHover(null)}
            onClick={() => onPick(n.id)}
            aria-pressed={sel === n.id} title={tip(n, up)}>
            {n.kind === 'out' && n.live && (collectorOk ? <span className="live-dot" /> : <StatusGlyph status="warning" size={8} />)}
            <NodeLabel n={n} />
            {n.kind === 'out' && n.ins.some((i) => i.startsWith('m:')) && <span className="mock-swatch" title="含模擬欄位" />}
            <span className="ln-m num">
              {n.kind === 'src' ? (st ? <><StatusGlyph status={st} size={8} />即時</> : fmtCount(n.group!.records))
                : n.kind === 'mock' ? '模擬'
                  : n.kind === 'out' ? fmtBytes(n.out!.bytes)
                    : `${up} 組`}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function EdgeLegend() {
  const sample = (cls: string, arrow?: boolean) => (
    <svg width="26" height="10" aria-hidden="true">
      <path d={arrow ? 'M8,1.5 C3,1.5 3,8.5 8,8.5 H19' : 'M1,5 H25'} className={`ln-e ${cls}`} markerEnd={arrow ? 'url(#ln-arr)' : undefined} />
    </svg>
  )
  return (
    <div className="ln-legend">
      <span>{sample('in')}計算輸入</span>
      <span>{sample('derive', true)}由另一個輸出檔衍生</span>
      <span>{sample('in live')}即時串流（流動＝正常更新中）</span>
      <span>{sample('in mock')}模擬資料</span>
      <span>{sample('use base')}共用底圖</span>
      <span className="ln-legend-pips"><Pips problems={[1, 2, 3, 4, 5, 6]} />題目 01–06</span>
    </div>
  )
}

/* ---------------- inspector ---------------- */

const TAG: Record<Kind, string> = { src: 'SRC', mock: 'MOCK', out: 'OUT', scr: 'SCR' }

function DomainChips({ problems }: { problems: number[] }) {
  return (
    <div className="ln-chips">
      {problems.map((p) =>
        p === 0 ? (
          <span key={0} className="chip">基礎圖資</span>
        ) : (
          <a key={p} className="dchip" href={href({ name: 'domain', id: p as DomainId })} style={{ ['--c' as string]: domain(p).color }}>
            <span className="num">{domain(p).code}</span>
            {domain(p).short}
          </a>
        ),
      )}
    </div>
  )
}

function Inspector({ G, id, status, now, upCount, onPick, onLocate }: {
  G: Graph
  id: string | null
  status?: LiveStatus
  now: number
  upCount: Map<string, number>
  onPick: (id: string | null) => void
  onLocate: (id: string) => void
}) {
  const n = id ? G.nodes.get(id) : undefined
  if (!n)
    return (
      <Panel tag="IN" title="檢視">
        <p className="ln-empty">
          點選血緣圖或下方清冊的任一項目，這裡會列出它的擷取時間、原始網址、上游來源和受影響的畫面。
          滑鼠移到節點上可以先預覽上下游；按 Esc 取消選取。
        </p>
      </Panel>
    )
  const { up, down } = lineage(G, n.id)
  const ofKind = (set: Set<string>, k: Kind) =>
    [...set].filter((x) => x !== n.id).map((x) => G.nodes.get(x)!).filter((x) => x.kind === k)
  const byTitle = (a: GNode, b: GNode) => a.label.localeCompare(b.label, 'zh-TW')
  const upSrc = ofKind(up, 'src').sort(byTitle)
  const upMock = ofKind(up, 'mock')
  const dnOut = ofKind(down, 'out').sort(byTitle)
  const dnScr = SCREENS.map((s) => G.nodes.get(`v:${s.key}`)!).filter((x) => x && down.has(x.id) && x.id !== n.id)
  const meta = (x: GNode): ReactNode => {
    if (x.group) {
      const st = x.group.live ? feedState(status?.feeds[x.group.key], now) : null
      return st ? <><StatusGlyph status={st} size={8} />即時</> : fmtAge(ageSec(x.group.t1, now))
    }
    if (x.mock) return '模擬'
    if (x.out) return fmtBytes(x.out.bytes)
    return `${upCount.get(x.id) ?? 0} 組`
  }
  const rows = (list: GNode[]) => (
    <div className="ln-list">
      {list.map((x) => (
        <button key={x.id} className={`ln-li ln-${x.kind}`} onClick={() => onPick(x.id)} style={x.screen ? { ['--c' as string]: x.screen.color } : undefined}>
          <NodeLabel n={x} />
          <span className="ln-m num">{meta(x)}</span>
        </button>
      ))}
    </div>
  )
  // freshness of everything upstream: the oldest static fetch bounds how current the result can be
  const statics = upSrc.filter((x) => !x.group!.live && x.group!.t0)
  const oldest = statics.reduce<GNode | null>((m, x) => (!m || x.group!.t0! < m.group!.t0! ? x : m), null)
  const liveUp = upSrc.filter((x) => x.group!.live)
  const agencies = [...new Set(upSrc.flatMap((x) => x.group!.agency.split('／')))]

  const title = n.group ? n.group.title : n.out ? n.out.file : n.screen ? `${n.screen.code} ${n.screen.name}` : n.label
  return (
    <Panel tag={TAG[n.kind]} title={<span className={n.out ? 'num' : undefined}>{title}</span>} className="ln-ins-p"
      right={
        <>
          <button className="ln-icon-btn" onClick={() => onLocate(n.id)} title="在血緣圖中定位" aria-label="在血緣圖中定位">
            <IconTarget size={13} />
          </button>
          <button className="ln-icon-btn" onClick={() => onPick(null)} title="取消選取（Esc）" aria-label="取消選取">
            <IconClose size={12} />
          </button>
        </>
      }>
      <div className="ln-ins">
        {n.group && <SourceInfo n={n} g={n.group} status={status} now={now} />}

        {n.mock && (
          <>
            <div className="ln-row"><MockBadge /><span className="ln-sub">沒有對應的開放資料，以推估值代替</span></div>
            <p className="ln-note">{n.mock.reason}</p>
            <DomainChips problems={n.mock.problems} />
            <p className="ln-note">畫面上用到這項數值的地方都標有「模擬資料」；取得真實資料後只要替換這個節點，下游會在下次建置時自動更新。</p>
          </>
        )}

        {n.out && (
          <>
            <div className="ln-sub">{outType(n.out.file)} · {producer(n.out.file)}</div>
            <dl className="ln-kv">
              <dt>檔案</dt>
              <dd className="num">public/data/{n.out.file}</dd>
              <dt>大小</dt>
              <dd className="num">{fmtBytes(n.out.bytes)}<small>建置時</small></dd>
              <dt>上游原始資料</dt>
              <dd>{upSrc.length} 組<small>{agencies.length} 個提供單位</small></dd>
              {oldest && (
                <>
                  <dt>最舊的輸入</dt>
                  <dd className="num">{fmtDateTime(oldest.group!.t0)}<small>{oldest.label}</small></dd>
                </>
              )}
            </dl>
            {upMock.length > 0 && (
              <div className="ln-row"><MockBadge /><span className="ln-sub">含模擬欄位：{upMock.map((x) => x.label).join('、')}</span></div>
            )}
          </>
        )}

        {n.screen && (
          <>
            <a className="ln-open" href={href(n.screen.route)}>
              開啟畫面 <IconArrow size={12} />
            </a>
            <dl className="ln-kv">
              <dt>讀取檔案</dt>
              <dd>{n.ins.length} 個<small>連同上游衍生共 {ofKind(up, 'out').length} 個</small></dd>
              <dt>上游原始資料</dt>
              <dd>{upSrc.length} 組<small>{agencies.length} 個提供單位</small></dd>
              {oldest && (
                <>
                  <dt>最舊的輸入</dt>
                  <dd className="num">{fmtDateTime(oldest.group!.t0)}<small>{oldest.label}</small></dd>
                </>
              )}
              <dt>即時串流</dt>
              <dd className="ln-feeds-inline">
                {liveUp.length
                  ? liveUp.map((x) => {
                      const st = feedState(status?.feeds[x.group!.key], now)
                      return (
                        <span key={x.id} title={STATE_TEXT[st]}>
                          <StatusGlyph status={st} size={8} />
                          {x.label.replace(/^TDX /, '')}
                        </span>
                      )
                    })
                  : '無'}
              </dd>
            </dl>
            {upMock.length > 0 && (
              <div className="ln-row"><MockBadge /><span className="ln-sub">讀取的檔案含模擬欄位：{upMock.map((x) => x.label).join('、')}，畫面上用到處都有標示</span></div>
            )}
            <h3 className="ln-h3">提供資料的單位 · {agencies.length}</h3>
            <div className="ln-chips">{agencies.map((a) => <span key={a} className="chip">{a}</span>)}</div>
          </>
        )}

        {n.ins.length > 0 && (
          <>
            <h3 className="ln-h3">{n.screen ? '讀取的檔案' : '直接輸入'} · {n.ins.length}</h3>
            {rows(n.ins.map((x) => G.nodes.get(x)!).sort((a, b) => a.kind.localeCompare(b.kind) || byTitle(a, b)))}
          </>
        )}
        {n.screen && upSrc.length > 0 && (
          <>
            <h3 className="ln-h3">上游原始資料 · {upSrc.length}</h3>
            {rows(upSrc)}
          </>
        )}
        {!n.screen && dnOut.length > 0 && (
          <>
            <h3 className="ln-h3">下游輸出檔 · {dnOut.length}</h3>
            {rows(dnOut)}
          </>
        )}
        {!n.screen && (
          <>
            <h3 className="ln-h3">{n.kind === 'out' ? '下游畫面' : '受影響的畫面'} · {dnScr.length}</h3>
            {dnScr.length ? rows(dnScr) : <p className="ln-note">{n.group ? '這組資料已擷取並存在本機，但目前沒有輸出檔使用（保留給後續分析）。' : '目前沒有畫面直接讀取這個檔案。'}</p>}
          </>
        )}
      </div>
    </Panel>
  )
}

function SourceInfo({ n, g, status, now }: { n: GNode; g: Group; status?: LiveStatus; now: number }) {
  const f = status?.feeds[g.key]
  const st = g.live ? feedState(f, now) : null
  const fetched = g.live ? f?.last_ok ?? g.t1 : g.t1
  // files of one group fetched over several minutes (or days) show as a range
  const [a, b] = [fmtDateTime(g.t0), fmtDateTime(fetched)]
  const when = g.live || a === b ? b : `${a} ～ ${a.slice(0, 10) === b.slice(0, 10) ? b.slice(11) : b}`
  return (
    <>
      <div className="ln-sub">{g.agency} · {g.platform}</div>
      <DomainChips problems={g.problems} />
      <dl className="ln-kv">
        <dt>{g.live ? '最後成功' : '擷取時間'}</dt>
        <dd className="num">
          {when}
          <small>{fmtAge(ageSec(fetched, now))}</small>
        </dd>
        <dt>筆數</dt>
        <dd className="num">{g.records != null ? `${fmtInt(g.records)} 筆` : '—'}{g.live && <small>最新一次</small>}</dd>
        <dt>原始檔大小</dt>
        <dd className="num">{fmtBytes(g.bytes)}{g.files.length > 1 && <small>{g.files.length} 個檔案</small>}</dd>
        {g.period && (
          <>
            <dt>資料期間</dt>
            <dd>{g.period}</dd>
          </>
        )}
        <dt>更新方式</dt>
        <dd>{g.live ? `即時：每 ${fmtInterval(g.interval)}抓一次並保留快照` : '靜態：執行 pipeline.fetch 時重新下載'}</dd>
      </dl>
      {st && (
        <div className="ln-row">
          <StatusGlyph status={st} />
          <span className="ln-sub">{STATE_TEXT[st]}{f?.error ? `：${f.error}` : ''}</span>
        </div>
      )}
      <h3 className="ln-h3">原始來源{g.files.length > 1 ? ` · ${g.files.length} 個檔案` : ''}</h3>
      {g.files.length > 1 ? (
        <div className="ln-files">
          {g.files.map((x) => (
            <a key={x.key} href={x.url} target="_blank" rel="noreferrer" title={x.url}>
              <span className="num">{x.period ? rocMonth(x.period) : x.key}</span>
              <span className="num">{fmtInt(x.record_count)} 筆</span>
              <span className="num">{fmtBytes(x.bytes)}</span>
              <IconArrow size={11} />
            </a>
          ))}
        </div>
      ) : (
        <a className="ln-url" href={g.files[0].url} target="_blank" rel="noreferrer" title={g.files[0].url}>
          <span className="num">{shortUrl(g.files[0].url)}</span>
          <IconArrow size={11} />
        </a>
      )}
      {g.files[0].source === 'tdx' && <p className="ln-note">TDX 需要先用金鑰換取存取權杖（OAuth）才能下載；金鑰只存在本機 .env。</p>}
      {!n.outs.length && <p className="ln-note">尚未使用：已擷取存檔，保留給後續分析。</p>}
    </>
  )
}

/* ---------------- side panels ---------------- */

function LivePanel({ G, status, now, sel, onPick }: { G: Graph; status?: LiveStatus; now: number; sel: string | null; onPick: (id: string) => void }) {
  const live = G.groups.filter((g) => g.live)
  const age = ageSec(status?.updated_at, now)
  return (
    <Panel tag="LV" title="即時串流" right={<span className="mono-tag" title="live/status.json 最後更新">收集程式 {status ? fmtAge(age) : '—'}</span>}>
      <div className="ln-list ln-feeds">
        {live.map((g) => {
          const f = status?.feeds[g.key]
          const st = feedState(f, now)
          const id = `s:${g.key}`
          return (
            <button key={g.key} className={`ln-li${sel === id ? ' on' : ''}`} onClick={() => onPick(id)}
              title={`${g.title}｜最後成功 ${fmtDateTime(f?.last_ok)}${f?.error ? `｜錯誤：${f.error}` : ''}`}>
              <StatusGlyph status={st} />
              <span className="ln-t">{shortTitle(g.title)}</span>
              <span className="ln-m">{STATE_TEXT[st]}</span>
              <span className="ln-m num ln-every">每 {fmtInterval(g.interval)}</span>
              <span className="ln-m num">{f?.last_ok ? fmtHM(f.last_ok) : '—'}</span>
            </button>
          )
        })}
      </div>
      <p className="ln-note ln-pad">每次抓取都存成快照（data/raw），畫面每 15 秒檢查一次有沒有新資料。超過 3 個更新週期沒有成功就標示延遲。</p>
    </Panel>
  )
}

function MockPanel({ G, sel, onPick }: { G: Graph; sel: string | null; onPick: (id: string) => void }) {
  const mocks = [...G.nodes.values()].filter((n) => n.kind === 'mock')
  return (
    <Panel tag="MK" title={`模擬資料 · ${mocks.length} 項`}>
      <div className="ln-list">
        {mocks.map((n) => (
          <button key={n.id} className={`ln-li ln-mk${sel === n.id ? ' on' : ''}`} onClick={() => onPick(n.id)}>
            <span className="mock-swatch" />
            <span className="ln-mk-t">
              <b>{n.mock!.title}</b>
              <small>{n.mock!.reason}</small>
              <small className="num">用在 {([] as string[]).concat(n.mock!.used_in).join('、')}</small>
            </span>
          </button>
        ))}
      </div>
      <p className="ln-note ln-pad">其餘資料都來自政府開放資料與民間公開資料，原始檔保存在本機；儀表板只讀本機檔案，不直接呼叫外部 API。</p>
    </Panel>
  )
}

/* ---------------- catalog table (the graph's accessible alternative) ---------------- */

type SortKey = 'cat' | 'fetched' | 'records' | 'bytes'

function CatalogTable({ cat, G, sel, status, now, onPick }: {
  cat: Catalog
  G: Graph
  sel: string | null
  status?: LiveStatus
  now: number
  onPick: (id: string) => void
}) {
  const [sort, setSort] = useState<SortKey>('cat')
  const rows = useMemo(() => {
    const r = [...cat.sources]
    const num = (v: number | null) => v ?? -1
    if (sort === 'fetched') r.sort((a, b) => (b.fetched_at ?? '').localeCompare(a.fetched_at ?? ''))
    if (sort === 'records') r.sort((a, b) => num(b.record_count) - num(a.record_count))
    if (sort === 'bytes') r.sort((a, b) => num(b.bytes) - num(a.bytes))
    return r
  }, [cat, sort])
  const downstream = useMemo(() => {
    const m = new Map<string, { out: number; scr: number }>()
    for (const g of G.groups) {
      const { down } = lineage(G, `s:${g.key}`)
      const k = (p: string) => [...down].filter((x) => x.startsWith(p)).length
      m.set(g.key, { out: k('o:'), scr: k('v:') })
    }
    return m
  }, [G])
  const th = (k: SortKey, label: string, cls = '') => (
    <th className={cls} aria-sort={sort === k ? 'descending' : undefined}>
      <button className={`ln-sort${sort === k ? ' on' : ''}`} onClick={() => setSort(sort === k ? 'cat' : k)}>
        {label}{sort === k ? ' ↓' : ''}
      </button>
    </th>
  )
  return (
    <div className="ln-tbl-wrap">
      <table className="ln-tbl">
        <thead>
          <tr>
            <th>資料</th>
            <th>提供單位</th>
            <th>題目</th>
            {th('fetched', '擷取時間')}
            {th('records', '筆數', 'r')}
            {th('bytes', '大小', 'r')}
            <th>更新</th>
            <th>下游</th>
            <th>原始</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const id = `s:${s.group}`
            const d = downstream.get(s.group)
            const st = s.live ? feedState(status?.feeds[s.key], now) : null
            const t = s.live ? status?.feeds[s.key]?.last_ok ?? s.fetched_at : s.fetched_at
            return (
              <tr key={s.key} className={sel === id ? 'on' : undefined} onClick={() => onPick(id)}>
                <td className="t">
                  <button className="ln-tl" title={s.title}>{shortTitle(s.title)}</button>
                  {s.period != null && <span className="ln-per num" title={String(s.period)}>{rocMonth(s.period)}</span>}
                </td>
                <td>{s.agency}</td>
                <td><Pips problems={s.problems} /><span className="num ln-codes">{s.problems.filter((p) => p > 0).map((p) => domain(p).code).join(' ') || '基礎'}</span></td>
                <td className="num" title={fmtDateTime(t)}>{fmtDateTime(t).slice(5)}<span className="ln-age">{fmtAge(ageSec(t, now))}</span></td>
                <td className="num r">{fmtInt(s.record_count)}</td>
                <td className="num r">{fmtBytes(s.bytes)}</td>
                <td>{st ? <span className="ln-upd"><StatusGlyph status={st} size={8} />每 {fmtInterval(s.interval)}</span> : <span className="muted">靜態</span>}</td>
                <td className="num">{d && d.out ? `${d.out} 檔 → ${d.scr} 畫面` : <span className="muted">未使用</span>}</td>
                <td>
                  <a className="ln-ext" href={s.url} target="_blank" rel="noreferrer" title={s.url} aria-label={`在新分頁開啟 ${s.title} 原始資料`} onClick={(e) => e.stopPropagation()}>
                    <IconArrow size={11} />
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
