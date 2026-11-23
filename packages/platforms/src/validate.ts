import { fmtBytes, platformName } from './ffmpeg.ts'
import { aspectInRange, sameShape, shape } from './geometry.ts'
import { allHashtags, extractMentions, textLength, youtubeTagsLength } from './text.ts'
import {
  type Issue,
  type IssueLevel,
  type PlacementSpec,
  type PostContent,
  SourceInfo,
  type TextLimit,
} from './types.ts'

/**
 * Checks a source (and optionally the post text) against a placement, in plain English.
 * Errors = the platform will refuse it; warnings = it posts, but worse than it could; info = what Greenlit will do.
 *
 *   validateForPlacement(getPlacement('youtube.video'), probe, { title, description, tags })
 *
 * Pass `null` as the source to check only the text.
 */
export function validateForPlacement(
  spec: PlacementSpec,
  sourceInfo: SourceInfo | null,
  content: PostContent = {},
): Issue[] {
  const out: Issue[] = []
  const add = (
    level: IssueLevel,
    code: string,
    message: string,
    params: Record<string, string | number> = {},
  ) => out.push({ level, code, message, params })
  const where = `${platformName(spec)} ${spec.label}`

  if (spec.api.publish === 'no')
    add(
      'info',
      'api.unsupported',
      `${where} cannot be published through the official API yet${spec.api.note ? `: ${spec.api.note}` : '.'}`,
    )

  if (sourceInfo) {
    const src = SourceInfo.parse(sourceInfo)
    if (!spec.media.kinds.includes(src.kind)) {
      add(
        'error',
        'media.kindNotAccepted',
        `${where} does not take ${src.kind === 'image' ? 'pictures' : 'videos'}.`,
        { kind: src.kind },
      )
    } else {
      const aspect = src.width / src.height
      const params = {
        aspect: shape(aspect),
        min: shape(spec.aspect.min),
        max: shape(spec.aspect.max),
        recommended: shape(spec.aspect.recommended),
      }
      if (!aspectInRange(spec, aspect)) {
        add(
          'warning',
          'aspect.outOfRange',
          `${params.aspect} is outside what ${where} accepts (${params.min} to ${params.max}): it will be padded or cropped.`,
          params,
        )
      } else if (
        !sameShape(aspect, spec.aspect.recommended) &&
        !spec.aspect.alsoGood.some((a) => sameShape(aspect, a))
      ) {
        add(
          'info',
          'aspect.notRecommended',
          `${params.aspect} works, but ${where} looks best at ${params.recommended}.`,
          params,
        )
      }

      const rec = spec.resolution.recommended
      const recShort = Math.min(rec.width, rec.height)
      const short = Math.min(src.width, src.height)
      const mins = [spec.resolution.minWidth, spec.resolution.minHeight].filter((n): n is number => !!n)
      const minShort = mins.length ? Math.min(...mins) : 0
      if (minShort && short < minShort) {
        add(
          'warning',
          'resolution.belowMin',
          `${src.width}×${src.height} is below ${where}'s minimum (${minShort} px): it will be scaled up and look soft.`,
          { width: src.width, height: src.height, min: minShort },
        )
      } else if (short < Math.min(recShort, 1080) * 0.7) {
        add(
          'warning',
          'resolution.low',
          `${src.width}×${src.height} is small for ${where} (best: ${rec.width}×${rec.height}).`,
          { width: src.width, height: src.height, recWidth: rec.width, recHeight: rec.height },
        )
      }

      if (src.kind === 'video') {
        const d = src.durationSec
        if (d !== null && spec.duration) {
          if (d < spec.duration.minSec)
            add(
              'error',
              'duration.tooShort',
              `${fmtSec(d)} is too short for ${where} (at least ${fmtSec(spec.duration.minSec)}).`,
              { duration: round(d), min: spec.duration.minSec },
            )
          else if (d > spec.duration.maxSec)
            add(
              'error',
              'duration.tooLong',
              `${fmtSec(d)} is too long for ${where} (at most ${fmtSec(spec.duration.maxSec)}).`,
              { duration: round(d), max: spec.duration.maxSec },
            )
          else if (spec.duration.softMaxSec && d > spec.duration.softMaxSec)
            add(
              'warning',
              'duration.overSoftMax',
              `${fmtSec(d)} posts, but over ${fmtSec(spec.duration.softMaxSec)} ${spec.duration.note ?? `${where} treats it differently.`}`,
              { duration: round(d), softMax: spec.duration.softMaxSec },
            )
        }
        if (src.fps && spec.fps) {
          if (src.fps > spec.fps.max * 1.001)
            add(
              'info',
              'fps.reduced',
              `${round(src.fps)} fps will be reduced to ${spec.fps.max} fps or less (${where} plays at most ${spec.fps.max}).`,
              { fps: round(src.fps), max: spec.fps.max },
            )
          else if (spec.fps.min && src.fps < spec.fps.min * 0.999)
            add(
              'warning',
              'fps.belowMin',
              `${round(src.fps)} fps is below ${where}'s ${spec.fps.min} fps minimum: frames will be repeated.`,
              { fps: round(src.fps), min: spec.fps.min },
            )
        }
        if (src.hdr !== false && !spec.encode.video?.hdr.accepted)
          add('info', 'hdr.tonemapped', `HDR will be converted to SDR for ${where}.`)
        if (d && spec.maxBytes.video) {
          const kbps = (spec.maxBytes.video * 8) / 1000 / d
          if (kbps < Math.min(src.width, src.height) * 2) {
            add(
              'warning',
              'size.lowBitrate',
              `To fit ${fmtBytes(spec.maxBytes.video)}, ${fmtSec(d)} can only use ${(kbps / 1000).toFixed(1)} Mbps: expect visible compression.`,
              { limit: fmtBytes(spec.maxBytes.video), mbps: round(kbps / 1000) },
            )
          }
        }
        if (!src.hasAudio && spec.encode.video?.audio.requireTrack)
          add(
            'info',
            'audio.silentAdded',
            `A silent audio track will be added (${platformName(spec)} needs one to attach a sound).`,
          )
      } else if (src.bytes && spec.maxBytes.image && src.bytes > spec.maxBytes.image) {
        add(
          'info',
          'size.imageRecompressed',
          `The picture is over ${fmtBytes(spec.maxBytes.image)}: it will be recompressed.`,
          { limit: fmtBytes(spec.maxBytes.image) },
        )
      }
    }
  }

  // ── Text ───────────────────────────────────────────────────────────────
  const t = spec.text
  const body = content.caption ?? content.description ?? ''
  checkLimit(add, where, 'title', 'Title', content.title, t.title)
  if (t.caption)
    checkLimit(add, where, 'caption', 'Caption', content.caption ?? content.description, t.caption)
  else if (t.description)
    checkLimit(
      add,
      where,
      'description',
      'Description',
      content.description ?? content.caption,
      t.description,
    )
  else if (body.trim() && spec.surface !== 'post')
    add(
      'info',
      'caption.notPublished',
      `${where} has no text through the API: the caption will not be published.`,
    )
  if (t.caption && t.description && content.description)
    checkLimit(add, where, 'description', 'Description', content.description, t.description)
  if (content.altText && t.altText) checkLimit(add, where, 'altText', 'Alt text', content.altText, t.altText)

  const text = [content.title ?? '', body].join('\n')
  const tags = allHashtags(text, content.hashtags)
  const h = t.hashtags
  if (h && tags.length) {
    if (h.max !== undefined && tags.length > h.max) {
      add(
        h.strict ? 'error' : 'warning',
        'hashtags.tooMany',
        `${tags.length} hashtags: ${where} allows ${h.max}${h.note ? ` (${h.note})` : '.'}`,
        { count: tags.length, max: h.max },
      )
    }
    if (h.ignoredAbove && tags.length > h.ignoredAbove) {
      add(
        'error',
        'hashtags.allIgnored',
        `${tags.length} hashtags: with more than ${h.ignoredAbove}, ${platformName(spec)} ignores all of them.`,
        { count: tags.length, max: h.ignoredAbove },
      )
    }
  }
  if (t.mentions) {
    const m = new Set(extractMentions(body).map((x) => x.toLowerCase())).size
    if (m > t.mentions.max)
      add('error', 'mentions.tooMany', `${m} @mentions: ${where} allows ${t.mentions.max}.`, {
        count: m,
        max: t.mentions.max,
      })
  }
  if (t.tags && content.tags?.length) {
    const len = youtubeTagsLength(content.tags)
    if (len > t.tags.maxTotal)
      add(
        'error',
        'tags.tooLong',
        `Tags use ${len} characters: ${platformName(spec)} allows ${t.tags.maxTotal} in total (commas count, tags with spaces count their quotes).`,
        { length: len, max: t.tags.maxTotal },
      )
  }

  const items = content.items ?? 1
  if (items > 1) {
    if (!spec.carousel)
      add('error', 'carousel.unsupported', `${where} takes one item, not ${items}.`, { count: items })
    else if (items > spec.carousel.max)
      add('error', 'carousel.tooMany', `${items} items: ${where} takes at most ${spec.carousel.max}.`, {
        count: items,
        max: spec.carousel.max,
      })
    // A carousel's minimum counts only for several items: one item is a plain post, not a short carousel.
    else if (items < spec.carousel.min)
      add('error', 'carousel.tooFew', `A ${where} carousel needs at least ${spec.carousel.min} items.`, {
        count: items,
        min: spec.carousel.min,
      })
  }
  return out
}

