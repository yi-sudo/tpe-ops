// App-wide state: the selected 里 and the impact scenario (shared by 總覽 and the six modules).
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface Scenario {
  /** 01 補植棵數 */
  trees: number
  /** 02 新增清潔箱 */
  bins: number
  /** 02 清運模式 */
  binMode: 'fixed' | 'dynamic'
  /** 03 集中防治面積比例 0–1 */
  ratArea: number
  /** 04 彈性工時參與率：07:45–09:00 車流移出的比例 0–1 */
  shift: number
  /** 04 減量：每個時段進入內湖的車流減少的比例 0–1（交通車、共乘、轉乘） */
  carCut: number
  /** 05 高重疊路線減班比例 0–1 */
  cut: number
  /** 06 優先健檢的里數 */
  inspect: number
}

export const DEFAULT_SCENARIO: Scenario = {
  trees: 3000,
  bins: 100,
  binMode: 'dynamic',
  ratArea: 0.2,
  shift: 0.05,
  carCut: 0.05,
  cut: 0.2,
  inspect: 50,
}

interface AppState {
  selected: number | null
  select: (i: number | null) => void
  scenario: Scenario
  setScenario: (patch: Partial<Scenario>) => void
  resetScenario: () => void
}

const Ctx = createContext<AppState | null>(null)

export function StateProvider({ children }: { children: ReactNode }) {
  const [selected, select] = useState<number | null>(null)
  const [scenario, setS] = useState<Scenario>(DEFAULT_SCENARIO)
  const setScenario = useCallback((patch: Partial<Scenario>) => setS((s) => ({ ...s, ...patch })), [])
  const resetScenario = useCallback(() => setS(DEFAULT_SCENARIO), [])
  const value = useMemo(() => ({ selected, select, scenario, setScenario, resetScenario }), [selected, scenario, setScenario, resetScenario])
  return createElement(Ctx.Provider, { value }, children)
}

export function useAppState(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('StateProvider missing')
  return v
}
