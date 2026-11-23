import type { Account, Capabilities, Connectable, Platform, RemoteSession } from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'

export interface PlatformInfo {
  platform: Platform
  name: string
  driver: string
  driverName: string
  signIn: { method: 'password' | 'qr'; host: string; cookieDomains: string[] }
  capabilities: Capabilities
}

export type SessionView = RemoteSession & {
  title?: string
  loading?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  dpr?: number
}

export function usePlatforms() {
  return useQuery({
    queryKey: qk.platforms,
    queryFn: () => api.get<PlatformInfo[]>('/connectors/platforms'),
    staleTime: 10 * 60_000,
  })
}

export function useRefreshAccounts() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: qk.accounts })
}

export const accountsApi = {
  check: (id: string) => api.post<Account>(`/connectors/accounts/${id}/check`),
  sync: (id: string) => api.post<{ posts: number }>(`/connectors/accounts/${id}/sync`),
  setEnabled: (id: string, enabled: boolean) =>
    api.post<Account>(`/connectors/accounts/${id}/enabled`, { enabled }),
  disconnect: (id: string) => api.delete(`/connectors/accounts/${id}`),
  available: (id: string) => api.get<Connectable[]>(`/connectors/accounts/${id}/available`),
  connectMore: (id: string, keys: string[]) =>
    api.post<Account[]>(`/connectors/accounts/${id}/available`, { keys }),
  checkAll: () => api.post<Account[]>('/connectors/check'),
  startSession: (body: {
    platform: Platform
    driver?: string | null
    accountId?: string | null
    width: number
    height: number
    dpr: number
  }) => api.post<SessionView>('/connectors/sessions', body),
  closeSession: (id: string) => api.delete(`/connectors/sessions/${id}`),
  choose: (id: string, keys: string[]) => api.post<Account[]>(`/connectors/sessions/${id}/choose`, { keys }),
  cookies: (body: {
    platform: Platform
    driver?: string | null
    accountId?: string | null
    cookies: string
  }) => api.post<Account[]>('/connectors/cookies', body),
}

const PLATFORM_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
}

/** Human name of a connector driver ("Meta Business Suite", "Instagram app on the Android device"). */
export function driverLabel(
  driver: string,
  platforms: PlatformInfo[] | undefined,
  appLabel: (platform: string) => string,
) {
  const known = platforms?.find((p) => p.driver === driver)
  if (known) return known.driverName
  if (driver.endsWith('-app')) return appLabel(PLATFORM_NAMES[driver.slice(0, -4)] ?? driver.slice(0, -4))
  return driver
}
