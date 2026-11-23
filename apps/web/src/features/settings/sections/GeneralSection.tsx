import type { Branding, PlatformSettings } from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Globe2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AutosaveInput,
  SavedHint,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from '@/components/SettingsSection'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useConfig } from '@/lib/session'
import { formatTime } from '@/lib/time'
import { Popover, SearchInput, Segmented, Skeleton, toast } from '@/ui'

type Zone = { id: string; offset: string; offsetMinutes: number }

function usePlatformSettings() {
  return useQuery({
    queryKey: [...qk.settings, 'platform'],
    queryFn: () => api.get<PlatformSettings>('/settings/platform'),
  })
}

export default function GeneralSection() {
  const t = useT('settings')
  const qc = useQueryClient()
  const { data: config } = useConfig()
  const { data: platform } = usePlatformSettings()
  const [tick, setTick] = useState({ lang: 0, week: 0 })

  const savePlatform = async (patch: Partial<PlatformSettings>) => {
    const next = await api.patch<PlatformSettings>('/settings/platform', patch)
    qc.setQueryData([...qk.settings, 'platform'], next)
    await qc.invalidateQueries({ queryKey: qk.config })
    return next
  }
  const saveBranding = async (patch: Partial<Branding>) => {
    await api.patch<Branding>('/settings/branding', patch)
    await qc.invalidateQueries({ queryKey: qk.config })
  }

  if (!platform || !config)
    return (
      <SettingsSection title={t('general.section')} description={t('general.description')}>
        <Skeleton className="h-36 rounded-panel" />
        <Skeleton className="h-52 rounded-panel" />
      </SettingsSection>
    )

  return (
    <SettingsSection title={t('general.section')} description={t('general.description')}>
      <SettingsGroup title={t('general.workspace')}>
        <SettingsRow label={t('general.name')} description={t('general.nameHint')} htmlFor="gs-name">
          <AutosaveInput
            id="gs-name"
            value={config.branding.appName}
            required
            maxLength={40}
            onSave={(appName) => saveBranding({ appName })}
          />
        </SettingsRow>
        <SettingsRow label={t('general.tagline')} description={t('general.taglineHint')} htmlFor="gs-tagline">
          <AutosaveInput
            id="gs-tagline"
            value={config.branding.tagline}
            maxLength={120}
            placeholder={t('general.taglinePlaceholder')}
            onSave={(tagline) => saveBranding({ tagline })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t('general.time')}>
        <SettingsRow label={t('general.timeZone')} description={t('general.timeZoneHint')} stack>
          <TimeZonePicker
            value={platform.timeZone}
            onChange={async (timeZone) => {
              const before = platform.timeZone
              try {
                await savePlatform({ timeZone })
                toast.done(t('general.zoneChanged', { zone: timeZone.replace(/_/g, ' ') }), {
                  action: {
                    label: t('general.undo'),
                    onClick: () => void savePlatform({ timeZone: before }),
                  },
                })
              } catch (err) {
                toast.error(err)
              }
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('general.defaultLanguage')} description={t('general.defaultLanguageHint')}>
          <SavedHint tick={tick.lang} />
          <Segmented
            value={platform.defaultLocale}
            onChange={(defaultLocale) =>
              void savePlatform({ defaultLocale })
                .then(() => setTick((x) => ({ ...x, lang: x.lang + 1 })))
                .catch((e) => toast.error(e))
            }
            options={[
              { value: 'en', label: 'English' },
              { value: 'it', label: 'Italiano' },
            ]}
          />
        </SettingsRow>
        <SettingsRow label={t('general.weekStart')} description={t('general.weekStartHint')}>
          <SavedHint tick={tick.week} />
          <Segmented
            value={String(platform.weekStartsOn) as '0' | '1'}
            onChange={(v) =>
              void savePlatform({ weekStartsOn: Number(v) as 0 | 1 })
                .then(() => setTick((x) => ({ ...x, week: x.week + 1 })))
                .catch((e) => toast.error(e))
            }
            options={[
              { value: '1', label: t('general.monday') },
              { value: '0', label: t('general.sunday') },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t('general.address')}>
        <SettingsRow label={t('general.publicUrl')} description={t('general.publicUrlHint')} htmlFor="gs-url">
          <AutosaveInput
            id="gs-url"
            value={platform.publicUrl}
            placeholder={location.origin}
            onSave={(publicUrl) => savePlatform({ publicUrl })}
            validate={(v) =>
              !v || /^(https?:\/\/)?[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(v)
                ? null
                : 'Use an address like greenlit.example.com'
            }
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  )
}

function splitZone(id: string) {
  const parts = id.split('/')
  const city = (parts.at(-1) ?? id).replace(/_/g, ' ')
  const region = parts.length > 1 ? parts.slice(0, -1).join(' / ').replace(/_/g, ' ') : ''
  return { city, region }
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(i)
  }, [ms])
  return now
}

/** The platform time zone: searchable by city or region, with each zone's offset and the time there now. */
function TimeZonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const t = useT('settings')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const now = useNow()
  const list = useRef<HTMLDivElement>(null)
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { data: zones } = useQuery({
    queryKey: [...qk.settings, 'timezones'],
    queryFn: () => api.get<Zone[]>('/settings/timezones'),
    staleTime: 30 * 60_000,
  })
  const sorted = useMemo(
    () => [...(zones ?? [])].sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.id.localeCompare(b.id)),
    [zones],
  )
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s+/g, '_')
    if (!needle) return sorted
    return sorted.filter(
      (z) => z.id.toLowerCase().includes(needle) || z.offset.toLowerCase().includes(needle),
    )
  }, [sorted, q])
  const current = zones?.find((z) => z.id === value)
  const { city, region } = splitZone(value)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() =>
      list.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'center' }),
    )
  }, [open])

  return (
    <div className="flex w-full flex-col gap-2">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setQ('')
        }}
        align="start"
        width={420}
        trigger={
          <button
            type="button"
            className="press flex h-14 w-full items-center gap-3.5 rounded-tile bg-well px-3.5 text-left shadow-[inset_0_0_0_1px_var(--line)] hover-device:hover:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:max-w-[460px]"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-control bg-hover text-ink-2">
              <Globe2 size={17} strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate t-callout font-[550] text-ink">
                {city}
                {region && <span className="font-normal text-ink-3"> · {region}</span>}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 t-caption text-ink-3">
                <span className="t-meta">{current?.offset ?? ''}</span>
                <span aria-hidden>·</span>
                {t('general.nowThere', { time: formatTime(now, value) })}
              </span>
            </span>
            <ChevronsUpDown size={14} className="shrink-0 text-ink-3" />
          </button>
        }
      >
        <div className="p-2">
          <SearchInput value={q} onChange={setQ} placeholder={t('general.searchZones')} autoFocus />
          <div ref={list} className="mt-1.5 max-h-[340px] overflow-y-auto">
            {q === '' && browserTz !== value && (
              <ZoneRow
                id={browserTz}
                offset={zones?.find((z) => z.id === browserTz)?.offset ?? ''}
                now={now}
                note={t('general.browser')}
                onPick={() => {
                  onChange(browserTz)
                  setOpen(false)
                }}
              />
            )}
            {shown.map((z) => (
              <ZoneRow
                key={z.id}
                id={z.id}
                offset={z.offset}
                now={now}
                current={z.id === value}
                onPick={() => {
                  if (z.id !== value) onChange(z.id)
                  setOpen(false)
                }}
              />
            ))}
            {!shown.length && (
              <div className="px-3 py-8 text-center t-callout text-ink-3">{t('general.noZones')}</div>
            )}
          </div>
        </div>
      </Popover>
    </div>
  )
}

function ZoneRow({
  id,
  offset,
  now,
  current,
  note,
  onPick,
}: {
  id: string
  offset: string
  now: number
  current?: boolean
  note?: string
  onPick: () => void
}) {
  const { city, region } = splitZone(id)
  return (
    <button
      type="button"
      data-current={current || undefined}
      onClick={onPick}
      className={cn(
        'press flex h-10 w-full items-center gap-3 rounded-[8px] px-2.5 text-left hover:bg-hover',
        current && 'bg-hover',
      )}
    >
      <span className="grid w-4 shrink-0 place-items-center">
        {current && <Check size={14} strokeWidth={2.4} className="text-signal" />}
      </span>
      <span className="min-w-0 flex-1 truncate t-callout text-ink">
        {city}
        <span className="text-ink-3"> {note ? `· ${note}` : region ? `· ${region}` : ''}</span>
      </span>
      <span className="shrink-0 t-meta text-ink-3">{formatTime(now, id)}</span>
      <span className="w-[84px] shrink-0 text-right t-meta text-ink-4">{offset}</span>
    </button>
  )
}
