import { useEffect, useState } from 'react'

export type Route =
  | { name: 'overview' }
  | { name: 'domain'; id: 1 | 2 | 3 | 4 | 5 | 6 }
  | { name: 'links' }
  | { name: 'lineage' }
  | { name: 'schem' }

export function parseHash(h: string): Route {
  const p = h.replace(/^#\/?/, '').split('/')
  if (p[0] === 'd') {
    const id = Number(p[1])
    if (id >= 1 && id <= 6) return { name: 'domain', id: id as 1 | 2 | 3 | 4 | 5 | 6 }
  }
  if (p[0] === 'links') return { name: 'links' }
  if (p[0] === 'lineage') return { name: 'lineage' }
  if (p[0] === 'schem') return { name: 'schem' }
  return { name: 'overview' }
}

export const href = (r: Route): string =>
  r.name === 'domain' ? `#/d/${r.id}` : r.name === 'overview' ? '#/' : `#/${r.name}`

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (r: Route) => {
  window.location.hash = href(r)
}
