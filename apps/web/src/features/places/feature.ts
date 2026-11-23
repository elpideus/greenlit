import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'
import { PlacesPaletteResults } from './PlacesPaletteResults'
import { MediaPlaces, ProjectPlaces } from './PlacesSection'

export default defineFeature({
  id: 'places',
  locales: { en, it },
  slots: {
    'media.info.sections': [{ id: 'places', order: 40, component: MediaPlaces, permission: 'places.read' }],
    'project.about.sections': [
      { id: 'places', order: 20, component: ProjectPlaces, permission: 'places.read' },
    ],
    'palette.results': [
      { id: 'places', order: 60, component: PlacesPaletteResults, permission: 'places.read' },
    ],
  },
})
