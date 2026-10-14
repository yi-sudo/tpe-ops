// 06 耐震：液化潛勢土層上的一排建物，地震波週期性傳上來，老舊建物搖晃；
// 依優先序先健檢、補強長者多的老舊建物（打上斜撐與「已健檢」），補強後不再搖晃。
import { fmtPct } from '../lib/format'
import { Schem, clamp, useUid } from './common'

export interface SeismicProps {
  /** 優先檢查的里占比（0–1） */
  inspected: number
  /** 涵蓋的液化區長者比例（0–1） */
  captured: number
}

const GROUND = 170
const SOIL_H = 36
/** [x, 寬, 高, 是否老舊, 長者住戶數] */
const BUILDINGS: [number, number, number, boolean, number][] = [
  [28, 40, 70, true, 2],
  [76, 34, 96, false, 0],
  [118, 44, 60, true, 3],
  [170, 36, 84, true, 1],
  [214, 48, 104, false, 1],
  [270, 40, 56, true, 4],
  [318, 36, 78, true, 0],
  [362, 44, 66, true, 2],
  [414, 40, 92, false, 0],
]
/** 健檢優先序：老舊建物依長者住戶數排 */
const PRIORITY = BUILDINGS.map((b, i) => [b, i] as const)
  .filter(([b]) => b[3])
  .sort((a, b) => b[0][4] - a[0][4] || a[1] - b[1])
  .map(([, i]) => i)

function Resident({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y - 1.6} r={1.5} className="f-ink1" />
      <path d={`M${x - 2.6} ${y + 3.4} Q${x} ${y + 0.2} ${x + 2.6} ${y + 3.4}`} className="s-ink1 w1 f-none" />
    </g>
  )
}

function Building({ b, braced }: { b: (typeof BUILDINGS)[number]; braced: boolean }) {
  const [x, w, h, old, elders] = b
  const top = GROUND - h
  const cols = Math.max(1, Math.floor((w - 8) / 10))
  const rows = Math.max(1, Math.floor((h - 12) / 14))
  const x0 = x + (w - (cols * 10 - 3)) / 2
  const wins: [number, number][] = []
  for (let r = rows - 1; r >= 0; r--) for (let c = 0; c < cols; c++) wins.push([x0 + c * 10, top + 8 + r * 14])
  return (
    <g>
      <rect x={x} y={top} width={w} height={h} className={old ? 'f-bg3 s-ink4 w1' : 'f-bg2 s-l3 w1'} />
      {wins.map(([wx, wy], k) => (
        <g key={k}>
          <rect x={wx} y={wy} width={7} height={9} className="f-bg1" />
          {k < elders && <Resident x={wx + 3.5} y={wy + 4.5} />}
        </g>
      ))}
      {old && !braced && (
        <path
          d={`M${x + w * 0.62} ${top + 3} l-4 ${h * 0.14} l5 ${h * 0.1} l-6 ${h * 0.16} l4 ${h * 0.12}`}
          className="s-ink3 w1 f-none round"
        />
      )}
      {braced && (
        <g className="s-d6 w15 f-none">
          <rect x={x + 1} y={top + 1} width={w - 2} height={h - 2} />
          <path d={`M${x + 1} ${top + 1} L${x + w - 1} ${GROUND - 1} M${x + w - 1} ${top + 1} L${x + 1} ${GROUND - 1}`} />
        </g>
      )}
    </g>
  )
}

export default function Seismic({ inspected, captured }: SeismicProps) {
  const uid = useUid('seis')
  const share = clamp(inspected)
  const nBraced = share > 0 ? Math.max(1, Math.round(PRIORITY.length * share)) : 0
  const braced = new Set(PRIORITY.slice(0, nBraced))

  return (
    <Schem
      code="06"
      name="耐震"
      label={`耐震示意：地震時液化區上的老舊建物搖晃；優先檢查 ${fmtPct(share)} 的里，涵蓋 ${fmtPct(captured)} 的液化區長者，健檢補強後不再搖晃`}
      defs={
        <>
          <pattern id={`${uid}-liq`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={6} className="s-d6 w1" strokeOpacity={0.55} />
          </pattern>
          <clipPath id={`${uid}-soil`}>
            <rect x={14} y={GROUND} width={452} height={SOIL_H} />
          </clipPath>
        </>
      }
    >
      {/* 圖例 */}
      <g transform="translate(270 18)">
        <rect x={0} y={-8} width={10} height={9} className="f-bg3 s-ink4 w1" />
        <text x={14} y={0} className="sm ink3">
          老舊
        </text>
        <rect x={42} y={-8} width={10} height={9} className="f-bg2 s-l3 w1" />
        <text x={56} y={0} className="sm ink3">
          較新
        </text>
        <path d="M84 -8 L94 1 M94 -8 L84 1" className="s-d6 w15" />
        <rect x={84} y={-8} width={10} height={9} className="s-d6 w1 f-none" />
        <text x={98} y={0} className="sm ink3">
          已健檢補強
        </text>
        <rect x={155} y={-8} width={9} height={10} className="f-bg1" />
        <Resident x={159.5} y={-3} />
        <text x={168} y={0} className="sm ink3">
          長者住戶
        </text>
      </g>

      {/* 液化潛勢土層與地震波 */}
      <rect x={14} y={GROUND} width={452} height={SOIL_H} className="f-bg2" />
      <rect x={14} y={GROUND} width={452} height={SOIL_H} fill={`url(#${uid}-liq)`} />
      <g clipPath={`url(#${uid}-soil)`}>
        {[0, 0.35, 0.7].map((d) => (
          <circle key={d} cx={240} cy={GROUND + SOIL_H + 30} r={120} className="s-d6 w15 f-none a-wave" style={{ animationDelay: `${d}s` }} />
        ))}
      </g>
      <rect x={20} y={GROUND + 11} width={84} height={15} className="f-bg1" opacity={0.85} />
      <text x={24} y={GROUND + 22} className="sm ink2">
        土壤液化潛勢區
      </text>

      {/* 建物 */}
      {BUILDINGS.map((b, i) => {
        const sway = b[3] && !braced.has(i)
        return (
          <g key={i} className={sway ? 'a-sway' : undefined} style={sway ? { animationDelay: `${(i % 3) * 0.06}s` } : undefined}>
            <Building b={b} braced={braced.has(i)} />
          </g>
        )
      })}
      <line x1={14} y1={GROUND} x2={466} y2={GROUND} className="s-l3 w1" />
      {BUILDINGS.map(([x, w, h], i) =>
        braced.has(i) ? (
          <text key={i} x={x + w / 2} y={GROUND - h - 6} className="sm mid">
            <tspan className="f-d6">✓</tspan>
            <tspan className="ink1" dx={2}>
              已健檢
            </tspan>
          </text>
        ) : null,
      )}

      {/* 讀數 */}
      <text x={468} y={231} className="end">
        <tspan className="ink3">優先檢查</tspan>
        <tspan className="num ink1" dx={4}>
          {fmtPct(share)}
        </tspan>
        <tspan className="ink3" dx={3}>
          的里，涵蓋
        </tspan>
        <tspan className="num ink1 lg b" dx={4}>
          {fmtPct(captured)}
        </tspan>
        <tspan className="ink3" dx={3}>
          液化區長者
        </tspan>
      </text>
    </Schem>
  )
}
