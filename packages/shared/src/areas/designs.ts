import { z } from 'zod'

/**
 * Design files (FigCraft `.figcraft` documents): what Greenlit reads from them when they are uploaded, the fonts it
 * keeps for them and the browser build of FigCraft that shows them.
 */

export const FIGCRAFT_MIME = 'application/x-figcraft'

/** Mime types of design documents. */
export const DESIGN_MIMES = [FIGCRAFT_MIME] as const

/** The extension a design document's file carries, by mime. */
export const DESIGN_EXTENSIONS: Record<string, string> = { [FIGCRAFT_MIME]: '.figcraft' }

export const DesignFrame = z.object({
  /** The layer id inside the document. */
  id: z.number(),
  name: z.string(),
  /** frame, section, component, componentSet, instance... */
  type: z.string(),
  /** Its place on the page. */
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export type DesignFrame = z.infer<typeof DesignFrame>

export const DesignPage = z.object({
  id: z.number(),
  name: z.string(),
  /** The page's top-level frames, in layer order. */
  frames: z.array(DesignFrame),
})
export type DesignPage = z.infer<typeof DesignPage>

/** What a design document holds, read when it is uploaded (`derived/<blob>/design.json`). */
export const DesignInfo = z.object({
  app: z.literal('figcraft'),
  /** The document format's version (`document.json` → `version`). */
  formatVersion: z.number(),
  name: z.string(),
  pages: z.array(DesignPage),
  layers: z.number(),
  components: z.number(),
  textStyles: z.number(),
  styles: z.number(),
  variables: z.number(),
  images: z.number(),
  comments: z.number(),
  /** Saved versions in the file's own history. */
  versions: z.number(),
  /** Font families its text uses, A→Z. */
  fonts: z.array(z.string()),
  /** The file carries its own thumbnail (FigCraft writes one on every save). */
  thumbnail: z.boolean(),
  /** How the thumbnail and poster were made: the file's own small thumbnail, or rendered with figcraft-cli. */
  rendered: z.enum(['embedded', 'cli', 'none']),
})
export type DesignInfo = z.infer<typeof DesignInfo>

/** A font file Greenlit keeps for design documents (shown in FigCraft, used when it renders thumbnails). */
export const DesignFont = z.object({
  id: z.uuid(),
  family: z.string(),
  style: z.string(),
  filename: z.string(),
  size: z.number(),
  url: z.string(),
  createdAt: z.string(),
})
export type DesignFont = z.infer<typeof DesignFont>

/** Is the FigCraft browser build here, and where. */
export const FigcraftStatus = z.object({
  version: z.string(),
  state: z.enum(['ready', 'installing', 'missing', 'failed']),
  /** Load this in a same-origin iframe (`?host=parent`). */
  appUrl: z.string().nullable(),
  error: z.string().nullable(),
  /** figcraft-cli is installed: thumbnails are rendered from the document, not taken from its small preview. */
  renderer: z.boolean(),
})
export type FigcraftStatus = z.infer<typeof FigcraftStatus>

export function isDesignMime(mime: string) {
  return (DESIGN_MIMES as readonly string[]).includes(mime.split(';')[0]!.trim())
}
