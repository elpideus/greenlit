import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Browser, type BrowserContext, chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DriverAccount, DriverRun } from './types.ts'
import { youtube } from './youtube.ts'

/**
 * YouTube Studio's video page as the robot meets it, in a fresh browser with no profile: every request is answered
 * here, nothing goes out. Shaped after Studio's own page of a scheduled Short (26 Nov 2026, screenshot of the failed
 * reschedule): the visibility menu opens over the page with its Schedule part already open, its date field on the
 * left and its time field across the middle. Clicking into the time field opens its list over a backdrop that covers
 * the whole page and takes every click until the list closes (Polymer's iron overlays do the same).
 */
function studioPage(opts: { scheduled: boolean; date?: string; time?: string; listStaysOpen?: boolean }) {
  const date = opts.date ?? '23 gen 2027'
  const time = opts.time ?? '13:00'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box }
body { margin: 0; font: 14px sans-serif; width: 1366px; height: 860px }
ytcp-video-metadata-visibility, ytcp-video-visibility-select, ytcp-visibility-scheduler, ytcp-datetime-picker,
ytcp-text-dropdown-trigger, ytcp-button, tp-yt-iron-dropdown, tp-yt-paper-listbox, tp-yt-paper-item, ytcp-date-picker,
tp-yt-paper-input, tp-yt-iron-overlay-backdrop, ytcp-form-input-container { display: block }
[hidden] { display: none !important }
#textbox { border: 1px solid #ccc; min-height: 24px; margin: 8px }
ytcp-button { display: inline-block; padding: 8px 16px; border: 1px solid #333; cursor: pointer }
ytcp-button[aria-disabled="true"] { opacity: .4 }
ytcp-video-metadata-visibility { position: absolute; left: 990px; top: 340px; width: 352px; height: 60px; border: 1px solid #999 }
#select-button { height: 58px; padding: 18px }
#popup { position: fixed; left: 746px; top: 430px; width: 620px; background: #fff; border: 1px solid #ccc; padding: 20px 24px; z-index: 100 }
.part { border: 1px solid #333; border-radius: 12px; padding: 20px; margin-bottom: 12px }
ytcp-visibility-scheduler.part { height: 177px }
.part h3 { margin: 0; height: 24px; font-size: 16px }
.label { height: 20px; margin-top: 8px }
.row { display: flex; gap: 10px; margin-top: 8px; height: 46px }
#datepicker-trigger { width: 168px; height: 46px; border: 1px solid #999; padding: 12px }
#time-of-day-container { width: 126px }
#time-of-day-container input { width: 126px; height: 46px }
.note { height: 20px; margin-top: 8px }
tp-yt-iron-overlay-backdrop { position: fixed; inset: 0; z-index: 101; display: none }
tp-yt-iron-overlay-backdrop.opened { display: block }
#time-list { position: fixed; z-index: 102; background: #fff; border: 1px solid #ccc; width: 126px }
ytcp-date-picker { position: fixed; z-index: 102; background: #fff; border: 1px solid #ccc; width: 260px }
</style></head><body>
<h1>Dettagli video</h1>
<ytcp-button id="save" aria-disabled="true">Salva</ytcp-button>
<div id="title-textarea"><div id="textbox" contenteditable="true">Old title</div></div>
<div id="description-textarea"><div id="textbox" contenteditable="true">Old description</div></div>
<ytcp-button id="toggle-button">Mostra altro</ytcp-button>
<div id="tags-container" hidden><span id="chips"><ytcp-chip>old tag <span id="delete-icon">x</span></ytcp-chip></span>
  <input id="text-input"></div>
<ytcp-video-metadata-visibility><div id="select-button">Visibilità: ${opts.scheduled ? 'Programmato' : 'Privato'}</div></ytcp-video-metadata-visibility>
<div id="popup" hidden><ytcp-video-visibility-select>
  <div class="part"><h3>Salva o pubblica</h3></div>
  ${opts.scheduled ? '' : '<div class="part"><h3>Programmazione <span id="second-container-expand-button">v</span></h3></div>'}
  <ytcp-visibility-scheduler class="part" ${opts.scheduled ? '' : 'hidden'}>
    <h3>Programmazione</h3>
    <div class="label">Programma come pubblico</div>
    <ytcp-datetime-picker class="row">
      <ytcp-text-dropdown-trigger id="datepicker-trigger">${date}</ytcp-text-dropdown-trigger>
      <ytcp-form-input-container id="time-of-day-container"><input value="${time}"></ytcp-form-input-container>
    </ytcp-datetime-picker>
    <div class="note">Il video è privato prima della pubblicazione</div>
  </ytcp-visibility-scheduler>
  <ytcp-button id="save-button" aria-disabled="true">Fine</ytcp-button>
</ytcp-video-visibility-select></div>
<tp-yt-iron-overlay-backdrop></tp-yt-iron-overlay-backdrop>
<tp-yt-iron-dropdown id="time-list" aria-hidden="true" hidden><tp-yt-paper-listbox>
  <tp-yt-paper-item>13:00</tp-yt-paper-item><tp-yt-paper-item>13:15</tp-yt-paper-item><tp-yt-paper-item>13:30</tp-yt-paper-item>
</tp-yt-paper-listbox></tp-yt-iron-dropdown>
<ytcp-date-picker hidden><div id="calendar-main"><tp-yt-paper-input><input></tp-yt-paper-input></div></ytcp-date-picker>
<script>
const $ = (s) => document.querySelector(s)
const start = { date: ${JSON.stringify(date)}, time: ${JSON.stringify(time)} }
window.clicks = []
document.addEventListener('click', (e) => window.clicks.push(e.target.id || e.target.tagName.toLowerCase()), true)
const dirty = () => $('#save').setAttribute('aria-disabled', 'false')
for (const box of document.querySelectorAll('[contenteditable]')) box.addEventListener('input', dirty)
$('#toggle-button').onclick = () => { $('#tags-container').hidden = false }
$('#chips').onclick = (e) => { if (e.target.id === 'delete-icon') { e.target.parentElement.remove(); dirty() } }
$('#text-input').oninput = (e) => {
  const parts = e.target.value.split(',')
  e.target.value = parts.pop()
  for (const p of parts) if (p.trim()) { const c = document.createElement('ytcp-chip'); c.textContent = p.trim(); $('#chips').append(c) }
  dirty()
}
$('ytcp-video-metadata-visibility').onclick = () => { $('#popup').hidden = false }
$('#second-container-expand-button')?.addEventListener('click', () => { $('ytcp-visibility-scheduler').hidden = false })
const backdrop = $('tp-yt-iron-overlay-backdrop'), list = $('#time-list'), picker = $('ytcp-date-picker')
const timeInput = $('#time-of-day-container input'), trigger = $('#datepicker-trigger')
const placeUnder = (el, under) => { const r = under.getBoundingClientRect(); el.style.left = r.left + 'px'; el.style.top = r.bottom + 'px' }
const openList = () => {
  if (!list.hidden) return
  const r = timeInput.getBoundingClientRect()
  list.style.left = r.left + 'px'; list.style.top = (r.top - 100) + 'px'
  list.hidden = false; list.removeAttribute('aria-hidden'); backdrop.classList.add('opened')
}
const closeList = () => { list.hidden = true; list.setAttribute('aria-hidden', 'true'); backdrop.classList.remove('opened') }
timeInput.addEventListener('focus', openList)
timeInput.addEventListener('click', openList)
backdrop.addEventListener('click', closeList)
const changed = () => {
  const off = trigger.textContent.trim() === start.date && timeInput.value === start.time
  $('#save-button').setAttribute('aria-disabled', String(off))
}
timeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { changed(); ${opts.listStaysOpen ? '' : 'closeList()'} } })
trigger.onclick = () => { placeUnder(picker, trigger); picker.hidden = false; picker.querySelector('input').value = trigger.textContent.trim() }
picker.querySelector('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { trigger.textContent = e.target.value; picker.hidden = true; changed() }
})
// Escape closes the topmost overlay only, as Polymer's overlay manager does.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!list.hidden) closeList()
  else if (!picker.hidden) picker.hidden = true
  else $('#popup').hidden = true
})
$('#save-button').onclick = (e) => {
  if (e.currentTarget.getAttribute('aria-disabled') === 'true') return
  $('#popup').hidden = true; dirty()
}
$('#save').onclick = (e) => {
  if (e.currentTarget.getAttribute('aria-disabled') === 'true') return
  window.saved = {
    date: trigger.textContent.trim(), time: timeInput.value,
    title: document.querySelector('#title-textarea #textbox').textContent,
    tags: [...document.querySelectorAll('#chips ytcp-chip')].map((c) => c.textContent.trim()),
  }
}
</script></body></html>`
}

const chromiumPath = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) =>
  existsSync(p),
)
const account: DriverAccount = {
  id: 'a1',
  platform: 'youtube',
  externalId: 'UC0000000000000000000000',
  name: 'Acme Studio',
  handle: '@acmestudio',
  platformIds: { channelId: 'UC0000000000000000000000' },
}
const timeZone = 'Europe/Rome'
/** A time a month ahead, on the hour in Rome, and how Studio (in Italian) shows it. */
const ahead = () => {
  const d = new Date(Date.now() + 30 * 86_400_000)
  d.setUTCMinutes(0, 0, 0)
  const date = new Intl.DateTimeFormat('it-IT', { timeZone, day: 'numeric', month: 'short', year: 'numeric' })
    .format(d)
    .replace('.', '')
  const time = new Intl.DateTimeFormat('it-IT', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d)
  return { at: d, date, time }
}

describe.skipIf(!chromiumPath)('YouTube Studio: changing a video on its page', () => {
  let browser: Browser
  let dataDir: string
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
    dataDir = mkdtempSync(join(tmpdir(), 'greenlit-yt-'))
  })
  afterAll(async () => {
    await browser?.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  async function studio(page: string) {
    const context: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 860 } })
    context.setDefaultTimeout(4000)
    // Only the video's page is answered; nothing else leaves the browser.
    await context.route('**/*', (route) =>
      route.request().url().startsWith('https://studio.youtube.com/video/')
        ? route.fulfill({ contentType: 'text/html', body: page })
        : route.abort(),
    )
    const pages: import('playwright-core').Page[] = []
    const steps: string[] = []
    const warnings: string[] = []
    const run: DriverRun = {
      context,
      log: {} as DriverRun['log'],
      timeZone,
      locale: 'it-IT',
      dataDir,
      page: async () => {
        const p = await context.newPage()
        pages.push(p)
        return p
      },
      step: (m) => steps.push(m),
      warn: (m) => warnings.push(m),
      snapshot: async () => null,
    }
    const read = <T>(what: string) => pages[0]!.evaluate((w) => (window as never)[w], what) as Promise<T>
    return { run, steps, warnings, read, close: () => context.close() }
  }

  it('moves a scheduled video to a new date without clicking into its time field first', async () => {
    const s = await studio(studioPage({ scheduled: true }))
    const want = ahead()
    try {
      await youtube.update(s.run, account, 'abcdefghijk', {
        tags: ['house', 'garden'],
        scheduleAt: want.at,
        timeZone,
        translations: {},
      })
      const saved = await s.read<{ date: string; time: string; tags: string[] }>('saved')
      expect(saved).toMatchObject({ date: want.date, time: want.time, tags: ['house', 'garden'] })
      // The Schedule part was open: the robot went straight to its date field.
      const clicks = await s.read<string[]>('clicks')
      expect(clicks.indexOf('datepicker-trigger')).toBeGreaterThan(-1)
      expect(clicks.slice(0, clicks.indexOf('datepicker-trigger'))).not.toContain('input')
    } finally {
      await s.close()
    }
  }, 60_000)

  it('closes a time list left open before pressing Done', async () => {
    const s = await studio(studioPage({ scheduled: true, listStaysOpen: true }))
    const want = ahead()
    try {
      await youtube.update(s.run, account, 'abcdefghijk', { scheduleAt: want.at, timeZone, translations: {} })
      expect(await s.read('saved')).toMatchObject({ date: want.date, time: want.time })
    } finally {
      await s.close()
    }
  }, 60_000)

  it('opens the Schedule part of a video that is not scheduled yet', async () => {
    const s = await studio(studioPage({ scheduled: false, date: '26 nov 2026', time: '10:00' }))
    const want = ahead()
    try {
      await youtube.update(s.run, account, 'abcdefghijk', { scheduleAt: want.at, timeZone, translations: {} })
      expect(await s.read('saved')).toMatchObject({ date: want.date, time: want.time })
    } finally {
      await s.close()
    }
  }, 60_000)

  it('leaves the schedule alone when it already is the one asked for, and still saves the rest', async () => {
    const want = ahead()
    const s = await studio(studioPage({ scheduled: true, date: want.date, time: want.time }))
    try {
      await youtube.update(s.run, account, 'abcdefghijk', {
        tags: ['house'],
        scheduleAt: want.at,
        timeZone,
        translations: {},
      })
      expect(await s.read('saved')).toMatchObject({ date: want.date, time: want.time, tags: ['house'] })
      expect(s.steps.join('\n')).toMatch(/already/)
    } finally {
      await s.close()
    }
  }, 60_000)

  it('keeps what it saved and only warns when Studio takes no translations', async () => {
    // The Languages page here has no "Add language" (as for a video with no language of its own, 26 Nov 2026).
    const s = await studio(studioPage({ scheduled: true }))
    const want = ahead()
    try {
      await youtube.update(s.run, account, 'abcdefghijk', {
        scheduleAt: want.at,
        timeZone,
        translations: { en: { title: 'Title', caption: 'Text' } },
      })
      expect(await s.read('saved')).toMatchObject({ date: want.date, time: want.time })
      expect(s.warnings).toEqual([expect.stringMatching(/^Translations not added: /)])
    } finally {
      await s.close()
    }
  }, 60_000)

  it('stops before saving when Studio does not show the date it was given', async () => {
    const s = await studio(
      studioPage({ scheduled: true }).replace('trigger.textContent = e.target.value', 'void 0'),
    )
    const want = ahead()
    try {
      await expect(
        youtube.update(s.run, account, 'abcdefghijk', { scheduleAt: want.at, timeZone, translations: {} }),
      ).rejects.toThrow(/shows/)
      expect(await s.read('saved')).toBeUndefined()
    } finally {
      await s.close()
    }
  }, 60_000)
})
