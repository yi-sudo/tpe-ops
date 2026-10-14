// 01 樹蔭：人行道上補植行道樹，遮蔭帶變長、曝曬路段變少，長者走在樹蔭下。
import { fmtInt, fmtPct } from '../lib/format'
import { Change, Elder, Schem, clamp } from './common'

export interface ShadeProps {
  /** 現況人行道遮蔭率（0–1） */
  baseShade: number
  /** 補植後遮蔭率（0–1） */
  shade: number
  /** 新植株數 */
  addedTrees: number
  /** 畫滿 6 棵新樹時對應的株數（預設 5000，與成效曲線上限一致） */
  maxTrees?: number
}

const GROUND = 186
const SLOT_W = 34
const SLOTS = 12
const EXISTING = [0, 3, 6, 10]
const NEW_ORDER = [8, 1, 4, 11, 2, 9] // 先補在最長的曝曬路段
const cx = (i: number) => 50 + SLOT_W * i

function Tree({ i, fresh }: { i: number; fresh?: boolean }) {
  const x = cx(i)
  return (
    <g className={fresh ? 'a-pop' : undefined}>
      <line x1={x} y1={GROUND} x2={x} y2={156} className="s-ink4 w15" />
      <circle cx={x} cy={144} r={14} className={fresh ? 'f-d1 s-d1 w15 dash' : 'f-d1'} fillOpacity={fresh ? 0.22 : 0.9} />
      {fresh && (
        <text x={x} y={124} className="sm mid ink2">
          新植
        </text>
      )}
    </g>
  )
}

export default function Shade({ baseShade, shade, addedTrees, maxTrees = 5000 }: ShadeProps) {
  const nNew = addedTrees > 0 ? Math.max(1, Math.round(clamp(addedTrees / maxTrees) * NEW_ORDER.length)) : 0
  const fresh = NEW_ORDER.slice(0, nNew)
  const shaded = new Set([...EXISTING, ...fresh])
  const sunny = Array.from({ length: SLOTS }, (_, i) => i).filter((i) => !shaded.has(i))

  return (
    <Schem
      code="01"
      name="樹蔭"
      label={`樹蔭示意：新植 ${fmtInt(addedTrees)} 株，人行道遮蔭率由 ${fmtPct(baseShade)} 提升到 ${fmtPct(shade)}`}
    >
      {/* 太陽與光線 */}
      {[120, 230, 330].map((x) => (
        <line key={x} x1={428} y1={60} x2={x} y2={GROUND - 4} className="s-ink4 w1 a-flow" strokeDasharray="2 6" opacity={0.7} />
      ))}
      <g transform="translate(440 48)">
        <g className="a-spin">
          {Array.from({ length: 12 }, (_, k) => {
            const a = (k * Math.PI) / 6
            return <line key={k} x1={Math.cos(a) * 16} y1={Math.sin(a) * 16} x2={Math.cos(a) * 21} y2={Math.sin(a) * 21} className="s-ink3 w15 round" />
          })}
        </g>
        <circle r={11} className="f-bg2 s-ink2 w15" />
      </g>

      {/* 人行道、車道與遮蔭帶 */}
      <rect x={24} y={GROUND} width={432} height={10} className="f-bg3" />
      <rect x={24} y={GROUND + 11} width={432} height={8} className="f-bg2" />
      <line x1={24} y1={GROUND + 10.5} x2={456} y2={GROUND + 10.5} className="s-l3 w1" />
      {[...shaded].map((i) => (
        <rect key={i} x={cx(i) - SLOT_W / 2} y={GROUND} width={SLOT_W} height={10} className={`f-d1${fresh.includes(i) ? ' a-pop' : ''}`} fillOpacity={0.38} />
      ))}

      {/* 曝曬路段的熱氣 */}
      {sunny.map((i) =>
        [-6, 5].map((dx, k) => (
          <path
            key={`${i}-${k}`}
            d={`M${cx(i) + dx} ${GROUND - 3} q2.5 -3 0 -6 q-2.5 -3 0 -6`}
            className="s-ink3 w1 f-none a-heat"
            style={{ animationDelay: `${((i * 7 + k * 5) % 10) * 0.26}s` }}
          />
        )),
      )}

      {EXISTING.map((i) => (
        <Tree key={i} i={i} />
      ))}
      {fresh.map((i) => (
        <Tree key={i} i={i} fresh />
      ))}

      {/* 長者慢慢走過 */}
      {[0, 1].map((k) => (
        <g key={k} transform={`translate(0 ${GROUND})`}>
          <g className="a-walk" style={{ animationDelay: `${-8 - k * 27}s`, transform: `translateX(${130 + k * 170}px)` }}>
            <g className="a-bob" style={{ animationDelay: `${-k * 0.4}s` }}>
              <Elder x={0} y={0} />
            </g>
          </g>
        </g>
      ))}

      {/* 圖例 */}
      <g transform="translate(14 229)">
        <circle cx={4} cy={-3.5} r={4.5} className="f-d1" />
        <text x={13} y={0} className="sm ink3">
          現有行道樹
        </text>
        <circle cx={76} cy={-3.5} r={4.5} className="f-d1 s-d1 w1 dash" fillOpacity={0.22} />
        <text x={85} y={0} className="sm ink3">
          新植
        </text>
        <rect x={113} y={-7.5} width={14} height={8} className="f-d1" fillOpacity={0.38} />
        <text x={131} y={0} className="sm ink3">
          遮蔭
        </text>
        <path d="M163 1 q2.5 -3 0 -6 q-2.5 -3 0 -6" className="s-ink3 w1 f-none" transform="translate(0 1)" />
        <text x={170} y={0} className="sm ink3">
          曝曬路段
        </text>
      </g>

      {/* 讀數 */}
      <text x={468} y={214} className="end sm ink3">
        新植
        <tspan className="num ink1" dx={4}>
          {fmtInt(addedTrees)}
        </tspan>
        <tspan dx={3}>株</tspan>
      </text>
      <Change x={468} y={231} label="人行道遮蔭率" from={fmtPct(baseShade)} to={fmtPct(shade)} />
    </Schem>
  )
}
