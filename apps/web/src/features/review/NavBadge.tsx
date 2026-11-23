import { motion } from 'motion/react'
import { useMediaList } from '@/data/media'
import { useSession } from '@/lib/session'
import { useInbox } from './api'

/** Reviewers: how many items wait for their decision. Admins: how many came back with changes. */
export function ReviewBadge() {
  const me = useSession()
  const inbox = useInbox()
  const changes = useMediaList({ status: 'changes_requested', limit: 100 }, { enabled: me.role === 'admin' })
  const n =
    me.role === 'admin'
      ? (changes.data?.pages.flatMap((p) => p.items).length ?? 0)
      : new Set((inbox.data ?? []).map((r) => r.mediaId)).size
  if (!n) return null
  return (
    <motion.span
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={
        me.role === 'admin'
          ? 'grid h-4 min-w-4 place-items-center rounded-full bg-cut-soft px-1 t-meta text-[10px] font-[600] text-cut'
          : 'grid h-4 min-w-4 place-items-center rounded-full bg-review px-1 t-meta text-[10px] font-[600] text-[#1b1302]'
      }
    >
      {n}
    </motion.span>
  )
}
