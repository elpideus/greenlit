import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

type State = 'draft' | 'review' | 'changes' | 'greenlit' | 'scheduled'
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [
  ...r.querySelectorAll<T>(s),
]

export function boot() {
  const motion = document.documentElement.classList.contains('motion')
  const lenis = motion ? smooth() : null
  header(lenis)
  reveals()
  copyButtons()
  menu()
  film()
  autoplay(motion)
  if (document.body.dataset.page !== 'home') return
  hero(motion)
  chapters()
  statement(motion)
  review()
  moment(motion)
  terminal(motion)
  if (motion) stage()
}

// ── smooth scroll on GSAP's clock ─────────────────────────────────────────
function smooth() {
  const lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - (1 - t) ** 4, smoothWheel: true })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
  for (const a of $$<HTMLAnchorElement>('a[href^="#"]')) {
    const id = a.getAttribute('href')!
    if (id.length < 2) continue
    a.addEventListener('click', (e) => {
      const t = $(id)
      if (!t) return
      e.preventDefault()
      lenis.scrollTo(t, { offset: -72, duration: 1.4 })
      history.replaceState(null, '', id)
    })
  }
  return lenis
}

// ── header: material once something is under it, steps aside on the way down ─
function header(lenis: Lenis | null) {
  const root = document.documentElement
  let last = 0
  const onScroll = (y: number) => {
    root.classList.toggle('scrolled', y > 8)
    if (Math.abs(y - last) > 6) {
      root.classList.toggle('top-away', y > 640 && y > last)
      last = y
    }
  }
  if (lenis) lenis.on('scroll', ({ scroll }: { scroll: number }) => onScroll(scroll))
  // native scroll too: jumps, restores and programmatic scrolls don't always go through Lenis
  addEventListener('scroll', () => onScroll(scrollY), { passive: true })
  onScroll(scrollY)
}

// ── reveals: blocks and headline words come out of focus ─────────────────
function reveals() {
  for (const h of $$('[data-words]')) {
    const text = h.textContent ?? ''
    h.textContent = ''
    text.split(' ').forEach((w, i, all) => {
      const s = document.createElement('span')
      s.className = 'sw'
      s.style.setProperty('--i', String(i))
      s.textContent = w
      h.append(s)
      if (i < all.length - 1) h.append(' ')
    })
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('in')
        io.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  )
  for (const el of $$('[data-reveal], [data-words]')) {
    // the first screen sets itself on load, in order
    if (el.closest('.hero, .guide') && el.getBoundingClientRect().top < innerHeight) {
      requestAnimationFrame(() => el.classList.add('in'))
      continue
    }
    io.observe(el)
  }
}

// ── hero: the wordmark wipes in out of focus, its lamp lights, the blocks arrive ─
function hero(motion: boolean) {
  const wm = $('.hero__wm')
  const dot = $('.hero__dot')
  const sigs = $$<SVGElement>('.comp .signal')
  const lightUp = () => {
    sigs[0]?.setAttribute('data-state', 'greenlit')
    sigs[2]?.setAttribute('data-state', 'review')
  }
  if (!wm || !motion) {
    lightUp()
    return
  }
  gsap.set(dot, { scale: 0, transformOrigin: '50% 50%' })
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
  tl.fromTo(
    wm,
    { clipPath: 'inset(-20% 100% -20% 0%)', x: -40, filter: 'blur(14px)' },
    { clipPath: 'inset(-20% 0% -20% 0%)', x: 0, filter: 'blur(0px)', duration: 1.5 },
    0.1,
  )
    .to(dot, { scale: 1, duration: 0.8, ease: 'back.out(3)' }, 1.05)
    .from('[data-comp="col"]', { yPercent: 70, duration: 1.4 }, 0.15)
    .from('[data-comp="panel"]', { yPercent: 90, duration: 1.4 }, 0.3)
    .from('[data-comp="tile"]', { yPercent: -160, duration: 1.3 }, 0.42)
    .from('[data-comp="sq"]', { scale: 0, duration: 0.9 }, 0.62)
    .call(lightUp, [], 1.15)
  // at rest the signals keep working: a quiet cycle through the states
  const cycle: [number, State][][] = [
    [
      [0, 'greenlit'],
      [1, 'draft'],
      [2, 'review'],
    ],
    [
      [0, 'greenlit'],
      [1, 'review'],
      [2, 'review'],
    ],
    [
      [0, 'scheduled'],
      [1, 'review'],
      [2, 'draft'],
    ],
    [
      [0, 'scheduled'],
      [1, 'greenlit'],
      [2, 'review'],
    ],
  ]
  let k = 0
  const tick = () => {
    if (document.hidden || scrollY > innerHeight) return
    k = (k + 1) % cycle.length
    for (const [i, s] of cycle[k]) sigs[i]?.setAttribute('data-state', s)
  }
  setTimeout(() => setInterval(tick, 2600), 2400)
}

