import { lazy, Suspense, type ComponentType } from 'react'
import { NavRail, StatusBar, TopBar } from './components/Shell'
import { LiveProvider } from './lib/data'
import { useRoute } from './lib/router'
import { StateProvider } from './lib/state'
import Overview from './views/Overview'
import DomainPage from './views/DomainPage'
import Links from './views/Links'
import Lineage from './views/Lineage'

// The schematic gallery is a dev page (#/schem); loaded lazily so a missing file never breaks the app.
const galleryMods = import.meta.glob('./schematics/Gallery.tsx')
const Gallery = lazy(async () => {
  const m = galleryMods['./schematics/Gallery.tsx']
  if (!m) return { default: () => <div className="loading">示意圖尚未完成</div> }
  return (await m()) as { default: ComponentType }
})

export default function App() {
  const route = useRoute()
  let view
  switch (route.name) {
    case 'domain':
      view = <DomainPage key={route.id} id={route.id} />
      break
    case 'links':
      view = <Links />
      break
    case 'lineage':
      view = <Lineage />
      break
    case 'schem':
      view = (
        <Suspense fallback={<div className="loading">LOADING</div>}>
          <Gallery />
        </Suspense>
      )
      break
    default:
      view = <Overview />
  }
  return (
    <LiveProvider>
      <StateProvider>
        <div className="app">
          <TopBar route={route} />
          <NavRail route={route} />
          <main className="main">{view}</main>
          <StatusBar />
        </div>
      </StateProvider>
    </LiveProvider>
  )
}
