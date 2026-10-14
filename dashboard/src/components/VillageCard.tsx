// Object card for one 里: who lives there + the six domain scores (0–100, tick at the hot threshold).
import type { ReactNode } from 'react'
import { DOMAINS } from '../lib/domains'
import { fmtInt, fmtNum, fmtPct } from '../lib/format'
import type { VillageProps } from '../lib/types'
import { IconClose } from './Icons'

export const HOT = 75

export function VillageCard({ p, onClose, onDomain, focusDomain, rows, foot }: {
  p: VillageProps
  onClose: () => void
  onDomain?: (id: number) => void
  focusDomain?: number
  rows?: { k: ReactNode; v: ReactNode }[]
  foot?: ReactNode
}) {
  return (
    <div className="insp" role="dialog" aria-label={`${p.d}${p.v}`}>
      <div className="insp-h">
        <div>
          <div className="insp-kind">VILLAGE · 里 <span className="num">#{p.id}</span></div>
          <div className="insp-name">
            {p.v}
            <small>{p.d}</small>
          </div>
        </div>
        <button className="insp-close" onClick={onClose} aria-label="關閉" title="關閉（Esc）">
          <IconClose size={14} />
        </button>
      </div>
      <div className="insp-facts">
        <div className="insp-fact">
          <div className="k">人口</div>
          <div className="v num">{fmtInt(p.pop)}</div>
        </div>
        <div className="insp-fact">
          <div className="k">65 歲以上</div>
          <div className="v num">{fmtPct(p.r65)}</div>
        </div>
        <div className="insp-fact">
          <div className="k">綜合分數</div>
          <div className="v num">{fmtNum(p.f, 1)}</div>
        </div>
      </div>
      <div className="insp-scores">
        {DOMAINS.map((d) => {
          const s = p[d.score]
          return (
            <button key={d.id} className="insp-score" style={{ ['--c' as string]: d.color, opacity: focusDomain && focusDomain !== d.id ? 0.55 : 1 }}
              onClick={() => onDomain?.(d.id)} title={`${d.scoreLabel}：${s == null ? '無資料' : fmtNum(s, 1)}${onDomain ? '（點擊開啟模組）' : ''}`}>
              <span className="code num">{d.code}</span>
              <span>{d.short}</span>
              <span className="track">
                {s != null && <i style={{ width: `${Math.max(1, s)}%` }} />}
                <b />
              </span>
              <span className="v num">
                {s == null ? '—' : fmtInt(s)}
              </span>
            </button>
          )
        })}
        <div className="insp-legend">
          <span>分數 = 全市百分位加權（0–100）</span>
          <span><i className="insp-tick" />熱點門檻 {HOT}</span>
        </div>
      </div>
      {rows && rows.length > 0 && (
        <div className="insp-rows">
          {rows.map((r, k) => (
            <div key={k} className="insp-row">
              <span className="k">{r.k}</span>
              <span className="v num">{r.v}</span>
            </div>
          ))}
        </div>
      )}
      {foot && <div className="insp-foot">{foot}</div>}
    </div>
  )
}
