import { formatBytes, type Media, type MediaFormat } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Download, FileWarning, WrapText } from 'lucide-react'
import { useState } from 'react'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Button, ErrorState, IconButton, Segmented, Skeleton, toast } from '@/ui'
import { CodeView } from './CodeView'
import { LANGUAGE_NAMES, textPreview } from './kinds'

/** Bigger text files are offered as a download: a browser tab shouldn't hold 50 MB of log. */
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Text files in the viewer: code with highlighting and line numbers, Markdown as a page to read, HTML drawn as a
 * page (without running its scripts), each with its source a click away.
 */
export default function DocumentStage({ media, format }: { media: Media; format: MediaFormat }) {
  const t = useT('documents')
  const preview = textPreview(format)
  const rendered = preview?.kind === 'markdown' || preview?.kind === 'html'
  const [view, setView] = useState<'page' | 'source'>('page')
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState(false)
  const tooBig = format.size > MAX_BYTES
  const text = useQuery({
    queryKey: ['documents', 'text', format.id, format.fileRevision],
    queryFn: ({ signal }) => readText(format.urls.original, signal),
    enabled: !tooBig,
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (!preview) return null

  const showSource = !rendered || view === 'source'
  const lang = preview.kind === 'code' ? preview.lang : preview.kind
  const lines = text.data?.text ? text.data.text.split('\n').length : 0
  const copy = () =>
    void navigator.clipboard.writeText(text.data?.text ?? '').then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      },
      (err) => toast.error(err),
    )

  return (
    <div className="flex size-full flex-col gap-3 p-4 pt-3">
      <div className="force-dark flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        {rendered && (
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'page', label: preview.kind === 'html' ? t('page') : t('reading') },
              { value: 'source', label: t('source') },
            ]}
          />
        )}
        <span className="t-caption text-ink-3">
          {(lang && LANGUAGE_NAMES[lang]) || t('plainText')}
          {lines > 0 && ` · ${t('lines', { count: lines })}`} · {formatBytes(format.size)}
          {text.data?.encoding === 'windows-1252' && ` · ${t('legacyEncoding')}`}
        </span>
        <span className="flex-1" />
        {showSource && (
          <Button
            size="sm"
            variant={wrap ? 'secondary' : 'ghost'}
            icon={WrapText}
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
          >
            {t('wrap')}
          </Button>
        )}
        <IconButton
          icon={copied ? Check : Copy}
          label={copied ? t('copied') : t('copy')}
          size="sm"
          disabled={!text.data?.text}
          onClick={copy}
        />
        <a href={format.urls.download} download>
          <IconButton icon={Download} label={t('download')} size="sm" />
        </a>
      </div>

      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]',
          preview.kind === 'html' && !showSource ? 'bg-white' : 'bg-panel',
        )}
      >
        {tooBig ? (
          <Notice
            title={t('tooBig', { size: formatBytes(format.size) })}
            body={t('tooBigBody')}
            format={format}
          />
        ) : text.isLoading ? (
          <div className="flex flex-col gap-2.5 p-6">
            {[72, 54, 88, 40, 66, 80, 30].map((w) => (
              <Skeleton key={w} className="h-3" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : text.error || !text.data ? (
          <div className="grid size-full place-items-center">
            <ErrorState error={text.error} retry={() => void text.refetch()} />
          </div>
        ) : text.data.binary ? (
          <Notice title={t('binary')} body={t('binaryBody')} format={format} />
        ) : showSource ? (
          <CodeView text={text.data.text} lang={lang} wrap={wrap} />
        ) : preview.kind === 'markdown' ? (
          <div className="size-full overflow-y-auto">
            <div className="mx-auto max-w-[820px] px-8 py-10 max-sm:px-5">
              <Markdown source={text.data.text} />
            </div>
          </div>
        ) : (
          <iframe
            title={media.title}
            // No scripts, no access to Greenlit: links open in a new tab.
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={withBase(text.data.text)}
            className="size-full border-0"
          />
        )}
      </div>
    </div>
  )
}

function Notice({ title, body, format }: { title: string; body: string; format: MediaFormat }) {
  const t = useT('documents')
  return (
    <div className="grid size-full place-items-center p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-2">
        <FileWarning size={28} strokeWidth={1.5} className="text-ink-3" />
        <p className="t-headline text-ink">{title}</p>
        <p className="t-callout text-ink-3">{body}</p>
        <a href={format.urls.download} download className="mt-2">
          <Button size="sm" icon={Download}>
            {t('download')}
          </Button>
        </a>
      </div>
    </div>
  )
}

/** The file's text: UTF-8, or Windows-1252 for older files that aren't valid UTF-8. Binary files are told apart. */
async function readText(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal, credentials: 'same-origin' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const head = bytes.subarray(0, 8192)
  if (head.includes(0)) return { text: '', binary: true, encoding: 'utf-8' as const }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      binary: false,
      encoding: 'utf-8' as const,
    }
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      binary: false,
      encoding: 'windows-1252' as const,
    }
  }
}

/** Links in a shown page open in a new tab instead of inside the frame. */
function withBase(html: string) {
  const base = '<base target="_blank">'
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html
}
