import type { Connectable, RemoteSession } from '@greenlit/shared/areas/connectors'
import type { Platform } from '@greenlit/shared/areas/posts'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'
import type { Logger } from '../../core/logger.ts'
import type { RealtimeHub } from '../../core/realtime.ts'
import { DEVICE_SCALE, SCREEN } from './browser.ts'
import type { DiscoveredAccount } from './drivers/types.ts'

/**
 * A remote browser the owner drives from Greenlit to sign in: the page is streamed as JPEG frames
 * (CDP Page.startScreencast) over the realtime hub on `connector-session:<id>`, and the viewer sends mouse,
 * wheel, keyboard and text back (`input` messages), which are replayed with CDP Input.* — so the real sign-in
 * page, with its 2-step verification, QR codes and captchas, is in front of a person, never automated.
 */

export interface LiveSession {
  id: string
  platform: Platform
  accountId: string | null
  sessionDir: string
  userId: string | null
  context: BrowserContext
  page: Page
  cdp: CDPSession
  /** The page being shown (a pop-up while one is open). */
  shown: Page
  width: number
  height: number
  dpr: number
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  state: RemoteSession['state']
  message: string | null
  lastFrame: { data: string; w: number; h: number } | null
  lastInput: number
  lastSeenViewer: number
  release: () => void
  cursor: string
  closing: boolean
  /** The driver the sign-in is for. */
  driverId: string
  /** While `choosing`: what the login can reach, and the driver's own records of it. */
  choices: Connectable[] | null
  found: DiscoveredAccount[] | null
}

export type InputMessage =
  | {
      type: 'mouse'
      action: 'move' | 'down' | 'up'
      x: number
      y: number
      button?: 'left' | 'middle' | 'right' | 'none'
      buttons?: number
      clickCount?: number
      modifiers?: number
    }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers?: number }
  | {
      type: 'key'
      action: 'down' | 'up'
      key: string
      code: string
      keyCode: number
      modifiers?: number
      repeat?: boolean
      location?: number
    }
  | { type: 'text'; text: string }
  | { type: 'nav'; action: 'back' | 'forward' | 'reload' | 'stop' | 'home' }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'hello' }

const FRAME_INTERVAL_MS = 45
const NAMED_KEYS: Record<string, { text?: string }> = {
  Enter: { text: '\r' },
  Tab: {},
  Backspace: {},
  Delete: {},
  Escape: {},
  ArrowLeft: {},
  ArrowRight: {},
  ArrowUp: {},
  ArrowDown: {},
  Home: {},
  End: {},
  PageUp: {},
  PageDown: {},
}

export class RemoteStreams {
  private sessions = new Map<string, LiveSession>()
  private popupCdp = new WeakMap<Page, CDPSession>()
  private log: Logger
  private realtime: RealtimeHub
  constructor(log: Logger, realtime: RealtimeHub) {
    this.log = log
    this.realtime = realtime
  }

  get(id: string) {
    return this.sessions.get(id) ?? null
  }

  all() {
    return [...this.sessions.values()]
  }

  view(s: LiveSession): RemoteSession {
    return {
      id: s.id,
      accountId: s.accountId,
      platform: s.platform,
      width: s.width,
      height: s.height,
      url: s.url,
      state: s.state,
      message: s.message,
      ...(s.state === 'choosing' && s.choices ? { choices: s.choices } : {}),
    }
  }

  topic(id: string) {
    return `connector-session:${id}`
  }

