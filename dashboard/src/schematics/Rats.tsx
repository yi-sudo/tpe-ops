// 03 鼠患：餐廳 → 垃圾袋／清運點 → 雨水人孔 → 老鼠 的成因鏈；風險集中在少數街區，框起來集中防治，老鼠（通報）跟著減少。
import { fmtDeltaPct, fmtPct } from '../lib/format'
import type { CSSProperties } from 'react'
import { Schem, clamp, useUid } from './common'

export interface RatsProps {
  /** 集中防治的面積比例（0–1，依風險由高到低） */
  treatedArea: number
  /** 預估見鼠通報減少比例（0–1） */
  reduction: number
  /** 防治範圍涵蓋的風險比例（0–1，可省略） */
  captured?: number
}

const STRIP = { x: 24, y: 112, w: 432, h: 76 }
/** 老鼠出沒點（依風險排序，越左越高） */
const HOMES: [number, number][] = [
  [36, 128],
  [52, 168],
  [66, 146],
  [80, 124],
  [94, 176],
  [110, 152],
  [128, 132],
  [146, 170],
  [172, 148],
  [204, 126],
  [240, 174],
  [292, 140],
  [352, 164],
  [420, 132],
]
const SHOPS = [30, 40, 50, 60, 70, 82, 96, 112, 130, 152, 180, 214, 256, 310, 380, 444]
const MANHOLES = [44, 88, 138, 200, 290, 400]

function Rat() {
  return (
    <g>
      <path d="M-6 0.5 q-5 -0.5 -8.5 -5" className="s-d3 f-none w1 round" />
      <ellipse cx={0} cy={0} rx={6.2} ry={3.6} className="f-d3" />
      <circle cx={6} cy={-1} r={2.7} className="f-d3" />
      <circle cx={4.8} cy={-3.8} r={1.5} className="f-d3" />
    </g>
  )
}

/** 成因鏈節點圖示，原點在框中心 */
function NodeIcon({ kind }: { kind: number }) {
  switch (kind) {
    case 0: // 餐廳：碗 + 熱氣
      return (
        <g className="s-ink2 f-none w15 round">
          <path d="M-10 0 H10 A10 8 0 0 1 -10 0 Z" />
          <path d="M-3 -4 q2 -2.5 0 -5 M3 -4 q2 -2.5 0 -5" className="w1" />
        </g>
      )
    case 1: // 垃圾袋
      return (
        <g className="s-ink2 f-none w15 round">
          <path d="M-7 9 Q-11 -1 -4 -4 L-2 -7 H2 L4 -4 Q11 -1 7 9 Z" />
          <path d="M-3 -7 L-5 -10 M3 -7 L5 -10" className="w1" />
        </g>
      )
    case 2: // 雨水人孔
      return (
        <g className="s-ink2 f-none w15">
          <circle r={10} />
          <path d="M-8 -4 H8 M-9.6 0 H9.6 M-8 4 H8" className="w1" />
        </g>
      )
    default:
      return (
        <g transform="translate(2 2) scale(1.25)">
          <Rat />
        </g>
      )
  }
}

const CHAIN = [
  { x: 70, label: '餐廳' },
  { x: 180, label: '垃圾袋 · 清運點' },
  { x: 290, label: '雨水人孔' },
  { x: 400, label: '老鼠' },
]
const CHAIN_LINKS = ['廚餘', '覓食', '棲身']

