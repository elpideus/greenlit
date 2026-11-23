import type { Account } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'
import { useCan } from '@/lib/session'

/** Connected social accounts (merged accounts are folded into their main one by the server). */
export function useAccounts() {
  useLiveQuery('connectors', [qk.accounts])
  const allowed = useCan('connectors.read')
  return useQuery({
    queryKey: qk.accounts,
    queryFn: () => api.get<Account[]>('/connectors/accounts'),
    enabled: allowed,
  })
}
