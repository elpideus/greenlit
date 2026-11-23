import { Languages, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router'
import { api } from '@/lib/api'
import { setLanguage, useT } from '@/lib/i18n'
import { qk, queryClient } from '@/lib/query'
import { useConfig, useSession, useSignOut } from '@/lib/session'
import { setModePreference, useMode } from '@/lib/theme'
import { Avatar, Menu } from '@/ui'

export function AccountMenu() {
  const t = useT()
  const me = useSession()
  const navigate = useNavigate()
  const signOut = useSignOut()
  const { data: config } = useConfig()
  const { preference } = useMode(config?.theme.defaultMode)

  const setLocale = async (locale: 'en' | 'it') => {
    setLanguage(locale)
    if (!me.viaShareLink) {
      const next = await api.patch('/me', { locale }).catch(() => null)
      if (next) queryClient.setQueryData(qk.me, next)
    }
  }

  return (
    <Menu
      align="end"
      width={248}
      header={
        <div className="flex items-center gap-3 px-2 pt-2 pb-2.5">
          <Avatar user={me} size={34} />
          <div className="min-w-0">
            <div className="truncate t-callout font-[550] text-ink">{me.displayName}</div>
            <div className="truncate t-caption text-ink-3">{me.viaShareLink ? t('shell.shareSession') : me.email}</div>
          </div>
        </div>
      }
      trigger={
        <button type="button" className="press ml-1 rounded-full p-0.5 hover-device:hover:shadow-[0_0_0_2px_var(--line-strong)]" aria-label={t('shell.account')}>
          <Avatar user={me} size={28} />
        </button>
      }
      items={[
        'separator',
        !me.viaShareLink && { label: t('shell.profile'), icon: UserRound, onSelect: () => navigate('/settings/profile') },
        {
          label: t('shell.appearance'),
          icon: preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor,
          items: [
            { label: t('shell.system'), icon: Monitor, checked: preference === 'system', onSelect: () => setModePreference('system') },
            { label: t('shell.light'), icon: Sun, checked: preference === 'light', onSelect: () => setModePreference('light') },
            { label: t('shell.dark'), icon: Moon, checked: preference === 'dark', onSelect: () => setModePreference('dark') },
          ],
        },
        {
          label: t('shell.language'),
          icon: Languages,
          hint: me.locale === 'it' ? 'Italiano' : 'English',
          items: [
            { label: 'English', checked: me.locale === 'en', onSelect: () => void setLocale('en') },
            { label: 'Italiano', checked: me.locale === 'it', onSelect: () => void setLocale('it') },
          ],
        },
        'separator',
        {
          label: t('shell.signOut'),
          icon: LogOut,
          onSelect: async () => {
            await signOut()
            navigate('/login')
          },
        },
      ]}
    />
  )
}
