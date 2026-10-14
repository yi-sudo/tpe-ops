// #/d/1–6：每題一個模組（src/views/domain/D*.tsx），共用 domain/Frame.tsx 的外框
import type { ComponentType } from 'react'
import { domain, type Domain, type DomainId } from '../lib/domains'
import D1 from './domain/D1Shade'
import D2 from './domain/D2Bins'
import D3 from './domain/D3Rats'
import D4 from './domain/D4Traffic'
import D5 from './domain/D5Bus'
import D6 from './domain/D6Seismic'

const MODULES: Record<DomainId, ComponentType<{ d: Domain }>> = { 1: D1, 2: D2, 3: D3, 4: D4, 5: D5, 6: D6 }

export default function DomainPage({ id }: { id: DomainId }) {
  const M = MODULES[id]
  return <M d={domain(id)} />
}
