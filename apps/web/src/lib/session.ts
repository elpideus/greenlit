import type { Me, PublicConfig } from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './api'
import { qk } from './query'

/** Branding, theme and platform settings: everything known before signing in. */
export function useConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<PublicConfig>('/config'),
    staleTime: 5 * 60_000,
  })
}

/** The config, once loaded (the app shell waits for it). */
export function usePublicConfig(): PublicConfig {
  const { data } = useConfig()
  if (!data) throw new Error('usePublicConfig used before the config loaded')
  return data
}

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me')
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 60_000,
  })
}

/** The signed-in person. Only use inside the signed-in shell. */
export function useSession(): Me {
  const { data } = useMe()
  if (!data) throw new Error('useSession used while signed out')
  return data
}

export function can(me: Pick<Me, 'role' | 'permissions'> | null | undefined, permission: string) {
  if (!me) return false
  return me.role === 'admin' || me.permissions.includes(permission)
}

/** Whether the signed-in person has a permission (admins have all of them). */
export function useCan(permission: string) {
  const { data } = useMe()
  return can(data, permission)
}

export function useIsAdmin() {
  const { data } = useMe()
  return data?.role === 'admin'
}

export function useSignOut() {
  const qc = useQueryClient()
  return async () => {
    await api.post('/auth/logout').catch(() => {})
    qc.setQueryData(qk.me, null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'config' && q.queryKey[0] !== 'me' })
  }
}
