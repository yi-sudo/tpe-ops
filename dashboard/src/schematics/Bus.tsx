// 05 公車：和捷運平行的重疊幹線減班，省下的車公里改開預約制小巴（DRTS）上山接冷區長者；駕駛班表每 4 小時休息 30 分鐘。
import type { CSSProperties } from 'react'
import { fmtInt, fmtNum, fmtPct, fmtWan } from '../lib/format'
import { Elder, Hatch, Schem, clamp, keyframes, useUid } from './common'

export interface BusProps {
  /** 重疊路線減班比例（0–1） */
  cut: number
  /** 可補足的冷區里數 */
  villagesServed: number
  /** 冷區里總數 */
  coldTotal: number
  /** 每日省下的車公里（可省略） */
  savedVkm?: number
}

const ROAD = { x0: 20, x1: 290, top: 56, h: 14 }
const BUS_MAX = 6
const HILL = 'M300 170 Q330 168 352 138 Q376 98 418 94 Q458 92 472 116 V170 Z'
const HOUSES: [number, number][] = [
  [418, 94],
  [436, 95],
  [453, 99.5],
]
// DRTS 路線：轉乘站 → 山上招呼點（二次貝茲曲線）
const P0 = [298, 64]
const PC = [340, 50]
const P1 = [370, 115]
const quad = (t: number) => [0, 1].map((d) => (1 - t) ** 2 * P0[d] + 2 * (1 - t) * t * PC[d] + t ** 2 * P1[d])
const VAN_T = 9 // 秒：去 3、等 1.4、回 3、等 1.6
const SHIFT = { x0: 20, w: 250, top: 134, h: 14, hours: 10 }
const SEGMENTS: [number, number, boolean][] = [
  [0, 4, false],
  [4, 4.5, true],
  [4.5, 8.5, false],
  [8.5, 9, true],
  [9, 10, false],
]

function vanFrames(): [number, string][] {
  const f: [number, string][] = []
  const at = (sec: number, t: number, dir: 1 | -1) => {
    const [x, y] = quad(t)
    f.push([sec / VAN_T, `transform:translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scaleX(${dir})`])
  }
  const N = 8
  for (let k = 0; k <= N; k++) at((3 * k) / N, k / N, 1)
  at(4.39, 1, 1)
  for (let k = 0; k <= N; k++) at(4.4 + (3 * k) / N, 1 - k / N, -1)
  at(VAN_T - 0.01, 0, -1)
  at(VAN_T, 0, 1)
  return f
}

function Van() {
  return (
    <g>
      <rect x={-10} y={-11} width={20} height={9} rx={2} className="f-bg1 s-d5 w15" />
      <rect x={2} y={-9} width={5} height={3} className="f-d5" />
      <circle cx={-5} cy={-1.5} r={2} className="f-ink3" />
      <circle cx={5} cy={-1.5} r={2} className="f-ink3" />
    </g>
  )
}

function BusIcon() {
  return (
    <g>
      <rect x={0} y={0} width={22} height={8} rx={1.5} className="f-d5" />
      {[3, 8, 13].map((x) => (
        <rect key={x} x={x} y={1.6} width={3.6} height={2.6} className="f-bg1" />
      ))}
    </g>
  )
}