  /** Opens a tab in the profile, goes to `url` and starts streaming it. */
  async open(init: {
    id: string
    platform: Platform
    driverId: string
    accountId: string | null
    sessionDir: string
    userId: string | null
    context: BrowserContext
    release: () => void
    url: string
    width: number
    height: number
    dpr: number
  }): Promise<LiveSession> {
    const page = await init.context.newPage()
    const cdp = await init.context.newCDPSession(page)
    const s: LiveSession = {
      ...init,
      page,
      cdp,
      shown: page,
      url: init.url,
      title: '',
      loading: true,
      canGoBack: false,
      canGoForward: false,
      state: 'starting',
      message: null,
      lastFrame: null,
      lastInput: Date.now(),
      lastSeenViewer: Date.now(),
      cursor: 'default',
      closing: false,
      choices: null,
      found: null,
    }
    this.sessions.set(s.id, s)
    await this.attach(s, page, cdp)
    page.on('popup', (popup) => void this.showPopup(s, popup))
    page.on('crash', () =>
      this.setState(s, 'failed', 'The page stopped working. Close this window and try again.'),
    )
    page.goto(init.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((err) => {
      if (!s.closing)
        this.log.warn({ err: (err as Error).message, url: init.url }, 'remote sign-in page did not load')
    })
    s.state = 'ready'
    this.publishState(s)
    return s
  }

  private async attach(s: LiveSession, page: Page, cdp: CDPSession) {
    let pending: { data: string; w: number; h: number } | null = null
    let lastSent = 0
    let scheduled = false
    const flush = () => {
      scheduled = false
      if (!pending || s.shown !== page) return
      s.lastFrame = pending
      lastSent = Date.now()
      this.realtime.publish(this.topic(s.id), 'frame', pending)
      pending = null
    }
    cdp.on('Page.screencastFrame', (f) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
      pending = {
        data: f.data,
        w: Math.round(f.metadata.deviceWidth),
        h: Math.round(f.metadata.deviceHeight),
      }
      const wait = FRAME_INTERVAL_MS - (Date.now() - lastSent)
      if (wait <= 0) flush()
      else if (!scheduled) {
        scheduled = true
        setTimeout(flush, wait)
      }
    })
    const navState = async () => {
      if (s.shown !== page || s.closing) return
      try {
        const h = await cdp.send('Page.getNavigationHistory')
        s.canGoBack = h.currentIndex > 0
        s.canGoForward = h.currentIndex < h.entries.length - 1
        s.url = h.entries[h.currentIndex]?.url ?? page.url()
        s.title = h.entries[h.currentIndex]?.title ?? ''
      } catch {
        s.url = page.url()
      }
      this.publishState(s)
    }
    let mainId: string | null = null
    cdp.on('Page.frameStartedLoading', (e) => {
      if (e.frameId !== mainId) return
      s.loading = true
      void navState()
    })
    cdp.on('Page.frameStoppedLoading', (e) => {
      if (e.frameId !== mainId) return
      s.loading = false
      void navState()
    })
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) void navState()
    })
    await cdp.send('Page.enable')
    // The main frame keeps its id for the life of the tab (it is the target id).
    mainId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id
    // Headless tabs are never "focused": without this, carets and focus rings would not show.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
    await this.applySize(s, cdp)
    await this.startCast(s, cdp)
  }

  private async startCast(s: LiveSession, cdp: CDPSession) {
    await cdp.send('Page.stopScreencast').catch(() => {})
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: s.dpr > 1.5 ? 62 : 72,
      maxWidth: Math.round(s.width * s.dpr),
      maxHeight: Math.round(s.height * s.dpr),
      everyNthFrame: 1,
    })
  }

  private async applySize(s: LiveSession, cdp: CDPSession) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: s.width,
      height: s.height,
      deviceScaleFactor: DEVICE_SCALE,
      mobile: false,
      screenWidth: SCREEN.width,
      screenHeight: SCREEN.height,
    })
  }

  private async showPopup(s: LiveSession, popup: Page) {
    if (s.closing) return
    try {
      const cdp = await s.context.newCDPSession(popup)
      s.shown = popup
      await this.attach(s, popup, cdp)
      popup.once('close', () => {
        if (s.closing || s.shown !== popup) return
        s.shown = s.page
        void this.startCast(s, s.cdp).then(() => this.publishState(s))
      })
      this.popupCdp.set(popup, cdp)
    } catch (err) {
      this.log.debug({ err }, 'could not show pop-up')
    }
  }

  private cdpOf(s: LiveSession): CDPSession {
    return s.shown === s.page ? s.cdp : (this.popupCdp.get(s.shown) ?? s.cdp)
  }

  publishState(s: LiveSession) {
    this.realtime.publish(this.topic(s.id), 'state', {
      ...this.view(s),
      title: s.title,
      loading: s.loading,
      canGoBack: s.canGoBack,
      canGoForward: s.canGoForward,
      dpr: s.dpr,
    })
  }

  setState(
    s: LiveSession,
    state: RemoteSession['state'],
    message: string | null,
    extra?: Record<string, unknown>,
  ) {
    s.state = state
    s.message = message
    this.publishState(s)
    if (extra) this.realtime.publish(this.topic(s.id), 'event', extra)
  }

  /** Replays the viewer's input on the page. */
  async input(s: LiveSession, m: InputMessage, onActivity: () => void) {
    if (s.closing || s.state === 'closed') return
    const cdp = this.cdpOf(s)
    if (m.type !== 'hello') {
      s.lastInput = Date.now()
      onActivity()
    }
    s.lastSeenViewer = Date.now()
    const clampX = (x: number) => Math.max(0, Math.min(s.width - 1, x))
    const clampY = (y: number) => Math.max(0, Math.min(s.height - 1, y))
    switch (m.type) {
      case 'hello':
        return
      case 'mouse': {
        const type =
          m.action === 'move' ? 'mouseMoved' : m.action === 'down' ? 'mousePressed' : 'mouseReleased'
        await cdp.send('Input.dispatchMouseEvent', {
          type,
          x: clampX(m.x),
          y: clampY(m.y),
          button: m.action === 'move' ? (m.button ?? 'none') : (m.button ?? 'left'),
          buttons: m.buttons ?? 0,
          clickCount: m.action === 'move' ? 0 : Math.max(1, Math.min(3, m.clickCount ?? 1)),
          modifiers: m.modifiers ?? 0,
          pointerType: 'mouse',
        })
        if (m.action === 'move') this.trackCursor(s, clampX(m.x), clampY(m.y))
        return
      }
      case 'wheel':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: clampX(m.x),
          y: clampY(m.y),
          deltaX: Math.max(-2000, Math.min(2000, m.deltaX)),
          deltaY: Math.max(-2000, Math.min(2000, m.deltaY)),
          modifiers: m.modifiers ?? 0,
          pointerType: 'mouse',
        })
        return
      case 'key': {
        const named = NAMED_KEYS[m.key]
        const modifiers = m.modifiers ?? 0
        const printable = m.key.length === 1
        // Only named keys and shortcuts arrive here; typed text comes as `text` (IME-safe).
        if (!named && !printable && !/^F\d{1,2}$/.test(m.key)) return
        const withText = m.action === 'down' && named?.text && !(modifiers & (2 | 4))
        await cdp.send('Input.dispatchKeyEvent', {
          type: m.action === 'up' ? 'keyUp' : withText ? 'keyDown' : 'rawKeyDown',
          key: m.key,
          code: m.code,
          windowsVirtualKeyCode: m.keyCode,
          nativeVirtualKeyCode: m.keyCode,
          modifiers,
          autoRepeat: !!m.repeat,
          location: m.location ?? 0,
          ...(withText ? { text: named!.text, unmodifiedText: named!.text } : {}),
        })
        return
      }
      case 'text':
        if (m.text) await cdp.send('Input.insertText', { text: m.text.slice(0, 20_000) })
        return
      case 'nav': {
        const page = s.shown
        if (m.action === 'back') await page.goBack({ timeout: 15_000 }).catch(() => {})
        else if (m.action === 'forward') await page.goForward({ timeout: 15_000 }).catch(() => {})
        else if (m.action === 'reload') await page.reload({ timeout: 30_000 }).catch(() => {})
        else if (m.action === 'stop') await cdp.send('Page.stopLoading').catch(() => {})
        return
      }
      case 'resize': {
        const width = Math.round(Math.max(360, Math.min(2560, m.width)))
        const height = Math.round(Math.max(320, Math.min(1600, m.height)))
        const dpr = Math.max(1, Math.min(2, Math.round((m.dpr || 1) * 4) / 4))
        if (width === s.width && height === s.height && dpr === s.dpr) {
          if (s.lastFrame) this.realtime.publish(this.topic(s.id), 'frame', s.lastFrame)
          return
        }
        s.width = width
        s.height = height
        s.dpr = dpr
        await this.applySize(s, cdp)
        await this.startCast(s, cdp)
        this.publishState(s)
        return
      }
    }
  }

  private cursorBusy = new Set<string>()
  /** Tells the viewer which mouse cursor the page shows at the pointer (hand over links, I-beam over text). */
  private trackCursor(s: LiveSession, x: number, y: number) {
    if (this.cursorBusy.has(s.id)) return
    this.cursorBusy.add(s.id)
    setTimeout(() => this.cursorBusy.delete(s.id), 90)
    s.shown
      .evaluate(
        ([px, py]) => {
          let el = document.elementFromPoint(px!, py!) as HTMLElement | null
          // Same-origin frames: look inside.
          while (el && el.tagName === 'IFRAME') {
            try {
              const r = el.getBoundingClientRect()
              const inner = (el as HTMLIFrameElement).contentDocument?.elementFromPoint(
                px! - r.left,
                py! - r.top,
              ) as HTMLElement | null
              if (!inner) break
              el = inner
            } catch {
              break
            }
          }
          if (!el) return 'default'
          const c = getComputedStyle(el).cursor
          if (c && c !== 'auto') return c
          if (
            el.isContentEditable ||
            (el.tagName === 'INPUT' &&
              !/^(button|submit|checkbox|radio|range|color|file|image|reset)$/i.test(
                (el as HTMLInputElement).type,
              )) ||
            el.tagName === 'TEXTAREA'
          )
            return 'text'
          if (el.closest('a[href],button,[role=button],label,select,summary')) return 'pointer'
          return 'default'
        },
        [x, y],
      )
      .then((cursor) => {
        if (cursor !== s.cursor) {
          s.cursor = cursor
          this.realtime.publish(this.topic(s.id), 'cursor', { cursor })
        }
      })
      .catch(() => {})
  }

  async close(s: LiveSession, reason: string | null) {
    if (s.closing) return
    s.closing = true
    this.sessions.delete(s.id)
    s.state = s.state === 'signed_in' ? 'signed_in' : 'closed'
    s.message = reason
    this.realtime.publish(this.topic(s.id), 'state', {
      ...this.view(s),
      state: s.state === 'signed_in' ? 'signed_in' : 'closed',
    })
    this.realtime.publish(this.topic(s.id), 'closed', { reason })
    await s.cdp.send('Page.stopScreencast').catch(() => {})
    for (const p of s.context.pages())
      if (p !== s.page && (await p.opener().catch(() => null)) === s.page) await p.close().catch(() => {})
    await s.page.close().catch(() => {})
    s.release()
  }
}
