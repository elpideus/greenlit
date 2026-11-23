import { cn } from '@/lib/cn'

/** A format's shape drawn to scale inside a square (16:9, 9:16, 1:1…). Kept on its own: light enough for any tab. */
export function AspectBox({
  w,
  h,
  size = 22,
  active,
}: {
  w: number
  h: number
  size?: number
  active?: boolean
}) {
  const r = w / h
  const bw = r >= 1 ? size : size * r
  const bh = r >= 1 ? size / r : size
  return (
    <span className="grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <span
        className={cn(
          'rounded-[2.5px]',
          active ? 'shadow-[inset_0_0_0_1.5px_currentColor]' : 'shadow-[inset_0_0_0_1.5px_var(--ink-3)]',
        )}
        style={{ width: bw, height: bh }}
      />
    </span>
  )
}
