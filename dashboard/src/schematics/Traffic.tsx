// 04 車流：同一條內湖幹道的「現況」與「彈性工時」並排，逐個 15 分鐘時段播放；
// 車輛密度 ∝ V/C，速度依 BPR 公式 v = vFree / (1 + α·(V/C)^β)。車子用 requestAnimationFrame 直接改 DOM。
import { useEffect, useRef, useState } from 'react'
import { fmtDeltaPct, fmtNum } from '../lib/format'
import { Hatch, MockBadge, STATUS_ICON, Schem, useReducedMotion, useUid, type Status } from './common'

export interface TrafficProps {
  /** 時段起點，如 "07:00" … "09:15" */
  bins: string[]
  vcBefore: number[]
  vcAfter: number[]
  vFree: number
  alpha: number
  beta: number
  /** 已算好的各時段速度（例如 impact4 依各 VD 流量加權）；省略時用 BPR 從 V/C 算 */
  speedBefore?: number[]
  speedAfter?: number[]
  /** 已算好的晨峰總延滯減少比例（0–1）；省略時用 V/C 加權的 BPR 延滯估算 */
  reduction?: number
  /** 尖峰曲線是否為模擬資料 */
  isMock?: boolean
  /** 下排（介入後）的名稱，預設「彈性工時」 */
  afterLabel?: string
}

const STEP_MS = 1200
const ROAD_X0 = 14
const ROAD_X1 = 466
const ROAD_H = 24
const ROADS = [
  { key: 'before', top: 48 },
  { key: 'after', top: 104 },
] as const
const CAR_W = 10
const NMAX = 22 // 每個車道最多車數（V/C = 1 時幾乎全滿）
const LOOP = ROAD_X1 - ROAD_X0 + CAR_W
const SPACING = LOOP / NMAX
const PX_PER_KMH = 1.6
const PLOT = { x0: 48, x1: 456, top: 150, bottom: 200 }

/** 每格車位的出現門檻（固定的亂序），V/C 超過門檻才顯示 */
const RANK = Array.from({ length: 2 * NMAX }, (_, i) => (i * 0.618034 + (i >= NMAX ? 0.31 : 0)) % 1)

function vcStatus(vc: number): [Status, string] {
  if (vc < 0.7) return ['good', '順暢']
  if (vc < 0.9) return ['warning', '車多']
  if (vc < 1) return ['serious', '壅塞']
  return ['critical', '嚴重壅塞']
}

const carX = (slot: number, lane: number, offset: number) =>
  ROAD_X0 - CAR_W + ((((slot + (lane ? 0.5 : 0)) * SPACING + offset) % LOOP) + LOOP) % LOOP