export default function Rats({ treatedArea, reduction, captured }: RatsProps) {
  const uid = useUid('rats')
  const area = clamp(treatedArea)
  const frameW = Math.max(14, STRIP.w * area)
  const nGone = Math.round(HOMES.length * clamp(reduction))
  // 被防治掉的老鼠：先挑框內、間隔挑，不夠再往右補
  const inside = HOMES.map((h, i) => [h, i] as const).filter(([[x]]) => x < STRIP.x + frameW).map(([, i]) => i)
  const order = [...inside.filter((_, j) => j % 2 === 0), ...inside.filter((_, j) => j % 2 === 1), ...HOMES.map((_, i) => i).filter((i) => !inside.includes(i))]
  const gone = new Set(order.slice(0, nGone))

  return (
    <Schem
      code="03"
      name="鼠患"
      label={`鼠患示意：餐廳、垃圾清運點、雨水人孔構成老鼠的食物與棲身鏈；集中防治 ${fmtPct(area, 0)} 高風險面積，預估見鼠通報 ${fmtDeltaPct(-reduction)}`}
      defs={
        <linearGradient id={`${uid}-risk`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--d3)" stopOpacity={0.3} />
          <stop offset="0.45" stopColor="var(--d3)" stopOpacity={0.08} />
          <stop offset="1" stopColor="var(--d3)" stopOpacity={0} />
        </linearGradient>
      }
    >
      {/* 成因鏈 */}
      {CHAIN.map((n, i) => (
        <g key={n.label}>
          <rect x={n.x - 22} y={32} width={44} height={36} rx={2} className="f-bg2 s-l3 w1" />
          <g transform={`translate(${n.x} 51)`}>
            <NodeIcon kind={i} />
          </g>
          <text x={n.x} y={84} className="mid ink2">
            {n.label}
          </text>
          {i < CHAIN.length - 1 && (
            <g>
              <line x1={n.x + 27} y1={50} x2={CHAIN[i + 1].x - 30} y2={50} className="s-ink3 w1 a-flow" strokeDasharray="4 3" />
              <path d={`M${CHAIN[i + 1].x - 30} 46.5 L${CHAIN[i + 1].x - 25} 50 L${CHAIN[i + 1].x - 30} 53.5`} className="s-ink3 w1 f-none" />
              <text x={(n.x + CHAIN[i + 1].x) / 2} y={44} className="sm mid ink3">
                {CHAIN_LINKS[i]}
              </text>
            </g>
          )}
        </g>
      ))}

      {/* 街區：風險由左（高）到右（低） */}
      <rect x={STRIP.x} y={STRIP.y} width={STRIP.w} height={STRIP.h} className="f-bg2" />
      <rect x={STRIP.x} y={STRIP.y} width={STRIP.w} height={STRIP.h} fill={`url(#${uid}-risk)`} />
      {SHOPS.map((x) => (
        <rect key={x} x={x} y={STRIP.y + 2} width={5} height={5} className="f-ink4" />
      ))}
      {MANHOLES.map((x) => (
        <g key={x} transform={`translate(${x} ${STRIP.y + STRIP.h - 6})`}>
          <circle r={3.5} className="f-none s-ink4 w1" />
          <line x1={-3.5} x2={3.5} className="s-ink4 w1" />
        </g>
      ))}

      {/* 老鼠：防治掉的變成 × */}
      {HOMES.map(([x, y], i) =>
        gone.has(i) ? (
          <g key={`x${i}`} transform={`translate(${x} ${y})`}>
            <path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" className="s-ink4 w15 round a-pop" />
          </g>
        ) : (
          <g key={`r${i}`} transform={`translate(${x} ${y})${i % 2 ? ' scale(-1 1)' : ''}`}>
            <g
              className="a-scurry"
              style={
                {
                  '--dx': `${8 + ((i * 5) % 11)}px`,
                  animationDuration: `${2.6 + ((i * 7) % 10) * 0.17}s`,
                  animationDelay: `${-((i * 13) % 10) * 0.31}s`,
                } as CSSProperties
              }
            >
              <Rat />
            </g>
          </g>
        ),
      )}

      {/* 集中防治框 */}
      <rect x={STRIP.x} y={STRIP.y - 4} width={frameW} height={STRIP.h + 8} className="f-d3 s-d3 w15" fillOpacity={0.06} strokeDasharray="5 3" />
      <text x={STRIP.x + 2} y={STRIP.y - 9}>
        <tspan className="ink1">集中防治</tspan>
        <tspan className="ink3 sm" dx={6}>
          前
        </tspan>
        <tspan className="num ink1 sm" dx={3}>
          {fmtPct(area, 0)}
        </tspan>
        <tspan className="ink3 sm" dx={3}>
          高風險面積
        </tspan>
      </text>
      <text x={STRIP.x + STRIP.w} y={STRIP.y - 9} className="sm end ink3">
        街區依風險排序：高 → 低
      </text>

      {/* 圖例 */}
      <g transform="translate(14 229)">
        <g transform="translate(14 -4)">
          <Rat />
        </g>
        <text x={26} y={0} className="sm ink3">
          老鼠
        </text>
        <path d="M60.5 -7.5 L67.5 -0.5 M67.5 -7.5 L60.5 -0.5" className="s-ink4 w15 round" />
        <text x={72} y={0} className="sm ink3">
          防治後減少
        </text>
        <rect x={132} y={-9} width={14} height={10} className="f-d3 s-d3 w1" fillOpacity={0.06} strokeDasharray="3 2" />
        <text x={150} y={0} className="sm ink3">
          集中防治範圍
        </text>
      </g>

      {/* 讀數 */}
      {captured != null && (
        <text x={468} y={214} className="end sm ink3">
          涵蓋
          <tspan className="num ink1" dx={4}>
            {fmtPct(captured)}
          </tspan>
          <tspan dx={3}>的風險</tspan>
        </text>
      )}
      <text x={468} y={231} className="end">
        <tspan className="ink3">預估見鼠通報</tspan>
        <tspan className="num ink1 lg b" dx={6}>
          {fmtDeltaPct(-reduction)}
        </tspan>
      </text>
    </Schem>
  )
}
