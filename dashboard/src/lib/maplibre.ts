// MapLibre v6 finds its worker relative to its own module URL, which breaks once Vite pre-bundles the
// package into node_modules/.vite/deps. Point it at a Vite-built worker so it works in dev and in build.
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
