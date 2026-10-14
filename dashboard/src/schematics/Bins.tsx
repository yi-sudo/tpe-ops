// 02 清潔箱：清潔箱水位上升，清運車依「固定班表」每站都停、或「依滿溢度調度」只停 ≥ 80% 的箱子；新增清潔箱補涵蓋缺口。
// 水位是模擬資料（目前沒有滿溢感測），圖上一定標「模擬資料」。
import { fmtInt, fmtPct } from '../lib/format'
import { Change, Hatch, MockBadge, Schem, StatusText, clamp, keyframes, useUid } from './common'

export interface BinsProps {
  mode: 'fixed' | 'dynamic'
  /** 新增清潔箱數 */
  newBins: number
  /** 新增後的需求涵蓋率（0–1） */
  covered: number
  /** 現況涵蓋率（預設 0.2698） */
  baseCovered?: number
  /** 畫滿 3 個新箱時對應的數量（預設 300） */
  maxNew?: number
}

const slotX = (k: number) => 48 + 48 * k
/** 現有清潔箱：[槽位, 清運車抵達時的水位]（模擬） */
const EXIST: [number, number][] = [
  [0, 0.34],
  [1, 0.93],
  [3, 0.22],
  [4, 0.86],
  [6, 0.5],
  [8, 0.97],
]
const NEW_SLOTS = [5, 2, 7]
const TOP = 104
const FILL_Y = 107
const FILL_H = 47
const ROAD_Y = 185
const X0 = -40 // 清運車進場 / 離場位置
const X1 = 520
const SPEED = 70 // px/s
const PAUSE = 0.9 // 每站停靠秒數
const EMPTY = 0.05
const FULL = 0.8
const BOX = 7 // 車廂中心在車身原點左邊 7px

const sy = (v: number) => `transform:scaleY(${v.toFixed(4)})`

function Truck() {
  return (
    <g>
      <rect x={-22} y={ROAD_Y - 11} width={30} height={19} className="f-bg3 s-ink2 w1" />
      <rect x={-20} y={ROAD_Y - 1} width={26} height={2} className="f-d2" />
      <path d={`M8 ${ROAD_Y + 8} V${ROAD_Y - 5} H15 L20 ${ROAD_Y + 1} V${ROAD_Y + 8} Z`} className="f-bg3 s-ink2 w1" />
      <path d={`M10 ${ROAD_Y - 3} H14.5 L17.5 ${ROAD_Y + 1} H10 Z`} className="f-ink4" />
      <circle cx={-14} cy={ROAD_Y + 9} r={3.5} className="f-ink4" />
      <circle cx={13} cy={ROAD_Y + 9} r={3.5} className="f-ink4" />
    </g>
  )
}

