import { ChevronLeft, Upload } from 'lucide-react'
import { MediaBrowser } from '@/components/library'
import { useT } from '@/lib/i18n'
import { Button, Page, PageHeader } from '@/ui'

export default function LibraryPage() {
  const t = useT('library')
  return (
    <Page>
      <MediaBrowser
        header={({ total, inTrash, upload, canUpload, exitTrash }) => (
          <>
            {inTrash && (
              <button
                type="button"
                onClick={exitTrash}
                className="press -ml-1 mb-2 inline-flex h-7 items-center gap-0.5 rounded-control pr-2 pl-0.5 t-callout text-ink-3 hover:bg-hover hover:text-ink"
              >
                <ChevronLeft size={16} />
                {t('backToLibrary')}
              </button>
            )}
            <PageHeader
              title={inTrash ? t('trashTitle') : t('title')}
              meta={
                inTrash ? (
                  <span>{t('trashMeta')}</span>
                ) : total !== null ? (
                  <span className="tabular">{t('count', { count: total })}</span>
                ) : (
                  <span className="opacity-0">—</span>
                )
              }
              actions={
                canUpload && (
                  <Button variant="primary" icon={Upload} onClick={upload}>
                    {t('upload')}
                  </Button>
                )
              }
              className="mb-3"
            />
          </>
        )}
      />
    </Page>
  )
}