// ── the product rises out of the page, like a screen opening ─────────────
function stage() {
  const w = $('[data-stage]')
  if (!w) return
  gsap.fromTo(
    w,
    { rotateX: 14, scale: 0.92, y: 40 },
    {
      rotateX: 0,
      scale: 1,
      y: 0,
      ease: 'none',
      scrollTrigger: { trigger: w, start: 'top 98%', end: 'top 22%', scrub: true, invalidateOnRefresh: true },
    },
  )
}

// ── the header lamp tells which state the page is in ──────────────────────
function chapters() {
  const sig = $('.brand .signal')
  const links = new Map($$<HTMLAnchorElement>('[data-nav]').map((a) => [a.dataset.nav!, a]))
  for (const sec of $$('[data-chapter], section[id]')) {
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: ({ isActive }) => {
        if (!isActive) return
        const st = sec.dataset.chapter as State | undefined
        if (st && sig) sig.setAttribute('data-state', st)
        for (const [id, a] of links) a.toggleAttribute('aria-current', id === sec.id)
        if (sec.id && links.has(sec.id)) links.get(sec.id)!.setAttribute('aria-current', 'true')
      },
    })
  }
}

// ── statement: words light one by one as you read ───────────────────────
function statement(motion: boolean) {
  const p = $('[data-statement]')
  if (!p) return
  const words = $$('.w', p)
  if (!motion) {
    for (const w of words) w.classList.add('on')
    return
  }
  ScrollTrigger.create({
    trigger: p,
    start: 'top 78%',
    end: 'bottom 42%',
    scrub: true,
    onUpdate: ({ progress }) => {
      const n = Math.round(progress * words.length)
      words.forEach((w, i) => {
        w.classList.toggle('on', i < n)
      })
    },
  })
}

// ── review: the frame flips green on the real Accept click (10.05 s in) ──
function review() {
  const v = $<HTMLVideoElement>('[data-review-video]')
  const frame = $('[data-review-frame]')
  const sig = $('.status .signal')
  const texts = $$('[data-status]')
  if (!v || !frame) return
  const ACCEPT = 9.8
  let state: State = 'review'
  const set = (s: State) => {
    if (s === state) return
    state = s
    frame.dataset.state = s
    sig?.setAttribute('data-state', s)
    for (const t of texts) t.setAttribute('aria-hidden', String(t.dataset.status !== s))
    if (s === 'greenlit') {
      frame.classList.remove('flash')
      void frame.offsetWidth
      frame.classList.add('flash')
    }
  }
  v.addEventListener('timeupdate', () => set(v.currentTime >= ACCEPT ? 'greenlit' : 'review'))
  v.addEventListener('ended', () => {
    setTimeout(() => {
      v.currentTime = 0
      set('review')
      if (visible) v.play().catch(() => {})
    }, 1600)
  })
  let visible = false
  new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting
      if (visible) v.play().catch(() => {})
      else v.pause()
    },
    { threshold: 0.35 },
  ).observe(v)
}