function checkLimit(
  add: (level: IssueLevel, code: string, message: string, params?: Record<string, string | number>) => void,
  where: string,
  field: string,
  label: string,
  value: string | undefined,
  limit: TextLimit | undefined,
) {
  if (!limit) return
  const v = value ?? ''
  if (limit.required && !v.trim()) {
    add('error', `${field}.missing`, `${label} is required on ${where}.`)
    return
  }
  const len = textLength(v, limit.unit)
  if (len > limit.max) {
    const unit = limit.unit === 'bytes' ? 'bytes' : 'characters'
    add('error', `${field}.tooLong`, `${label} is ${len} ${unit}: ${where} allows ${limit.max}.`, {
      length: len,
      max: limit.max,
      unit,
    })
  }
  const bad = (limit.forbidden ?? []).filter((c) => v.includes(c))
  if (bad.length)
    add('error', `${field}.forbiddenChars`, `${label} cannot contain ${bad.join(' or ')} on ${where}.`, {
      chars: bad.join(' '),
    })
}

const round = (n: number) => Math.round(n * 100) / 100
function fmtSec(s: number) {
  if (s < 90) return `${round(s)} s`
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${Math.round(s % 60)} s` : ''}`
  return `${Math.floor(s / 3600)} h${s % 3600 ? ` ${Math.round((s % 3600) / 60)} min` : ''}`
}

/** Highest level among issues (null = nothing to report). */
export function worstLevel(issues: Issue[]): IssueLevel | null {
  if (issues.some((i) => i.level === 'error')) return 'error'
  if (issues.some((i) => i.level === 'warning')) return 'warning'
  if (issues.length) return 'info'
  return null
}