export default function Traffic({ bins, vcBefore, vcAfter, vFree, alpha, beta, speedBefore, speedAfter, reduction, isMock, afterLabel = '彈性工時' }: TrafficProps) {
  const uid = useUid('traffic')
  const reduced = useReducedMotion()
  const n = Math.max(1, bins.length)
  const peak = vcBefore.reduce((b, v, i) => (v > vcBefore[b] ? i : b), 0)
  const [tick, setTick] = useState(0)
  const i = reduced ? peak : tick % n

  const speed = (vc: number) => vFree / (1 + alpha * Math.pow(Math.max(0, vc), beta))
  const delayOf = (v: number) => Math.max(0, (1 / v - 1 / vFree) * 3600) // 秒/km
  const vcs = [vcBefore[i] ?? 0, vcAfter[i] ?? vcBefore[i] ?? 0]
  const speeds = [speedBefore?.[i] ?? speed(vcs[0]), speedAfter?.[i] ?? speed(vcs[1])]

  // 晨峰總延滯（V/C 加權）
  const total = (arr: number[]) => arr.reduce((s, vc) => s + vc * delayOf(speed(vc)), 0)
  const after = vcBefore.map((v, k) => vcAfter[k] ?? v)
  const delayChange = reduction != null ? -reduction : total(vcBefore) > 0 ? total(after) / total(vcBefore) - 1 : 0

  // 時段輪播
  useEffect(() => {
    if (reduced) return
    const t = window.setInterval(() => setTick((k) => k + 1), STEP_MS)
    return () => window.clearInterval(t)
  }, [reduced])

  // 車子移動：rAF 直接改 x，不經過 React
  const cars = useRef<(SVGRectElement | null)[][]>([[], []])
  const speedRef = useRef(speeds)
  useEffect(() => {
    speedRef.current = speeds
  })
  useEffect(() => {
    if (reduced) return
    const off = [0, 0]
    let last = performance.now()
    let raf = requestAnimationFrame(function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      for (let r = 0; r < 2; r++) {
        off[r] = (off[r] + speedRef.current[r] * PX_PER_KMH * dt) % LOOP
        cars.current[r].forEach((el, k) => el?.setAttribute('x', carX(k % NMAX, k >= NMAX ? 1 : 0, off[r]).toFixed(1)))
      }
      raf = requestAnimationFrame(frame)
    })
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  // V/C 軸跟著資料縮放（0.1 為一格）；接近容量時才把 V/C = 1 的容量線納入
  const all = [...vcBefore, ...after].filter((v) => Number.isFinite(v))
  const lo = Math.max(0, Math.floor((Math.min(...all) - 0.05) * 10) / 10)
  const top = Math.ceil((Math.max(...all) + 0.05) * 10) / 10
  const hi = top >= 0.9 ? Math.max(1.05, top) : top
  const px = (k: number) => PLOT.x0 + (k * (PLOT.x1 - PLOT.x0)) / Math.max(1, n - 1)
  const py = (v: number) => PLOT.bottom - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (PLOT.bottom - PLOT.top)
  const line = (arr: number[]) => arr.map((v, k) => `${k ? 'L' : 'M'}${px(k).toFixed(1)} ${py(v).toFixed(1)}`).join(' ')

  return (
    <Schem
      code="04"
      name="車流"
      label={`內湖晨峰車流示意：${bins[i] ?? ''} 現況 V/C ${fmtNum(vcs[0], 2)}、時速 ${fmtNum(speeds[0])} 公里；${afterLabel} V/C ${fmtNum(vcs[1], 2)}、時速 ${fmtNum(speeds[1])} 公里；晨峰總延滯 ${fmtDeltaPct(delayChange)}`}
      defs={
        <>
          <Hatch id={`${uid}-hatch`} />
          {ROADS.map((r) => (
            <clipPath key={r.key} id={`${uid}-${r.key}`}>
              <rect x={ROAD_X0} y={r.top} width={ROAD_X1 - ROAD_X0} height={ROAD_H} />
            </clipPath>
          ))}
        </>
      }
    >
      {isMock && <MockBadge x={124} y={6} hatchId={`${uid}-hatch`} />}
      <text x={468} y={20} className="end">
        <tspan className="sm ink3">內湖 · 平日晨峰</tspan>
        <tspan className="num xl ink1" dx={8}>
          {bins[i] ?? '—'}
        </tspan>
      </text>

      {ROADS.map((r, ri) => {
        const vc = vcs[ri]
        const [st, stLabel] = vcStatus(vc)
        return (
          <g key={r.key}>
            <text x={ROAD_X0} y={r.top - 8}>
              <tspan className="ink1 b">{ri ? afterLabel : '現況'}</tspan>
              <tspan className="num ink2" dx={8}>
                {bins[i] ?? '—'}
              </tspan>
            </text>
            <text x={ROAD_X1} y={r.top - 8} className="end sm">
              <tspan className={`st-${st}`}>{STATUS_ICON[st]}</tspan>
              <tspan className="ink1" dx={3}>
                {stLabel}
              </tspan>
              <tspan className="ink3" dx={10}>
                V/C
              </tspan>
              <tspan className="num ink1" dx={3}>
                {fmtNum(vc, 2)}
              </tspan>
              <tspan className="num ink1" dx={10}>
                {fmtNum(speeds[ri])}
              </tspan>
              <tspan className="ink3" dx={3}>
                km/h
              </tspan>
              <tspan className="ink3" dx={10}>
                延滯
              </tspan>
              <tspan className="num ink1" dx={3}>
                {fmtNum(delayOf(speeds[ri]))}
              </tspan>
              <tspan className="ink3" dx={3}>
                秒/km
              </tspan>
            </text>
            <rect x={ROAD_X0} y={r.top} width={ROAD_X1 - ROAD_X0} height={ROAD_H} className="f-bg2" />
            <line x1={ROAD_X0} y1={r.top} x2={ROAD_X1} y2={r.top} className="s-l3 w1" />
            <line x1={ROAD_X0} y1={r.top + ROAD_H} x2={ROAD_X1} y2={r.top + ROAD_H} className="s-l3 w1" />
            <line x1={ROAD_X0} y1={r.top + ROAD_H / 2} x2={ROAD_X1} y2={r.top + ROAD_H / 2} className="s-ink4 w1" strokeDasharray="6 6" />
            <g clipPath={`url(#${uid}-${r.key})`}>
              {RANK.map((rank, k) => (
                <rect
                  key={k}
                  ref={(el) => {
                    cars.current[ri][k] = el
                  }}
                  x={carX(k % NMAX, k >= NMAX ? 1 : 0, 0)}
                  y={r.top + (k >= NMAX ? 15 : 4)}
                  width={CAR_W}
                  height={5}
                  rx={1}
                  className="f-d4 sc-car"
                  opacity={rank < vc ? 1 : 0}
                />
              ))}
            </g>
          </g>
        )
      })}

      {/* 時間軸：兩條 V/C 曲線 + 播放指針 */}
      <g>
        <line x1={PLOT.x0} y1={144 - 4} x2={PLOT.x0 + 14} y2={144 - 4} className="s-ink2 w15" />
        <text x={PLOT.x0 + 18} y={144} className="sm ink3">
          現況
        </text>
        <line x1={PLOT.x0 + 50} y1={140} x2={PLOT.x0 + 64} y2={140} className="s-d4 w15" strokeDasharray="4 2" />
        <text x={PLOT.x0 + 68} y={144} className="sm ink3">
          {afterLabel}
        </text>
        <text x={PLOT.x1} y={144} className="sm end ink3">
          V/C（流量／容量）
        </text>
        {hi >= 1 && (
          <>
            <line x1={PLOT.x0} y1={py(1)} x2={PLOT.x1} y2={py(1)} className="s-ink4 w1" strokeDasharray="1 3" />
            <text x={PLOT.x1 + 3} y={py(1) + 3.5} className="sm ink3">
              容量
            </text>
          </>
        )}
        {(hi >= 1 ? [lo] : [lo, hi]).map((v) => (
          <text key={v} x={PLOT.x0 - 6} y={py(v) + 3.5} className="num sm end ink4">
            {fmtNum(v, 1)}
          </text>
        ))}
        <line x1={PLOT.x0} y1={PLOT.bottom} x2={PLOT.x1} y2={PLOT.bottom} className="s-l3 w1" />
        <path d={line(vcBefore)} className="s-ink2 w15 f-none round" />
        <path d={line(after)} className="s-d4 w15 f-none round" strokeDasharray="4 2" />
        {bins.map((b, k) =>
          k % 2 === 0 ? (
            <text key={b} x={px(k)} y={PLOT.bottom + 13} className="num sm mid ink3">
              {b}
            </text>
          ) : null,
        )}
        <line x1={px(i)} y1={PLOT.top - 4} x2={px(i)} y2={PLOT.bottom} className="s-ink1 w1" />
        <circle cx={px(i)} cy={py(vcs[0])} r={3} className="f-bg1 s-ink2 w15" />
        <circle cx={px(i)} cy={py(vcs[1])} r={3} className="f-bg1 s-d4 w15" />
      </g>

      {/* 讀數 */}
      <text x={14} y={231} className="sm ink4">
        車流密度 ∝ V/C · 速度依 BPR 公式
      </text>
      <text x={468} y={231} className="end">
        <tspan className="ink3">晨峰總延滯</tspan>
        <tspan className="num ink1 lg b" dx={6}>
          {fmtDeltaPct(delayChange)}
        </tspan>
      </text>
    </Schem>
  )
}
