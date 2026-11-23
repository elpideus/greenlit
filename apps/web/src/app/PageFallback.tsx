import { motion } from 'motion/react'
import { Skeleton } from '@/ui'

/** While a page's code loads: the page's rhythm in placeholders, shown only after a short delay. */
export function PageFallback() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.25, duration: 0.3 }}
      className="mx-auto w-full max-w-[1680px] px-[var(--gutter)] pt-8"
    >
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-3 h-4 w-80" />
      <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-6">
        {Array.from({ length: 10 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <div key={i}>
            <Skeleton className="aspect-video w-full rounded-tile" />
            <Skeleton className="mt-2.5 h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    </motion.div>
  )
}
