import { motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { Brand } from '@/app/Brand'
import { cn } from '@/lib/cn'
import { useIsPhone } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { useConfig } from '@/lib/session'
import { Signal, type Tone } from '@/ui'

/**
 * Sign-in, setup and share pages: the form on the left, the brand on the right. The art is the brand kit's
 * composition: flat blocks of the signal colours with the mark set in them. An instance with a sign-in picture
 * (Settings → Branding) shows that instead.
 */
export function AuthFrame({ children, lit = false }: { children: ReactNode; lit?: boolean }) {
  const phone = useIsPhone()
  const { data } = useConfig()
  const picture = data?.branding.loginImage
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-canvas lg:grid-cols-[minmax(440px,1fr)_1.25fr]">
      <div className="flex min-h-dvh flex-col px-8 py-7 sm:px-14">
        <Brand />
        <div className="flex flex-1 items-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="w-full max-w-[380px]"
          >
            {children}
          </motion.div>
        </div>
        <div className="t-caption text-ink-4">Greenlit {data?.version}</div>
      </div>
      {!phone && (
        <div className="relative hidden overflow-hidden p-3 lg:block">
          <div className="force-dark relative h-full overflow-hidden rounded-[20px] bg-[#0a0b0a]">
            {picture ? (
              <motion.img
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1.2, ease }}
                src={picture}
                alt=""
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <SignalArt lit={lit} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Block({
  className,
  style,
  delay,
  children,
}: {
  className?: string
  style?: CSSProperties
  delay: number
  children?: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.9, delay, ease }}
      className={cn('absolute', className)}
      style={style}
    >
      {children}
    </motion.div>
  )
}

/** The brand kit's hero: green column with two signals, a pale panel with the lit one, amber and blue tiles. */
function SignalArt({ lit }: { lit: boolean }) {
  const t = useT('auth')
  const ink = { color: '#0c0d0c', '--signal': '#0c0d0c', '--review': '#0c0d0c' } as CSSProperties
  const lower: Tone = lit ? 'greenlit' : 'review'
  return (
    <div className="absolute inset-0 [container-type:inline-size]">
      <div className="absolute bottom-[8%] left-[6%] max-w-[40%]">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.15, ease }}
          className="font-display text-[min(8.4cqw,128px)] leading-[0.92] font-[650] tracking-[-0.055em] text-[#edefed]"
        >
          Greenlit
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.5, ease }}
          className="mt-5 max-w-[30ch] t-body text-[#a8aca9]"
        >
          {t('welcome')}
        </motion.p>
      </div>

      {/* green column with two signals */}
      <Block delay={0.05} className="top-0 right-[33%] h-[100%] w-[19%] bg-[#42d77b]" style={ink}>
        <div className="flex h-full flex-col items-center justify-start gap-[6%] pt-[14%]">
          <Signal tone="greenlit" size={150} animate={false} className="h-auto w-[54%] text-[#0c0d0c]" />
          <Signal tone="greenlit" size={150} animate={false} className="h-auto w-[54%] text-[#0c0d0c]" />
        </div>
      </Block>

      {/* pale panel: the lamp that lights when you sign in */}
      <Block delay={0.18} className="right-[14%] bottom-0 h-[64%] w-[17%] bg-[#edefed]" style={{ color: '#0c0d0c' }}>
        <div className="flex h-full items-start justify-center pt-[26%]">
          <Signal tone={lower} size={150} className="h-auto w-[58%] text-[#0c0d0c]" />
        </div>
      </Block>

      {/* amber and blue */}
      <Block delay={0.3} className="top-[4%] right-[2.5%] aspect-square w-[10.5%] rounded-tr-[34%] bg-[#f9b73f]" />
      <Block delay={0.4} className="top-[22%] right-[7.5%] aspect-square w-[4.5%] bg-[#6aa7f4]" />
    </div>
  )
}
