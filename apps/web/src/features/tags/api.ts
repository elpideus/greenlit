import { type TagChangeResult, type TagCount, tagKey } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'

/**
 * Rename, merge and delete tags everywhere. The tag list updates at once (counts are summed for a merge); the server
 * then sends the real numbers and every open library refreshes.
 */
export function useTagOps() {
  const qc = useQueryClient()
  return useMemo(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: qk.tags })
      void qc.invalidateQueries({ queryKey: qk.media() })
    }
    const patch = (fn: (list: TagCount[]) => TagCount[]) =>
      qc.setQueryData<TagCount[]>(qk.allTags, (list) => (list ? fn(list) : list))
    return {
      rename: async (from: string[], to: string) => {
        const gone = new Set([...from.map(tagKey), tagKey(to)])
        patch((list) => {
          const count = list.filter((t) => gone.has(tagKey(t.name))).reduce((n, t) => n + t.count, 0)
          return [...list.filter((t) => !gone.has(tagKey(t.name))), { name: to, count }]
        })
        try {
          return (await api.post<TagChangeResult>('/tags/rename', { from, to })).count
        } finally {
          refresh()
        }
      },
      remove: async (names: string[]) => {
        const gone = new Set(names.map(tagKey))
        patch((list) => list.filter((t) => !gone.has(tagKey(t.name))))
        try {
          return (await api.post<TagChangeResult>('/tags/delete', { names })).count
        } finally {
          refresh()
        }
      },
    }
  }, [qc])
}