export default function Bins({ mode, newBins, covered, baseCovered = 0.2698, maxNew = 300 }: BinsProps) {
  const uid = useUid('bins')
  const stops = EXIST.filter(([, a]) => mode === 'fixed' || a >= FULL).map(([k]) => k)
  const notFull = EXIST.filter(([k, a]) => stops.includes(k) && a < FULL).length
  const T = (X1 - X0) / SPEED + stops.length * PAUSE
  const arrive = new Map(stops.map((k, j) => [k, (slotX(k) + BOX - X0) / SPEED + j * PAUSE]))

  // 清運車：等速前進，每個停靠站停 PAUSE 秒
  const truckName = `${uid}-truck-${mode}`
  const truckFrames: [number, string][] = [[0, `transform:translateX(${X0}px)`]]
  for (const k of stops) {
    const ta = arrive.get(k)!
    const x = slotX(k) + BOX
    truckFrames.push([ta / T, `transform:translateX(${x}px)`], [(ta + PAUSE) / T, `transform:translateX(${x}px)`])
  }
  truckFrames.push([1, `transform:translateX(${X1}px)`])
  let css = keyframes(truckName, truckFrames)

  // 每個有停靠的箱子：水位一路上升，清運車停靠時倒空，週期與清運車相同
  const bins = EXIST.map(([k, a]) => {
    const ta = arrive.get(k)
    if (ta == null) return { k, a, fill: undefined, warn: undefined }
    const td = ta + PAUSE
    const l0 = EMPTY + ((a - EMPTY) * (T - td)) / (T - PAUSE)
    const fill = `${uid}-f${k}-${mode}`
    css += keyframes(fill, [
      [0, sy(l0)],
      [ta / T, sy(a)],
      [td / T, sy(EMPTY)],
      [1, sy(l0)],
    ])
    let warn: string | undefined
    if (a >= FULL) {
      const t80 = (td + ((FULL - EMPTY) / (a - EMPTY)) * (T - PAUSE)) % T
      const tOff = ta + (PAUSE * (a - FULL)) / (a - EMPTY)
      warn = `${uid}-w${k}-${mode}`
      css += keyframes(
        warn,
        t80 <= tOff
          ? [
              [0, 'opacity:0'],
              [t80 / T, 'opacity:1'],
              [tOff / T, 'opacity:0'],
              [1, 'opacity:0'],
            ]
          : [
              [0, 'opacity:1'],
              [tOff / T, 'opacity:0'],
              [t80 / T, 'opacity:1'],
              [1, 'opacity:1'],
            ],
      )
    }
    return { k, a, fill, warn }
  })

  const nNew = newBins > 0 ? Math.max(1, Math.round(clamp(newBins / maxNew) * NEW_SLOTS.length)) : 0
  const dur = `${T.toFixed(2)}s`
  // 靜態值（減少動態效果時）＝抵達時的水位；動畫會覆蓋它
  const fillStyle = (a: number, fill?: string, warn?: string) => ({
    transformBox: 'fill-box' as const,
    transformOrigin: '50% 100%',
    transform: `scaleY(${a})`,
    animation: fill ? `${fill} ${dur} linear infinite${warn ? `, ${warn} ${dur} step-end infinite` : ''}` : undefined,
  })
  const routeDash = mode === 'fixed' ? '6 4' : '2 4'

  return (
    <Schem
      code="02"
      name="清潔箱"
      label={`清潔箱示意（模擬資料）：${mode === 'fixed' ? '固定班表，清運車每站都停' : '依滿溢度調度，清運車只停將滿的箱子'}；新增 ${fmtInt(newBins)} 個清潔箱，需求涵蓋率由 ${fmtPct(baseCovered)} 提升到 ${fmtPct(covered)}`}
      defs={<Hatch id={`${uid}-hatch`} />}
    >
      <style>{css}</style>
      <MockBadge x={404} y={8} hatchId={`${uid}-hatch`} />
      <text x={468} y={44} className="end sm ink2">
        {mode === 'fixed' ? '清運：固定班表' : '清運：依滿溢度調度'}
        <tspan className="ink3" dx={6}>
          停靠
        </tspan>
        <tspan className="num ink1" dx={3}>
          {stops.length}
        </tspan>
        <tspan className="ink3" dx={3}>
          {mode === 'fixed' ? `站（${notFull} 站未滿）` : '站（只收將滿）'}
        </tspan>
      </text>

      {/* 人行道與道路 */}
      <rect x={24} y={157} width={432} height={6} className="f-bg3" />
      <rect x={24} y={167} width={432} height={36} className="f-bg2" />
      <line x1={24} y1={ROAD_Y} x2={456} y2={ROAD_Y} className="s-ink3 w1" strokeDasharray={routeDash} />
      {stops.map((k) => (
        <circle key={k} cx={slotX(k)} cy={ROAD_Y} r={3} className="f-bg1 s-d2 w15" />
      ))}
      <text x={32} y={FILL_Y + FILL_H * (1 - FULL) + 3.5} className="sm end ink4 num">
        80%
      </text>

      {/* 現有清潔箱 */}
      {bins.map(({ k, a, fill, warn }) => {
        const x = slotX(k)
        return (
          <g key={k}>
            <rect x={x - 14} y={TOP - 5} width={28} height={5} className="f-bg3 s-ink3 w1" />
            <rect x={x - 12} y={TOP} width={24} height={53} className="f-bg2 s-ink3 w1" />
            <rect x={x - 10} y={FILL_Y} width={20} height={FILL_H} className="f-d2" fillOpacity={0.85} style={fillStyle(a, fill)} />
            {a >= FULL && (
              <rect
                x={x - 10}
                y={FILL_Y}
                width={20}
                height={FILL_H}
                className="st-warning"
                style={fillStyle(a, fill, warn)}
              />
            )}
            <line x1={x - 12} y1={FILL_Y + FILL_H * (1 - FULL)} x2={x + 12} y2={FILL_Y + FILL_H * (1 - FULL)} className="s-ink4 w1" strokeDasharray="2 2" />
            {a >= FULL && (
              <g style={{ animation: warn ? `${warn} ${dur} step-end infinite` : undefined }}>
                <StatusText x={x} y={TOP - 11} status="warning" label="將滿" anchor="middle" />
              </g>
            )}
          </g>
        )
      })}

      {/* 新增清潔箱（虛線） */}
      {NEW_SLOTS.slice(0, nNew).map((k) => {
        const x = slotX(k)
        return (
          <g key={k} className="a-pop">
            <rect x={x - 14} y={TOP - 5} width={28} height={5} className="f-none s-d2 w1 dash" />
            <rect x={x - 12} y={TOP} width={24} height={53} className="f-none s-d2 w15 dash" />
            <text x={x} y={TOP - 11} className="sm mid ink2">
              新增
            </text>
          </g>
        )
      })}

      {/* 清運車 */}
      <g style={{ transform: `translateX(${stops.length ? slotX(stops[0]) + BOX : 200}px)`, animation: `${truckName} ${dur} linear infinite` }}>
        <Truck />
      </g>

      {/* 圖例 */}
      <g transform="translate(14 229)">
        <rect x={0} y={-9} width={9} height={11} className="f-d2" fillOpacity={0.85} />
        <text x={13} y={0} className="sm ink3">
          現有
        </text>
        <rect x={44} y={-9} width={9} height={11} className="f-none s-d2 w1 dash" />
        <text x={57} y={0} className="sm ink3">
          新增
        </text>
        <line x1={88} y1={-4} x2={106} y2={-4} className="s-ink3 w15" strokeDasharray={routeDash} />
        <text x={110} y={0} className="sm ink3">
          清運路線
        </text>
        <StatusText x={162} y={0} status="warning" label="將滿（≥ 80%）" />
      </g>

      {/* 讀數 */}
      <text x={468} y={214} className="end sm ink3">
        新增清潔箱
        <tspan className="num ink1" dx={4}>
          {fmtInt(newBins)}
        </tspan>
        <tspan dx={3}>個</tspan>
      </text>
      <Change x={468} y={231} label="需求涵蓋率" from={fmtPct(baseCovered)} to={fmtPct(covered)} />
    </Schem>
  )
}
