import type { User, UserRef } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useCan } from '@/lib/session'

export type DirectoryEntry = UserRef & { role: string }

/** People you can mention, send things to or share with. */
export function useDirectory() {
  const allowed = useCan('users.directory')
  return useQuery({
    queryKey: qk.directory,
    queryFn: () => api.get<DirectoryEntry[]>('/users/directory'),
    enabled: allowed,
    staleTime: 5 * 60_000,
  })
}

/** Everyone with an account (admins). */
export function useUsers() {
  const allowed = useCan('users.manage')
  return useQuery({ queryKey: qk.users, queryFn: () => api.get<User[]>('/users'), enabled: allowed })
}

export function useReviewers() {
  const { data } = useDirectory()
  return (data ?? []).filter((u) => u.role === 'reviewer')
}
