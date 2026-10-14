// 示意圖庫（#/schem）：六張示意圖並排，數值用 impact.json 的成效模型算，拖拉滑桿即時預覽。
import { useState, type ReactNode } from 'react'
import { useCatalog, useData } from '../lib/data'
import { DOMAINS } from '../lib/domains'
import { fmtDateTime, fmtInt, fmtPct } from '../lib/format'
import { impact1, impact2, impact3, impact4, impact5, impact6 } from '../lib/impact'
import type { Impact } from '../lib/types'
import { BinsSchematic, BusSchematic, RatsSchematic, SeismicSchematic, ShadeSchematic, TrafficSchematic } from './index'

interface CardProps {
  id: number
  label: string
  value: string
  min: number
  max: number
  step: number
  current: number
  onChange: (v: number) => void
  extra?: ReactNode
  children: ReactNode
}

function Card({ id, label, value, min, max, step, current, onChange, extra, children }: CardProps) {
  const d = DOMAINS[id - 1]
  return (
    <section className="sc-card">
      <header className="sc-card-head">
        <span className="sc-card-sw" style={{ background: d.color }} />
        <span className="sc-card-code">{d.code}</span>
        <span className="sc-card-title">{d.title}</span>
      </header>
      <div className="sc-card-body">{children}</div>
      <label className="sc-ctrl">
        <span>{label}</span>
        <input type="range" min={min} max={max} step={step} value={current} onChange={(e) => onChange(Number(e.target.value))} />
        <output>{value}</output>
      </label>
      {extra}
    </section>
  )
}

export default function Gallery() {
  const I = useData<Impact>('impact.json')
  const catalog = useCatalog()
  const [trees, setTrees] = useState(3000)
  const [k2, setK2] = useState(100)
  const [mode, setMode] = useState<'fixed' | 'dynamic'>('dynamic')
  const [area, setArea] = useState(0.2)
  const [shift, setShift] = useState(0.05)
  const [cut, setCut] = useState(0.2)
  const [k6, setK6] = useState(50)

  if (!I) return <div className="sc-gallery loading">LOADING</div>

  const r1 = impact1(I, trees)
  const r2 = impact2(I, k2)
  const r3 = impact3(I, area)
  const r4 = impact4(I, shift)
  const r5 = impact5(I, cut)
  const r6 = impact6(I, k6)
  const P = I['4'].params

  return (
    <div className="sc-gallery">
      <div className="sc-gallery-head">
        <h1>示意圖庫</h1>
        <p>
          六個題目的 SVG 動畫示意圖；數值由 impact.json 的成效模型計算（建置時間 {fmtDateTime(catalog?.built_at)}）。
          清潔箱水位{I['4'].profile.is_mock ? '與內湖晨峰曲線' : ''}為模擬資料，圖上另標「模擬資料」。
        </p>
      </div>
      <div className="sc-grid">
        <Card id={1} label="新植株數" value={`${fmtInt(trees)} 株`} min={0} max={r1.maxTrees} step={100} current={trees} onChange={setTrees}>
          <ShadeSchematic baseShade={r1.before.shade} shade={r1.after.shade} addedTrees={trees} maxTrees={r1.maxTrees} />
        </Card>
        <Card
          id={2}
          label="新增清潔箱"
          value={`${fmtInt(k2)} 個`}
          min={0}
          max={r2.maxK}
          step={10}
          current={k2}
          onChange={setK2}
          extra={
            <div className="sc-ctrl-extra">
              <span>清運方式</span>
              <span className="sc-seg">
                <button type="button" aria-pressed={mode === 'fixed'} onClick={() => setMode('fixed')}>
                  固定班表
                </button>
                <button type="button" aria-pressed={mode === 'dynamic'} onClick={() => setMode('dynamic')}>
                  依滿溢度調度
                </button>
              </span>
            </div>
          }
        >
          <BinsSchematic mode={mode} newBins={k2} covered={r2.covAfter} baseCovered={r2.covBefore} maxNew={r2.maxK} />
        </Card>
        <Card id={3} label="集中防治面積" value={fmtPct(area, 0)} min={0.02} max={1} step={0.02} current={area} onChange={setArea}>
          <RatsSchematic treatedArea={area} reduction={r3.reduction} captured={r3.captured} />
        </Card>
        <Card id={4} label="尖峰車流移到離峰" value={fmtPct(shift, 0)} min={0} max={0.3} step={0.01} current={shift} onChange={setShift}>
          <TrafficSchematic
            bins={r4.bins}
            vcBefore={r4.vcBefore}
            vcAfter={r4.vcAfter}
            speedBefore={r4.speedBefore}
            speedAfter={r4.speedAfter}
            reduction={r4.reduction}
            vFree={P.v_free}
            alpha={P.alpha}
            beta={P.beta}
            isMock={I['4'].profile.is_mock}
          />
        </Card>
        <Card id={5} label="重疊路線減班" value={fmtPct(cut, 0)} min={0} max={0.5} step={0.05} current={cut} onChange={setCut}>
          <BusSchematic cut={cut} villagesServed={r5.served} coldTotal={r5.cold} savedVkm={r5.vkmSaved} />
        </Card>
        <Card id={6} label="優先健檢里數" value={`${fmtInt(k6)} 個里`} min={5} max={r6.maxK} step={5} current={k6} onChange={setK6}>
          <SeismicSchematic inspected={r6.share} captured={r6.captured} />
        </Card>
      </div>
    </div>
  )
}
