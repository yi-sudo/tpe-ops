// 示意圖共用：SVG 外框、「示意圖」標籤、模擬資料標章、斜線底紋、長者圖示、狀態圖示、inline @keyframes。
import { useEffect, useId, useState, type ReactNode } from 'react'
import './schematics.css'

export const W = 480
export const H = 240

export const clamp = (x: number, lo = 0, hi = 1) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo)

/** SVG id 與 @keyframes 名稱都要合法，所以把 useId 的特殊字元拿掉 */
export function useUid(prefix: string): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, '')
}

export function useReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const on = () => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

/** 依 props 算出來的動畫：frames 是 [0–1 的時間比例, CSS 宣告] */
export function keyframes(name: string, frames: [number, string][]): string {
  return `@keyframes ${name}{${frames.map(([t, css]) => `${(clamp(t) * 100).toFixed(3)}%{${css}}`).join('')}}`
}

interface SchemProps {
  label: string
  code: string
  name: string
  defs?: ReactNode
  children: ReactNode
}

/** 每張示意圖的根：viewBox 480×240、<title> 在第一個、左上角「示意圖」標籤 */
export function Schem({ label, code, name, defs, children }: SchemProps) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="schem" role="img" aria-label={label}>
      <title>{label}</title>
      {defs && <defs>{defs}</defs>}
      <text x={12} y={18} className="sc-tag">
        示意圖 · {code} {name}
      </text>
      {children}
    </svg>
  )
}

/** 45° 斜線底紋 */
export function Hatch({ id, className = 's-ink4', size = 5 }: { id: string; className?: string; size?: number }) {
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1={0} y1={0} x2={0} y2={size} className={`${className} w1`} />
    </pattern>
  )
}

/** 「模擬資料」標章：虛線框 + 斜線底紋（hatchId 由呼叫端的 <Hatch> 提供） */
export function MockBadge({ x, y, hatchId, w = 64 }: { x: number; y: number; hatchId: string; w?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={18} fill={`url(#${hatchId})`} className="sc-mock-box" />
      <text x={w / 2} y={12.5} className="sc-mock-text">
        模擬資料
      </text>
    </g>
  )
}

/** 長者（拄拐杖、微駝），原點在腳底，高約 19 */
export function Elder({ x, y, scale = 1, className = 's-ink2' }: { x: number; y: number; scale?: number; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <circle cx={2.2} cy={-16.2} r={2.4} className={className.replace('s-', 'f-')} />
      <path d="M1.2 -13.6 L-0.6 -6.6 M-0.6 -6.6 L-2.6 0 M-0.6 -6.6 L1.6 0 M0.8 -11.6 L4.6 -8.6 M4.6 -8.6 L5.6 0" className={`${className} f-none round`} strokeWidth={1.3} />
    </g>
  )
}

export type Status = 'good' | 'warning' | 'serious' | 'critical'
export const STATUS_ICON: Record<Status, string> = { good: '●', warning: '▲', serious: '◆', critical: '■' }

/** 狀態：圖示用狀態色、文字用 ink-1 */
export function StatusText({ x, y, status, label, anchor = 'start', blink = false }: { x: number; y: number; status: Status; label: string; anchor?: 'start' | 'middle' | 'end'; blink?: boolean }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="sm">
      <tspan className={`st-${status}${blink ? ' a-blink' : ''}`}>{STATUS_ICON[status]}</tspan>
      <tspan className="ink1" dx={3}>
        {label}
      </tspan>
    </text>
  )
}

/** 右下角的「指標 前 → 後」讀數 */
export function Change({ x, y, label, from, to }: { x: number; y: number; label: string; from: string; to: string }) {
  return (
    <text x={x} y={y} className="end">
      <tspan className="ink3">{label}</tspan>
      <tspan className="num ink2 lg" dx={6}>
        {from}
      </tspan>
      <tspan className="ink3" dx={4}>
        →
      </tspan>
      <tspan className="num ink1 lg b" dx={4}>
        {to}
      </tspan>
    </text>
  )
}