export default function Bus({ cut, villagesServed, coldTotal, savedVkm }: BusProps) {
  const uid = useUid('bus')
  const c = clamp(cut)
  const nBus = Math.round(BUS_MAX * (1 - c))
  const served = Math.min(coldTotal, Math.max(0, villagesServed))
  const share = coldTotal > 0 ? served / coldTotal : 0
  const cells = 10
  const filled = Math.round(share * cells)
  const hx = (h: number) => SHIFT.x0 + (h / SHIFT.hours) * SHIFT.w
  const css =
    keyframes(`${uid}-van`, vanFrames()) +
    keyframes(`${uid}-ride`, [
      [0, 'opacity:1'],
      [3.6 / VAN_T, 'opacity:1'],
      [4 / VAN_T, 'opacity:0'],
      [8 / VAN_T, 'opacity:0'],
      [8.6 / VAN_T, 'opacity:1'],
      [1, 'opacity:1'],
    ])

  return (
    <Schem
      code="05"
      name="公車"
      label={`公車示意：與捷運重疊的幹線減班 ${fmtPct(c, 0)}，省下的車公里改開預約制小巴，補足 ${fmtInt(served)} / ${fmtInt(coldTotal)} 個冷區里；駕駛每 4 小時休息 30 分鐘`}
      defs={
        <>
          <Hatch id={`${uid}-rest`} className="s-ink3" size={4} />
          <clipPath id={`${uid}-road`}>
            <rect x={ROAD.x0} y={ROAD.top - 20} width={ROAD.x1 - ROAD.x0} height={ROAD.h + 24} />
          </clipPath>
        </>
      }
    >
      <style>{css}</style>

      {/* 捷運（雙線）與列車 */}
      <text x={ROAD.x0} y={37} className="sm ink3">
        捷運
      </text>
      <line x1={ROAD.x0} y1={44} x2={ROAD.x1} y2={44} className="s-ink3 w1" />
      <line x1={ROAD.x0} y1={48} x2={ROAD.x1} y2={48} className="s-ink3 w1" />
      <g clipPath={`url(#${uid}-road)`}>
        <g style={{ '--run': '300px', animationDuration: '6s' } as CSSProperties} className="a-drive">
          <rect x={-10} y={44.5} width={26} height={3} className="f-ink2" />
        </g>
      </g>
      {[70, 170, 270].map((x) => (
        <rect key={x} x={x - 3} y={41} width={6} height={10} className="f-bg1 s-ink3 w1" />
      ))}

      {/* 重疊幹線與公車 */}
      <rect x={ROAD.x0} y={ROAD.top} width={ROAD.x1 - ROAD.x0} height={ROAD.h} className="f-bg2" />
      <line x1={ROAD.x0} y1={ROAD.top} x2={ROAD.x1} y2={ROAD.top} className="s-l3 w1" />
      <line x1={ROAD.x0} y1={ROAD.top + ROAD.h} x2={ROAD.x1} y2={ROAD.top + ROAD.h} className="s-l3 w1" />
      <g clipPath={`url(#${uid}-road)`}>
        {Array.from({ length: nBus }, (_, k) => (
          <g key={`${nBus}-${k}`} transform={`translate(-2 ${ROAD.top + 3})`}>
            <g
              className="a-drive"
              style={{ '--run': '300px', animationDelay: `${(-k * 12) / Math.max(1, nBus)}s`, transform: `translateX(${40 + k * 45}px)` } as CSSProperties}
            >
              <BusIcon />
            </g>
          </g>
        ))}
      </g>
      <text x={ROAD.x0} y={ROAD.top + ROAD.h + 14} className="sm ink3">
        與捷運重疊的幹線公車
        <tspan dx={8}>減班</tspan>
        <tspan className="num ink1" dx={4}>
          {fmtPct(c, 0)}
        </tspan>
      </text>

      {/* 冷區里（山坡）與 DRTS */}
      <path d={HILL} className="f-bg2 s-l3 w1" />
      {HOUSES.map(([x, y]) => (
        <path key={x} d={`M${x - 5} ${y + 1} V${y - 6} L${x} ${y - 10} L${x + 5} ${y - 6} V${y + 1} Z`} className="f-bg3 s-ink4 w1" />
      ))}
      <text x={436} y={78} className="sm mid ink2">
        冷區里
      </text>
      <path d={`M${P0[0]} ${P0[1]} Q${PC[0]} ${PC[1]} ${P1[0]} ${P1[1]}`} className="s-d5 w1 f-none a-flow" strokeDasharray="3 3" />
      <text x={334} y={46} className="sm mid ink2">
        DRTS 預約接駁
      </text>
      <g style={{ animation: `${uid}-ride ${VAN_T}s linear infinite` }}>
        <Elder x={391} y={101.5} scale={0.85} />
        <Elder x={402} y={97.5} scale={0.85} />
      </g>
      <g style={{ transform: `translate(${P1[0]}px,${P1[1]}px)`, animation: `${uid}-van ${VAN_T}s linear infinite` }}>
        <Van />
      </g>

      {/* 駕駛班表 */}
      <text x={SHIFT.x0} y={SHIFT.top - 8} className="sm">
        <tspan className="ink1">駕駛班表</tspan>
        <tspan className="ink3" dx={8}>
          連續駕駛 4 小時，休息 30 分鐘
        </tspan>
      </text>
      {SEGMENTS.map(([a, b, rest]) => (
        <rect
          key={a}
          x={hx(a)}
          y={SHIFT.top}
          width={hx(b) - hx(a)}
          height={SHIFT.h}
          className={rest ? 's-ink3 w1' : 'f-d5'}
          fill={rest ? `url(#${uid}-rest)` : undefined}
          fillOpacity={rest ? undefined : 0.75}
        />
      ))}
      <text x={hx(4.25)} y={SHIFT.top + SHIFT.h + 13} className="sm mid ink2">
        休息
      </text>
      {[0, 2, 6].map((h) => (
        <text key={h} x={hx(h)} y={SHIFT.top + SHIFT.h + 13} className="num sm mid ink3">
          {h}
        </text>
      ))}
      <text x={hx(10)} y={SHIFT.top + SHIFT.h + 13} className="num sm end ink3">
        10 h
      </text>
      <g style={{ '--run': `${SHIFT.w}px` } as CSSProperties} className="a-scan">
        <line x1={SHIFT.x0} y1={SHIFT.top - 3} x2={SHIFT.x0} y2={SHIFT.top + SHIFT.h + 3} className="s-ink1 w15" />
      </g>

      {/* 圖例 */}
      <g transform="translate(14 229)">
        <g transform="translate(0 -8)">
          <BusIcon />
        </g>
        <text x={27} y={0} className="sm ink3">
          幹線公車
        </text>
        <g transform="translate(86 0)">
          <Van />
        </g>
        <text x={100} y={0} className="sm ink3">
          DRTS 小巴
        </text>
        <rect x={160} y={-9} width={12} height={10} fill={`url(#${uid}-rest)`} className="s-ink3 w1" />
        <text x={176} y={0} className="sm ink3">
          駕駛休息
        </text>
      </g>

      {/* 讀數：冷區里補足比例 */}
      <text x={326} y={191} className="sm end ink4">
        每格 {fmtNum(coldTotal / cells, 0)} 里
      </text>
      {Array.from({ length: cells }, (_, k) => (
        <rect key={k} x={332 + k * 14} y={182} width={10} height={10} className={k < filled ? 'f-d5' : 'f-none s-l3 w1'} />
      ))}
      {savedVkm != null && (
        <text x={468} y={214} className="end sm ink3">
          每日省下
          <tspan className="num ink1" dx={4}>
            {fmtWan(savedVkm)}
          </tspan>
          <tspan dx={3}>車公里</tspan>
        </text>
      )}
      <text x={468} y={231} className="end">
        <tspan className="ink3">補足</tspan>
        <tspan className="num ink1 lg b" dx={6}>
          {fmtInt(served)}
        </tspan>
        <tspan className="num ink2" dx={3}>
          / {fmtInt(coldTotal)}
        </tspan>
        <tspan className="ink3" dx={4}>
          個冷區里
        </tspan>
      </text>
    </Schem>
  )
}
