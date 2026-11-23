import { AnimatePresence, motion } from 'motion/react'
import { useT } from '@/lib/i18n'
import { ease, spring } from '@/lib/motion'
import { Signal } from '@/ui'

/** Shown while files are dragged over the page: says where they will land. */
export function DropOverlay({ visible, place }: { visible: boolean; place: string }) {
  const t = useT('browser')
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease }}
          className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-scrim/70 p-6 backdrop-blur-[3px]"
        >
          <div className="absolute inset-3 rounded-[22px] shadow-[inset_0_0_0_2px_var(--signal)] [background:radial-gradient(60%_60%_at_50%_50%,var(--signal-soft),transparent)]" />
          <motion.div
            initial={{ y: 12, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, scale: 0.98 }}
            transition={spring.move}
            className="floating relative flex flex-col items-center gap-4 px-10 py-8 text-center"
          >
            <Signal tone="greenlit" size={48} />
            <div>
              <div className="t-title-2 text-ink">{t('drop.title')}</div>
              <div className="mt-1 t-callout text-ink-3">{t('drop.to', { place })}</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