// ── the greenlit moment: the i’s lamp lights, then floods the screen ─────
function moment(motion: boolean) {
  const sec = $('[data-moment]')
  const field = $('[data-moment-field]')
  const dot = $<SVGCircleElement>('.moment__dot')
  if (!sec || !field || !dot) return
  if (!motion) {
    dot.classList.add('lit')
    dot.style.setProperty('--s', '1')
    return
  }
  const pin = $('.moment__pin', sec)!
  let cx = 0
  let cy = 0
  let r0 = 0
  let r1 = 0
  const measure = () => {
    const a = pin.getBoundingClientRect()
    const b = dot.getBoundingClientRect()
    cx = b.left + b.width / 2 - a.left
    cy = b.top + b.height / 2 - a.top
    r0 = b.width / 2
    r1 = Math.hypot(Math.max(cx, a.width - cx), Math.max(cy, a.height - cy)) + 2
  }
  ScrollTrigger.create({
    trigger: sec,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    invalidateOnRefresh: true,
    onRefresh: measure,
    onUpdate: ({ progress: p }) => {
      if (!r1) measure()
      const lit = p > 0.14
      dot.classList.toggle('lit', lit)
      dot.style.setProperty('--s', lit ? '1' : '.82')
      const g = gsap.utils.clamp(0, 1, (p - 0.26) / 0.44)
      const e = g < 0.5 ? 4 * g * g * g : 1 - (-2 * g + 2) ** 3 / 2
      const r = g <= 0 ? 0 : r0 + (r1 - r0) * e
      // fully grown: drop the clip, so no corner is ever left uncovered
      field.style.clipPath = g >= 0.995 ? 'none' : `circle(${r}px at ${cx}px ${cy}px)`
    },
  })
}

// ── Claude types in the terminal when it comes into view ─────────────────
function terminal(motion: boolean) {
  const t = $('[data-term]')
  if (!t) return
  const prompt = $('[data-line="prompt"] span:last-child', t)!
  const lines = $$('[data-line]:not([data-line="prompt"])', t)
  if (!motion) return
  const full = prompt.textContent ?? ''
  prompt.textContent = ''
  for (const l of lines) l.style.opacity = '0'
  const caret = document.createElement('span')
  caret.className = 'caret'
  prompt.after(caret)
  new IntersectionObserver(
    ([e], io) => {
      if (!e.isIntersecting) return
      io.disconnect()
      let i = 0
      const typeNext = () => {
        prompt.textContent = full.slice(0, ++i)
        if (i < full.length) setTimeout(typeNext, 28 + Math.random() * 40)
        else {
          caret.remove()
          lines.forEach((l, k) => {
            setTimeout(
              () => {
                l.style.transition = 'opacity .5s var(--ease), transform .6s var(--ease)'
                l.style.transform = 'translateY(4px)'
                requestAnimationFrame(() => {
                  l.style.opacity = '1'
                  l.style.transform = 'none'
                })
              },
              500 + k * 520,
            )
          })
        }
      }
      setTimeout(typeNext, 500)
    },
    { threshold: 0.5 },
  ).observe(t)
}

// ── videos play only while seen; reduced motion keeps the poster ─────────
function autoplay(motion: boolean) {
  const vids = $$<HTMLVideoElement>('video[data-autoplay]')
  if (!motion) {
    for (const v of vids) {
      v.removeAttribute('autoplay')
      v.pause()
    }
    return
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement
        if (e.isIntersecting) v.play().catch(() => {})
        else v.pause()
      }
    },
    { threshold: 0.15 },
  )
  for (const v of vids) io.observe(v)
}

// ── the phone menu ────────────────────────────────────────────────────────
function menu() {
  const b = $<HTMLButtonElement>('[data-menu]')
  if (!b) return
  const root = document.documentElement
  const set = (open: boolean) => {
    root.classList.toggle('menu-open', open)
    b.setAttribute('aria-expanded', String(open))
  }
  b.addEventListener('click', () => set(!root.classList.contains('menu-open')))
  for (const a of $$('#site-nav a')) a.addEventListener('click', () => set(false))
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false)
  })
}

function copyButtons() {
  for (const b of $$<HTMLButtonElement>('[data-copy]')) {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy ?? '')
        b.dataset.done = ''
        b.textContent = 'Copied'
        setTimeout(() => {
          delete b.dataset.done
          b.textContent = 'Copy'
        }, 1600)
      } catch {
        b.textContent = 'Select and copy'
      }
    })
  }
}

function film() {
  const d = $<HTMLDialogElement>('#film')
  const v = $<HTMLVideoElement>('[data-film-video]')
  if (!d || !v) return
  for (const b of $$('#play-film, [data-play-film]')) {
    b.addEventListener('click', (e) => {
      e.preventDefault()
      d.showModal()
      v.currentTime = 0
      v.play().catch(() => {})
    })
  }
  $('[data-film-close]', d)?.addEventListener('click', () => d.close())
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close()
  })
  d.addEventListener('close', () => v.pause())
}
