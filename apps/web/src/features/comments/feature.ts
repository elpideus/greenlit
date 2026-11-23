import { MessageSquare } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'
import { NoteMarkers } from './Markers'
import { CompositionNotes, MediaNotes, PostNotes } from './NotesPanel'
import { NotesOverlay } from './Overlay'

/**
 * Notes (comments and change requests): pinned to a spot and a moment of the frame, with attachments and replies.
 * Admins mark them done. Shown in the viewer, the editor and the post composer.
 */
export default defineFeature({
  id: 'comments',
  locales: { en, it },
  slots: {
    'media.panels': [
      {
        id: 'comments',
        order: 10,
        label: 'tab',
        icon: MessageSquare,
        permission: 'comments.read',
        component: MediaNotes,
      },
    ],
    'composition.panels': [
      {
        id: 'comments',
        order: 10,
        label: 'tab',
        icon: MessageSquare,
        permission: 'comments.read',
        component: CompositionNotes,
      },
    ],
    'post.panels': [
      {
        id: 'comments',
        order: 10,
        label: 'tab',
        icon: MessageSquare,
        permission: 'comments.read',
        component: PostNotes,
      },
    ],
    'media.viewer.overlay': [
      {
        id: 'notes',
        order: 50,
        permission: 'comments.read',
        component: NotesOverlay,
        when: ({ format }: { format: { kind: string } }) =>
          format.kind === 'video' || format.kind === 'image',
      },
    ],
    'media.scrubber.markers': [{ id: 'notes', permission: 'comments.read', component: NoteMarkers }],
  },
})
