// 16px stroke icons (currentColor). Domain icons always sit next to the domain code + label.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

export const IconOverview = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5" height="5" />
    <rect x="9" y="2" width="5" height="5" />
    <rect x="2" y="9" width="5" height="5" />
    <path d="M9 11.5h5M11.5 9v5" />
  </Svg>
)

export const IconTree = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.8c2.6 0 4.6 1.9 4.6 4.3 0 2.3-2 4.1-4.6 4.1S3.4 8.4 3.4 6.1C3.4 3.7 5.4 1.8 8 1.8Z" />
    <path d="M8 10.2V14.4M5.4 14.4h5.2M8 12l1.6-1.4" />
  </Svg>
)

export const IconBin = (p: P) => (
  <Svg {...p}>
    <path d="M2.8 4.4h10.4M6.2 4.4V2.6h3.6v1.8" />
    <path d="M4 4.4l.8 9.8h6.4l.8-9.8" />
    <path d="M6.6 6.8v5M9.4 6.8v5" />
  </Svg>
)

export const IconRat = (p: P) => (
  <Svg {...p}>
    <path d="M1.8 11.6c.4-3.3 2.9-5.4 6.1-5.4 2.6 0 4.7 1.6 4.9 3.8.1.9-.5 1.6-1.4 1.6H1.8Z" />
    <path d="M7.6 6.3c-.2-1.3.6-2.3 1.7-2.3s1.6 1 1.4 2.1" />
    <circle cx="10.6" cy="9" r=".45" fill="currentColor" stroke="none" />
    <path d="M12.6 11.2c1.4.1 1.9 1.4.9 2.6" />
  </Svg>
)

export const IconCar = (p: P) => (
  <Svg {...p}>
    <path d="M2.4 10.2V7.9l1.5-3.1h8.2l1.5 3.1v2.3" />
    <path d="M1.8 10.2h12.4v2H1.8z" />
    <path d="M4.2 12.2v1.4M11.8 12.2v1.4M2.4 7.9h11.2" />
  </Svg>
)

export const IconBus = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="1.8" width="10" height="10.6" rx="1.6" />
    <path d="M3 7.6h10M5.2 12.4v1.8M10.8 12.4v1.8M6 4.4h4" />
    <circle cx="5.4" cy="10" r=".5" fill="currentColor" stroke="none" />
    <circle cx="10.6" cy="10" r=".5" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconBuilding = (p: P) => (
  <Svg {...p}>
    <path d="M3.2 14.2V4.6L8.4 2v12.2M8.4 6h4.4v8.2" />
    <path d="M1.6 14.2h12.8" />
    <path d="M5.2 6.4h1.2M5.2 9h1.2M10 8.6h1.2M10 11h1.2" />
    <path d="M5.6 11.4l.8 1-.6 1" />
  </Svg>
)

export const IconLinks = (p: P) => (
  <Svg {...p}>
    <circle cx="3.6" cy="4" r="1.8" />
    <circle cx="12.4" cy="5" r="1.8" />
    <circle cx="7.4" cy="12.4" r="1.8" />
    <path d="M5.4 4.2l5.2.6M4.4 5.6l2.2 5.1M11.4 6.6l-3 4.2" />
  </Svg>
)

export const IconLineage = (p: P) => (
  <Svg {...p}>
    <rect x="1.4" y="2.4" width="4.2" height="3" />
    <rect x="1.4" y="10.6" width="4.2" height="3" />
    <rect x="10.4" y="6.5" width="4.2" height="3" />
    <path d="M5.6 3.9h2.2v8.2H5.6M7.8 8h2.6" />
  </Svg>
)

export const IconLive = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    <path d="M4.8 4.8a4.5 4.5 0 0 0 0 6.4M11.2 4.8a4.5 4.5 0 0 1 0 6.4" />
    <path d="M2.8 2.8a7.3 7.3 0 0 0 0 10.4M13.2 2.8a7.3 7.3 0 0 1 0 10.4" />
  </Svg>
)

export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.2 14 5.4 8 8.6 2 5.4 8 2.2Z" />
    <path d="M2 8.2l6 3.2 6-3.2M2 11l6 3.2 6-3.2" />
  </Svg>
)

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)

export const IconArrow = (p: P) => (
  <Svg {...p}>
    <path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" />
  </Svg>
)

export const IconCube = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5L8 1.8Z" />
    <path d="M2.4 5 8 8.2 13.6 5M8 8.2v6" />
  </Svg>
)

export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.4" />
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1v2.6M8 12.4V15M1 8h2.6M12.4 8H15" />
  </Svg>
)

/* status glyphs: shape differs per state so color is never the only cue */
export const StatusGlyph = ({ status, size = 10 }: { status: 'good' | 'warning' | 'serious' | 'critical' | 'idle'; size?: number }) => {
  const c = status === 'idle' ? 'var(--ink-4)' : `var(--${status})`
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" className="status-glyph">
      {status === 'good' && <circle cx="5" cy="5" r="4" fill={c} />}
      {status === 'warning' && <path d="M5 .8 9.4 9H.6Z" fill={c} />}
      {status === 'serious' && <path d="M5 .6 9.4 5 5 9.4.6 5Z" fill={c} />}
      {status === 'critical' && <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke={c} strokeWidth="2.2" strokeLinecap="round" />}
      {status === 'idle' && <circle cx="5" cy="5" r="3.4" fill="none" stroke={c} strokeWidth="1.4" />}
    </svg>
  )
}

export const DOMAIN_ICONS = [IconTree, IconBin, IconRat, IconCar, IconBus, IconBuilding]
