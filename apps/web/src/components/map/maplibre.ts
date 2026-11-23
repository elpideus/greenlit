import * as maplibre from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// MapLibre finds its worker next to its own module; Vite's dependency bundle moves the module, so point at the worker
// file explicitly (Vite serves and fingerprints it).
maplibre.setWorkerUrl(workerUrl)

export type { GeoJSONSource, LngLatBounds, Map as MaplibreMap, Marker, StyleSpecification } from 'maplibre-gl'
export { maplibre }
