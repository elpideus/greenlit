import type { Placement } from '@greenlit/shared/areas/posts'
import type { Page } from 'playwright-core'
import {
  ConnectorUnsupported,
  type Driver,
  type DriverRun,
  NeedsLogin,
  noCapabilities,
  type PublishOutcome,
  type PublishRequest,
  type RemotePost,
} from './types.ts'
import {
  clickOne,
  cookie,
  findObjects,
  firstUrl,
  firstVisible,
  label,
  num,
  parseTracks,
  probeClip,
  sleep,
  sniffJson,
  str,
  until,
  zoned,
} from './util.ts'

/**
 * TikTok through TikTok Studio on the web (tiktok.com/tiktokstudio), signed in with the normal account.
 * TikTok refuses password sign-in in automated browsers, so the sign-in page is the QR code: the owner scans
 * it with the TikTok app (Profile → ☰ → Scan).
 *
 * The web scheduler books posts from 15 minutes up to 10 days ahead; TikTok keeps the schedule itself.
 */

const STUDIO = 'https://www.tiktok.com/tiktokstudio'
const UPLOAD = `${STUDIO}/upload?from=webapp&lang=en`
export const TIKTOK_SCHEDULE = { minLeadMinutes: 15, maxLeadDays: 10 }

const L = {
  post: label(['Post', 'Pubblica'], true),
  schedule: label(['Schedule', 'Programma', 'Pianifica'], true),
  showMore: label(['Show more', 'Mostra altro', 'Altre impostazioni', 'More options']),
  whoCanWatch: label([
    'Who can see this post',
    'Who can watch this video',
    'Chi può vedere questo post',
    'Chi può guardare questo video',
  ]),
  everyone: label(['Everyone', 'Tutti'], true),
  friends: label(['Friends', 'Amici'], true),
  onlyYou: label(['Only you', 'Solo tu', 'Solo io'], true),
  comment: label(['Comment', 'Commenti', 'Commento'], true),
  duet: label(['Duet', 'Duetto', 'Duetti'], true),
  stitch: label(['Stitch'], true),
  disclose: label([
    'Disclose post content',
    'Disclose video content',
    'Content disclosure',
    'Divulga i contenuti',
    'Divulgazione dei contenuti',
  ]),
  yourBrand: label(['Your brand', 'Il tuo brand', 'Il tuo marchio']),
  branded: label(['Branded content', 'Contenuto brandizzato', 'Contenuti brandizzati']),
  aiGenerated: label([
    'AI-generated content',
    'Contenuto generato dall’IA',
    "Contenuto generato dall'IA",
    'Contenuti generati dall’IA',
  ]),
  editCover: label(['Edit cover', 'Modifica copertina', 'Select cover', 'Seleziona copertina']),
  uploadCover: label(['Upload cover', 'Carica copertina', 'Upload image', 'Carica immagine']),
  confirm: label(['Confirm', 'Conferma', 'Done', 'Fine', 'Save', 'Salva'], true),
  location: label(['Location', 'Posizione', 'Luogo']),
  photos: label(['Photos', 'Foto'], true),
  addSound: label(['Add sound', 'Aggiungi suono', 'Aggiungi audio']),
  searchSounds: label(['Search sounds', 'Cerca suoni']),
  photoTitle: label(['Add a catchy title', 'Aggiungi un titolo accattivante', 'Aggiungi un titolo']),
  editVideo: label(['Edit video', 'Modifica video', 'Edit', 'Modifica'], true),
  sounds: label(['Sounds', 'Suoni', 'Music', 'Musica']),
  search: label(['Search', 'Cerca']),
  use: label(['Use', 'Usa', 'Add', 'Aggiungi'], true),
  save: label(['Save', 'Salva'], true),
  uploaded: label(['Uploaded', 'Caricato', 'Upload complete', 'Caricamento completato']),
  discard: label(['Discard', 'Scarta', 'Elimina'], true),
  delete: label(['Delete', 'Elimina'], true),
  now: label(['Now', 'Ora', 'Adesso'], true),
}

const capabilities = {
  ...noCapabilities,
  placements: ['video', 'photo'] as Placement[],
  nativeSchedule: true,
  scheduleWindow: { minMinutes: TIKTOK_SCHEDULE.minLeadMinutes, maxDays: TIKTOK_SCHEDULE.maxLeadDays },
  editAfterPublish: false,
  delete: true,
  music: true,
  // Both volumes, in the video editor's Audio panel (sound and original track).
  audioMix: true,
  thumbnail: true,
  location: true,
  sync: true,
  stats: true,
}

export const tiktok: Driver = {
  id: 'tiktok-studio',
  name: 'TikTok Studio',
  platforms: ['tiktok'],
  signIn: { url: 'https://www.tiktok.com/login/qrcode', method: 'qr', cookieDomains: ['tiktok.com'] },
  capabilities: () => capabilities,

  async looksSignedIn(context) {
    return !!(
      (await cookie(context, 'https://www.tiktok.com', 'sessionid')) ??
      (await cookie(context, 'https://www.tiktok.com', 'sid_tt'))
    )
  },

  async discover(run) {
    const me = await whoAmI(run)
    if (!me) return []
    return [
      {
        platform: 'tiktok',
        externalId: me.id,
        name: me.name || me.handle,
        handle: `@${me.handle}`,
        avatarUrl: me.avatar,
        profileUrl: `https://www.tiktok.com/@${me.handle}`,
        platformIds: { userId: me.id, secUid: me.secUid, uniqueId: me.handle },
        capabilities,
      },
    ]
  },

  async check(run, account) {
    if (!(await this.looksSignedIn(run.context)))
      return {
        ok: false,
        reason: 'TikTok signed Greenlit out. Reconnect and scan the QR code with the TikTok app.',
      }
    const me = await whoAmI(run)
    if (!me)
      return {
        ok: false,
        reason: 'TikTok asks to sign in again. Reconnect and scan the QR code with the TikTok app.',
      }
    if (me.id !== account.externalId)
      return { ok: false, reason: `The saved session belongs to @${me.handle}, not ${account.handle}.` }
    return { ok: true }
  },

  async publish(run, account, req) {
    const photo = req.placement === 'photo'
    if (req.placement !== 'video' && !photo)
      throw new ConnectorUnsupported('placement', 'TikTok Studio on the web posts videos and photos')
    // A video post is one video; a photo post is 1 to 35 pictures, the first one its cover (Studio's Photos tab).
    const files = photo
      ? coverFirst(
          req.files.filter((f) => f.kind === 'image').map((f) => f.path),
          req.coverIndex,
        )
      : req.files
          .filter((f) => f.kind === 'video')
          .map((f) => f.path)
          .slice(0, 1)
    if (!files.length)
      throw new Error(photo ? 'A TikTok photo post needs a picture' : 'TikTok needs a video file')
    if (photo && files.length > PHOTO_MAX)
      throw new ConnectorUnsupported('placement', `A TikTok photo post has at most ${PHOTO_MAX} pictures`)
    if (req.scheduleAt) assertWindow(req.scheduleAt)
    const page = await openUpload(run)
    run.step(
      photo
        ? `Uploading ${files.length} picture(s) in TikTok Studio`
        : 'Uploading the video in TikTok Studio',
    )
    const { result: _r, bodies } = await sniffJson(
      page,
      (u) => /tiktok\.com\/(tiktok|api|aweme)\//.test(u),
      async () => {
        if (photo) await openPhotosTab(page)
        await page
          .locator(photo ? 'input[type=file][accept*="image"]' : 'input[type=file]')
          .first()
          .setInputFiles(files)
        await waitUploaded(page, run)
        await dismissTours(page)
        if (photo) await fillTitle(page, run, req)
        await fillDetails(page, run, req)
        if (req.music && photo) await choosePhotoSound(page, run, req)
        else if (req.music) await chooseSound(page, run, req)
        await setSchedule(page, run, req)
        const button = await firstVisible(
          [
            page.locator('[data-e2e="post_video_button"]'),
            page.getByRole('button', { name: req.scheduleAt ? L.schedule : L.post }),
          ],
          15_000,
        )
        if (!button) throw new Error('Could not find the Post button')
        await until(
          async () => (await button.isEnabled()) && (await button.getAttribute('aria-disabled')) !== 'true',
          'the Post button to be ready',
          10 * 60_000,
          1500,
        )
        if (req.dryRun) return
        run.step(req.scheduleAt ? 'Pressing Schedule' : 'Pressing Post')
        await button.click()
        // TikTok sometimes asks to confirm "Post now" when checks are still running.
        const again = await firstVisible(
          [
            page.getByRole('button', {
              name: label(['Post now', 'Pubblica ora', 'Continue', 'Continua'], true),
            }),
          ],
          4000,
        )
        if (again) await again.click()
        await until(
          async () =>
            !/\/upload/.test(page.url()) ||
            (await page
              .getByText(
                label([
                  'Your video has been uploaded',
                  'Il tuo video è stato caricato',
                  'Manage your posts',
                  'Gestisci i tuoi post',
                  'scheduled',
                  'programmato',
                ]),
              )
              .first()
              .isVisible()
              .catch(() => false)),
          'TikTok to confirm the post',
          5 * 60_000,
          1500,
        )
      },
      2500,
    )
    if (req.dryRun) {
      const shot = await run.snapshot(page, 'before-post')
      await leaveUpload(page)
      return {
        remoteId: 'dry-run',
        url: null,
        state: req.scheduleAt ? 'scheduled' : 'published',
        dryRun: {
          steps: [],
          warnings: [],
          screenshot: shot,
          wouldPress: req.scheduleAt ? 'Schedule' : 'Post',
        },
      } satisfies PublishOutcome
    }
    // The post answer names the new item; otherwise find it in the content list by caption.
    let id = findObjects(
      bodies.map((b) => b.json),
      (o) => !!str(o.item_id ?? o.aweme_id ?? o.itemId),
    )
      .map((o) => str(o.item_id ?? o.aweme_id ?? o.itemId))
      .find(Boolean)
    if (!id) {
      // TikTok lists a new post after a little while: look a few times.
      const want = normalize(req.caption).slice(0, 60)
      for (let i = 0; i < 3 && !id; i++) {
        await sleep(i ? 20_000 : 5000)
        const posts = await this.list(run, account, {}).catch(() => [] as RemotePost[])
        id = posts.find(
          (p) => normalize(p.caption).startsWith(want) && (!req.scheduleAt || p.state === 'scheduled'),
        )?.remoteId
      }
    }
    if (!id) {
      run.warn('TikTok accepted the post but did not say its id yet; the next sync links it.')
      id = `pending:${Date.now()}`
    }
    const handle = account.platformIds.uniqueId || account.handle.replace(/^@/, '')
    return {
      remoteId: id,
      url: id.startsWith('pending:')
        ? null
        : `https://www.tiktok.com/@${handle}/${photo ? 'photo' : 'video'}/${id}`,
      state: req.scheduleAt ? 'scheduled' : 'published',
    }
  },

  async update(_run, _account, _remoteId, patch) {
    const keys = Object.keys(patch).filter(
      (k) => k !== 'accountId' && k !== 'timeZone' && patch[k as keyof PublishRequest] !== undefined,
    )
    if (!keys.length) return
    throw new ConnectorUnsupported(
      keys.join(', '),
      'TikTok does not let you change a post’s caption, cover, sound or schedule after it is posted or scheduled. Delete it and post again.',
    )
  },

  async remove(run, account, remoteId) {
    if (remoteId.startsWith('pending:') || remoteId === 'dry-run') return
    const page = await run.page()
    run.step('Opening the TikTok Studio content list')
    await page.goto(`${STUDIO}/content`, { waitUntil: 'domcontentloaded' })
    await ensureSignedIn(page)
    const row = await until(
      async () => {
        // a video's row links to /video/<id>, a photo post's to /photo/<id>
        const link = page.locator(`a[href*="/video/${remoteId}"], a[href*="/photo/${remoteId}"]`).first()
        if (await link.isVisible().catch(() => false)) return link
        await page.mouse.wheel(0, 900)
        return null
      },
      'the post in the content list',
      45_000,
      800,
    )
    // The row's own "…" menu, then Delete, then confirm.
    const container = row.locator('xpath=ancestor::*[.//button][1]')
    await container.hover().catch(() => {})
    await clickOne(
      [
        container.getByRole('button', {
          name: label(['More', 'Altro', 'Altre opzioni', 'Options', 'Opzioni']),
        }),
        container.locator('button[aria-haspopup]'),
        container.locator('button').last(),
      ],
      'the post menu',
    )
    await clickOne([page.getByRole('menuitem', { name: L.delete }), page.getByText(L.delete)], 'Delete')
    await clickOne(
      [
        page.getByRole('dialog').getByRole('button', { name: L.delete }),
        page.getByRole('button', { name: L.delete }).last(),
      ],
      'the delete confirmation',
    )
    run.step(`Deleted ${remoteId} from ${account.handle}`)
    await sleep(2000)
  },

  async list(run, account) {
    const page = await run.page()
    const { bodies } = await sniffJson(
      page,
      (u) => /tiktok\.com\/(tiktok|api|aweme)\//.test(u),
      async () => {
        await page.goto(`${STUDIO}/content`, { waitUntil: 'domcontentloaded' })
        await sleep(3500)
        await ensureSignedIn(page)
        for (let i = 0; i < 4; i++) {
          await page.mouse.wheel(0, 1500)
          await sleep(900)
        }
      },
      2000,
    )
    const handle = account.platformIds.uniqueId || account.handle.replace(/^@/, '')
    const posts = parseItems(
      bodies.map((b) => b.json),
      handle,
    )
    if (!posts.length)
      run.warn('TikTok Studio returned no posts (empty account, or the content page changed).')
    return posts
  },

  async searchMusic(run, _account, query, placement) {
    if (placement !== 'video' && placement !== 'photo') return []
    const page = await openUpload(run)
    try {
      await page
        .locator('input[type=file]')
        .first()
        .setInputFiles(await probeClip(run.dataDir))
      await waitUploaded(page, run, 3 * 60_000)
      const { bodies } = await sniffJson(
        page,
        (u) => /music|sound|aweme/.test(u),
        async () => {
          await openSounds(page)
          if (query) {
            const box = await firstVisible(
              [
                page.getByRole('searchbox'),
                page.getByPlaceholder(L.search),
                page.locator('input[type=search]'),
                page.locator('input[placeholder]'),
              ],
              8000,
            )
            if (!box) throw new Error('TikTok’s sound search box did not show up')
            await box.fill(query)
            await box.press('Enter')
          }
          await sleep(3500)
        },
        1500,
      )
      return parseTracks(bodies).slice(0, 40)
    } finally {
      await leaveUpload(page)
    }
  },
}

// ── helpers ─────────────────────────────────────────────────────────────

async function whoAmI(
  run: DriverRun,
): Promise<{ id: string; handle: string; name: string; avatar: string | null; secUid: string } | null> {
  const page = await run.page()
  await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded' })
  // 1. The account endpoint the site itself calls.
  const info = (await page
    .evaluate(async () => {
      const r = await fetch('/passport/web/account/info/?aid=1988', { credentials: 'include' })
      return r.ok ? r.json() : null
    })
    .catch(() => null)) as { data?: Record<string, unknown> } | null
  const d = info?.data
  if (d && str(d.user_id_str ?? d.user_id) && str(d.username)) {
    return {
      id: str(d.user_id_str ?? d.user_id),
      handle: str(d.username),
      name: str(d.screen_name) || str(d.username),
      avatar: str(d.avatar_url) || null,
      secUid: str(d.sec_user_id),
    }
  }
  // 2. The data the page was rendered with.
  const user = (await page
    .evaluate(() => {
      const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')
      if (!el?.textContent) return null
      const j = JSON.parse(el.textContent)
      return j?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user ?? null
    })
    .catch(() => null)) as Record<string, unknown> | null
  if (user && str(user.uid) && str(user.uniqueId)) {
    return {
      id: str(user.uid),
      handle: str(user.uniqueId),
      name: str(user.nickName) || str(user.uniqueId),
      avatar: firstUrl(user.avatarUri),
      secUid: str(user.secUid),
    }
  }
  return null
}

async function ensureSignedIn(page: Page) {
  if (/\/login/.test(page.url()))
    throw new NeedsLogin('TikTok asks to sign in again. Reconnect and scan the QR code with the TikTok app.')
}

/**
 * A photo post's pictures with the cover first: TikTok Studio makes the first picture the cover (its form marks it
 * and has no other cover choice). The others keep their order.
 */
export function coverFirst<T>(pictures: T[], coverIndex: number | null | undefined): T[] {
  if (!coverIndex || coverIndex < 0 || coverIndex >= pictures.length) return pictures
  return [pictures[coverIndex]!, ...pictures.filter((_, i) => i !== coverIndex)]
}

/** The most pictures TikTok Studio takes in one photo post. */
const PHOTO_MAX = 35

/** Studio's Photos tab on the upload page (its own file input takes pictures, several at once). */
async function openPhotosTab(page: Page) {
  const tab = await firstVisible(
    [
      page.getByRole('tab', { name: L.photos }),
      page.getByRole('button', { name: L.photos }),
      page.getByText(L.photos),
    ],
    15_000,
  )
  if (!tab) throw new Error('TikTok Studio’s Photos tab was not found')
  await tab.click()
  await page
    .locator('input[type=file][accept*="image"]')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 })
}

/** A photo post's title (Studio's "Add a catchy title", up to 90 characters), from the post's title. */
async function fillTitle(page: Page, run: DriverRun, req: PublishRequest) {
  const title = req.title.trim().slice(0, 90)
  if (!title) return
  const box = await firstVisible([page.getByPlaceholder(L.photoTitle)], 5000)
  if (!box) {
    run.warn('The title box was not found: the photo post went up without its title')
    return
  }
  await box.fill(title)
  run.step('Title written')
}

/**
 * A photo post's sound, as its form's "Add sound" picks one: the Sounds dialog is searched by the sound's title and
 * artist, and the row at the chosen sound's place in the search's own answer is used, once it shows the sound's
 * title. A photo post's sound plays at its own volume and from its beginning (the form offers neither).
 */
async function choosePhotoSound(page: Page, run: DriverRun, req: PublishRequest) {
  const m = req.music!
  try {
    await clickOne(
      [page.getByRole('button', { name: L.addSound }), page.getByText(L.addSound)],
      'Add sound',
      10_000,
    )
    const box = await firstVisible(
      [page.getByPlaceholder(L.searchSounds), page.getByRole('searchbox')],
      15_000,
    )
    if (!box) throw new Error('no sound search box')
    const find = async (q: string) => {
      const answer = page.waitForResponse((r) => /\/api\/search\/music\/full\//.test(r.url()), {
        timeout: 20_000,
      })
      await box.fill(q)
      await box.press('Enter')
      const json = (await (await answer).json().catch(() => null)) as {
        data?: { music_info?: { id_str?: string } }[]
      } | null
      return (json?.data ?? []).findIndex((d) => d.music_info?.id_str === m.trackId)
    }
    let at = await find(`${m.title} ${m.artist}`.trim())
    if (at < 0 && m.artist) at = await find(m.title)
    if (at < 0) throw new Error('TikTok’s search no longer finds this sound: choose it again')
    await sleep(1500)
    const use = page.getByRole('dialog').getByRole('button', { name: L.use }).nth(at)
    await use.scrollIntoViewIfNeeded()
    // the row must be the sound's: its title is shown next to its "Use"
    const shown = await use.evaluate((b) => {
      let e: HTMLElement | null = b as HTMLElement
      for (let i = 0; i < 4 && e; i++) e = e.parentElement
      return e?.textContent ?? ''
    })
    if (!shown.toLowerCase().includes(m.title.toLowerCase()))
      throw new Error(`the row found shows “${shown.replace(/\s+/g, ' ').slice(0, 60)}”, not the sound`)
    await use.click()
    await sleep(2500)
    if ((m.startAt ?? 0) >= 0.5)
      run.warn('TikTok Studio starts a photo post’s sound at its beginning: the start chosen was not applied')
    if (req.audio.music < 0.999)
      run.warn('TikTok Studio sets no volume for a photo post’s sound: it plays at its own')
    run.step(`Sound: ${m.title}${m.artist ? ` — ${m.artist}` : ''}`)
  } catch (err) {
    run.warn(`Sound not added: ${(err as Error).message}`)
    if (!req.dryRun)
      throw new Error(`Could not add the sound “${m.title}” in TikTok Studio: ${(err as Error).message}`)
  }
}

async function openUpload(run: DriverRun) {
  const page = await run.page()
  await page.goto(UPLOAD, { waitUntil: 'domcontentloaded' })
  // TikTok sends signed-out visitors to /login from the page itself, a moment after it loads.
  await until(
    async () => {
      await ensureSignedIn(page)
      return (await page.locator('input[type=file]').count()) > 0
    },
    'TikTok Studio’s upload page',
    45_000,
    500,
  )
  return page
}

async function waitUploaded(page: Page, run: DriverRun, timeout = 20 * 60_000) {
  // The caption editor appears as soon as the file is accepted; the upload finishes in the background.
  await page.locator('[contenteditable="true"]').first().waitFor({ state: 'visible', timeout: 120_000 })
  run.step('TikTok accepted the file')
  await until(
    async () => {
      if (
        await page
          .getByText(L.uploaded)
          .first()
          .isVisible()
          .catch(() => false)
      )
        return true
      const pct = await page
        .getByText(/\b\d{1,3}\s?%/)
        .first()
        .textContent({ timeout: 500 })
        .catch(() => null)
      return pct === null
    },
    'the upload to TikTok',
    timeout,
    2000,
  )
  run.step('Upload finished')
}

async function fillDetails(page: Page, run: DriverRun, req: PublishRequest) {
  const editor = page.locator('[contenteditable="true"]').first()
  await typeCaption(page, editor, req.caption)
  run.step('Caption written')

  if (req.placement === 'photo') {
    // a photo post's cover is its first picture: the chosen one was put first (coverFirst)
    if (req.coverIndex) run.step('Cover: the chosen picture, put first')
    else if (req.thumbnailPath && req.coverIndex == null)
      run.warn('A TikTok photo post’s cover is one of its pictures: the cover chosen is not one of them')
  } else if (req.thumbnailPath) {
    try {
      await clickOne(
        [page.getByRole('button', { name: L.editCover }), page.getByText(L.editCover)],
        'Edit cover',
        6000,
      )
      const tab = await firstVisible(
        [page.getByRole('tab', { name: L.uploadCover }), page.getByText(L.uploadCover)],
        6000,
      )
      if (tab) await tab.click()
      await page.locator('input[type=file][accept*="image"]').last().setInputFiles(req.thumbnailPath)
      await sleep(1500)
      await clickOne(
        [
          page.getByRole('dialog').getByRole('button', { name: L.confirm }),
          page.getByRole('button', { name: L.confirm }),
        ],
        'Confirm cover',
      )
      run.step('Cover uploaded')
    } catch (err) {
      run.warn(`Cover not set: ${(err as Error).message}`)
    }
  }

  if (req.location?.name) {
    try {
      const box = await firstVisible(
        [
          page.getByRole('combobox', { name: L.location }),
          page.getByPlaceholder(L.location),
          page.getByLabel(L.location),
        ],
        4000,
      )
      if (!box) throw new Error('no location field')
      await box.click()
      await box.fill(req.location.name)
      await sleep(1500)
      await clickOne(
        [page.getByRole('option').first(), page.locator('[role=listbox] [role=option]').first()],
        'a location suggestion',
        5000,
      )
      run.step(`Location: ${req.location.name}`)
    } catch (err) {
      run.warn(`Location not set: ${(err as Error).message}`)
    }
  }

  // Privacy and interaction switches live under "Show more" in Studio.
  const more = await firstVisible(
    [page.getByRole('button', { name: L.showMore }), page.getByText(L.showMore)],
    2500,
  )
  if (more) await more.click().catch(() => {})

  const privacy = String(req.options.privacy ?? 'public')
  try {
    const select = await firstVisible(
      [
        page.getByRole('combobox', { name: L.whoCanWatch }),
        page.getByText(L.whoCanWatch).locator('xpath=following::*[@role="combobox" or self::button][1]'),
      ],
      5000,
    )
    if (select) {
      await select.click()
      const want =
        privacy === 'private' || privacy === 'self'
          ? L.onlyYou
          : privacy === 'friends'
            ? L.friends
            : L.everyone
      await clickOne(
        [page.getByRole('option', { name: want }), page.getByText(want).last()],
        'the privacy option',
        5000,
      )
      await sleep(500)
      // The menu shows what is chosen: a post asked to be private never goes out as anything else.
      // biome-ignore lint/performance/useDomNodeTextContent: the shown choice only; textContent also reads the hidden options
      const shown = ((await select.innerText().catch(() => '')) || '').trim()
      if (privacy !== 'public' && !want.test(shown))
        throw new Error(`TikTok shows “${shown}” as who can see the post, not the choice`)
      run.step(`Who can see it: ${shown || privacy}`)
    } else if (privacy !== 'public') throw new Error('TikTok Studio’s privacy menu was not found')
    else run.warn('Privacy menu not found; TikTok’s default applies')
  } catch (err) {
    run.warn(`Privacy not set: ${(err as Error).message}`)
    // Never posted with TikTok's default (Everyone) when it was asked to be private or for friends.
    if (privacy !== 'public' && !req.dryRun)
      throw new Error(`TikTok’s privacy could not be set to “${privacy}”: ${(err as Error).message}`)
  }

  // a photo post has no duet or stitch
  for (const [key, name] of (
    [
      ['allowComments', L.comment],
      ['allowDuet', L.duet],
      ['allowStitch', L.stitch],
    ] as const
  ).filter(([key]) => req.placement !== 'photo' || key === 'allowComments')) {
    const want = req.options[key] ?? (key === 'allowComments' ? req.options.allowComment : undefined)
    if (typeof want !== 'boolean') continue
    await setCheck(page, name, want).then(
      (ok) => (ok ? run.step(`${key}: ${want}`) : run.warn(`${key} switch not found`)),
      (err) => run.warn(`${key}: ${(err as Error).message}`),
    )
  }

  const brandOrganic = req.options.brandOrganic === true
  const branded = req.options.brandedContent === true
  if (brandOrganic || branded) {
    try {
      await setSwitch(page, L.disclose, true)
      if (brandOrganic) await setCheck(page, L.yourBrand, true)
      if (branded) await setCheck(page, L.branded, true)
      run.step('Content disclosure set')
    } catch (err) {
      run.warn(`Content disclosure not set: ${(err as Error).message}`)
    }
  }
  if (typeof req.options.aiGenerated === 'boolean') {
    await setSwitch(page, L.aiGenerated, req.options.aiGenerated).then(
      (ok) =>
        ok
          ? run.step(`AI-generated label: ${req.options.aiGenerated}`)
          : run.warn('AI-generated switch not found'),
      (err) => run.warn(`AI-generated label: ${(err as Error).message}`),
    )
  }
}

/** Types the caption; hashtags and mentions are picked from TikTok's suggestions so they become real links. */
async function typeCaption(page: Page, editor: ReturnType<Page['locator']>, caption: string) {
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  const parts = caption.split(/((?:^|\s)[#@][\p{L}\p{N}_.]+)/u)
  for (const part of parts) {
    if (!part) continue
    const m = part.match(/^(\s*)([#@][\p{L}\p{N}_.]+)$/u)
    if (!m) {
      const lines = part.split('\n')
      for (const [i, line] of lines.entries()) {
        if (line) await page.keyboard.insertText(line)
        if (i < lines.length - 1) await page.keyboard.press('Shift+Enter')
      }
      continue
    }
    if (m[1]) await page.keyboard.insertText(m[1].replace(/\n/g, ' '))
    await page.keyboard.type(m[2]!, { delay: 40 })
    const tag = m[2]!.slice(1).toLowerCase()
    const option = page
      .locator('[class*="mention"], [class*="hashtag"], [role=option]')
      .filter({ hasText: new RegExp(`^\\s*[#@]?${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') })
      .first()
    if (await option.isVisible({ timeout: 2500 }).catch(() => false))
      await option.click().catch(() => page.keyboard.insertText(' '))
    else await page.keyboard.insertText(' ')
  }
}

async function setCheck(page: Page, name: RegExp, on: boolean) {
  const box = await firstVisible([page.getByRole('checkbox', { name }), page.getByLabel(name)], 3000)
  if (!box) return false
  if ((await box.isChecked().catch(() => !on)) !== on) await box.click()
  return true
}

async function setSwitch(page: Page, name: RegExp, on: boolean) {
  const sw = await firstVisible(
    [
      page.getByRole('switch', { name }),
      page.getByText(name).locator('xpath=following::*[@role="switch"][1]'),
    ],
    3000,
  )
  if (!sw) return false
  const state = (await sw.getAttribute('aria-checked')) === 'true'
  if (state !== on) await sw.click()
  return true
}

/**
 * TikTok Studio's onboarding tours ("New editing features added" and the like): an overlay over the page that
 * takes every click until its card is closed.
 */
export async function dismissTours(page: Page) {
  for (let i = 0; i < 3; i++) {
    const overlay = page
      .locator('#react-joyride-portal .react-joyride__overlay, .react-joyride__tooltip')
      .first()
    if (!(await overlay.isVisible().catch(() => false))) return
    const close = await firstVisible(
      [
        page.locator('.react-joyride__tooltip').getByRole('button', {
          name: label(['Got it', 'Ho capito', 'OK', 'Skip', 'Salta', 'Done', 'Fine'], true),
        }),
        page.locator('.react-joyride__tooltip button').last(),
      ],
      1500,
    )
    if (close) await close.click().catch(() => {})
    else await page.keyboard.press('Escape').catch(() => {})
    await sleep(600)
  }
}

/** The video editor's Sounds panel: the upload page's own Sounds button, else Edit video → Sounds (older pages). */
async function openSounds(page: Page) {
  const direct = await firstVisible([page.getByRole('button', { name: 'Sounds', exact: true })], 8000)
  if (direct) await direct.click()
  else {
    await clickOne(
      [page.getByRole('button', { name: L.editVideo }), page.getByText(L.editVideo)],
      'Edit video',
      10_000,
    )
    await clickOne(
      [page.getByRole('tab', { name: L.sounds }), page.getByRole('button', { name: L.sounds })],
      'Sounds',
      15_000,
    )
  }
  // "New editing features added" shows once.
  const gotIt = await firstVisible(
    [page.getByRole('button', { name: label(['Got it', 'Ho capito', 'OK'], true) })],
    1500,
  )
  if (gotIt) await gotIt.click().catch(() => {})
}

/** A 0..1 volume as the editor's dB box takes it (it goes from -60 to +20 dB; 1 is 0 dB). */
export function volumeDb(v: number) {
  if (v <= 0.001) return -60
  return Math.max(-60, Math.min(20, Math.round(20 * Math.log10(v))))
}

/** Writes a value into the selected track's Volume box (dB) of the editor's Audio panel. */
async function setTrackDb(page: Page, db: number) {
  const box = page.locator('.PropSettingInput__input').first()
  await box.waitFor({ state: 'visible', timeout: 8000 })
  await box.click({ clickCount: 3 })
  await box.fill(String(db))
  await box.press('Enter')
  await sleep(500)
}

/**
 * The sound, as TikTok Studio's video editor adds it: its Sounds panel is searched by the sound's title and artist,
 * the result whose id is the sound's (read from the search's own answer) is added with its "+", then each track's
 * volume is set in the Audio panel (dB), the video's own track muted outright at 0. TikTok renders the edit itself
 * (nothing is mixed into the file). The editor starts the sound at its beginning: another start is not offered here.
 */
export async function chooseSound(page: Page, run: DriverRun, req: PublishRequest) {
  const m = req.music!
  try {
    await openSounds(page)
    const box = await firstVisible(
      [page.getByPlaceholder(label(['Search sounds', 'Cerca suoni'])), page.getByRole('searchbox')],
      15_000,
    )
    if (!box) throw new Error('no sound search box')
    // The results' order is the search answer's: the sound's place in it is the row to add.
    const find = async (q: string) => {
      const answer = page.waitForResponse((r) => /\/api\/search\/music\/full\//.test(r.url()), {
        timeout: 20_000,
      })
      await box.fill(q)
      await box.press('Enter')
      const json = (await (await answer).json().catch(() => null)) as {
        data?: { music_info?: { id_str?: string } }[]
      } | null
      return (json?.data ?? []).findIndex((d) => d.music_info?.id_str === m.trackId)
    }
    let at = await find(`${m.title} ${m.artist}`.trim())
    if (at < 0 && m.artist) at = await find(m.title)
    if (at < 0) throw new Error('TikTok’s search no longer finds this sound: choose it again')
    const row = page.locator('.MusicPanelMusicItem__content').nth(at)
    await row.scrollIntoViewIfNeeded()
    await row.hover()
    await row.locator('button').last().click()
    await sleep(2500)
    const lanes = page.locator('.Track__root')
    if ((await lanes.count()) < 2) throw new Error('the sound did not reach the timeline')
    // The sound's track is selected once added: its volume.
    await setTrackDb(page, volumeDb(req.audio.music))
    // The video's own track: muted outright at 0, else its volume.
    if (req.audio.original <= 0.001) {
      await page.locator('.TrackOperation__item').first().locator('button').first().click()
    } else if (req.audio.original < 0.999) {
      await lanes.first().click()
      await sleep(800)
      await setTrackDb(page, volumeDb(req.audio.original))
    }
    if ((m.startAt ?? 0) >= 0.5)
      run.warn('TikTok Studio on the web starts a sound at its beginning: the start chosen was not applied')
    await clickOne([page.getByRole('button', { name: L.save })], 'Save in the video editor', 10_000)
    await sleep(2000)
    run.step(
      `Sound: ${m.title}${m.artist ? ` — ${m.artist}` : ''} (sound ${volumeDb(req.audio.music)} dB, video ${req.audio.original <= 0.001 ? 'muted' : `${volumeDb(req.audio.original)} dB`})`,
    )
  } catch (err) {
    run.warn(`Sound not added: ${(err as Error).message}`)
    if (!req.dryRun)
      throw new Error(`Could not add the sound “${m.title}” in TikTok Studio: ${(err as Error).message}`)
  }
}

async function setSchedule(page: Page, run: DriverRun, req: PublishRequest) {
  if (!req.scheduleAt) {
    const now = await firstVisible([page.getByRole('radio', { name: L.now })], 1500)
    if (now) await now.check().catch(() => {})
    return
  }
  // TikTok's picker works in 5-minute steps.
  const at = new Date(Math.ceil(req.scheduleAt.getTime() / 300_000) * 300_000)
  const z = zoned(at, req.timeZone)
  await clickOne(
    [page.getByRole('radio', { name: L.schedule }), page.getByText(L.schedule).first()],
    'the Schedule option',
  )
  // Permission prompt the first time ("Allow" scheduling).
  const allow = await firstVisible(
    [page.getByRole('button', { name: label(['Allow', 'Consenti'], true) })],
    2000,
  )
  if (allow) await allow.click()
  const time = await firstVisible(
    [
      page
        .locator('input')
        .filter({ hasNot: page.locator('[type=file]') })
        .and(page.locator('input[value*=":"]')),
    ],
    5000,
  )
  const date = await firstVisible(
    [page.locator('input[value*="-"], input[value*="/"]').filter({ hasNot: page.locator('[type=file]') })],
    5000,
  )
  if (!time || !date) throw new Error('TikTok’s schedule date/time fields were not found')
  // Time: pick the hour and minute from the two lists of the picker.
  await time.click()
  const hh = String(z.hour).padStart(2, '0')
  const mm = String(z.minute).padStart(2, '0')
  await clickOne(
    [
      page
        .locator('[class*="hour"], [class*="picker"] li, [role=option]')
        .getByText(new RegExp(`^${hh}$`))
        .first(),
    ],
    `${hh} in the hour list`,
    5000,
  )
  await clickOne(
    [
      page
        .locator('[class*="minute"], [class*="picker"] li, [role=option]')
        .getByText(new RegExp(`^${mm}$`))
        .last(),
    ],
    `${mm} in the minute list`,
    5000,
  )
  await page.keyboard.press('Escape').catch(() => {})
  // Date: open the calendar, move to the right month, click the day.
  await date.click()
  for (let i = 0; i < 3; i++) {
    const shown = (await date.inputValue().catch(() => '')) || ''
    if (
      shown.includes(z.iso) ||
      shown.includes(`${String(z.day).padStart(2, '0')}/${String(z.month).padStart(2, '0')}`)
    )
      break
    const day = page
      .locator('[class*="calendar"] [class*="day"]:not([class*="disabled"]), [role=gridcell]')
      .getByText(new RegExp(`^${z.day}$`))
      .first()
    if (await day.isVisible().catch(() => false)) {
      await day.click()
      break
    }
    await clickOne(
      [
        page.locator('[class*="arrow"]').last(),
        page.getByRole('button', { name: label(['Next month', 'Mese successivo']) }),
      ],
      'next month',
      3000,
    )
  }
  run.step(`Schedule: ${z.iso} ${hh}:${mm} (${req.timeZone})`)
}

async function leaveUpload(page: Page) {
  // Discard what was loaded so nothing stays behind.
  const discard = await firstVisible([page.getByRole('button', { name: L.discard })], 1500)
  if (discard) {
    await discard.click().catch(() => {})
    const confirm = await firstVisible(
      [page.getByRole('dialog').getByRole('button', { name: L.discard })],
      3000,
    )
    if (confirm) await confirm.click().catch(() => {})
  }
  await page.goto('about:blank').catch(() => {})
}

function assertWindow(at: Date) {
  const lead = at.getTime() - Date.now()
  if (lead < TIKTOK_SCHEDULE.minLeadMinutes * 60_000)
    throw new ConnectorUnsupported(
      'scheduleAt',
      `TikTok schedules at least ${TIKTOK_SCHEDULE.minLeadMinutes} minutes ahead`,
    )
  if (lead > TIKTOK_SCHEDULE.maxLeadDays * 86_400_000)
    throw new ConnectorUnsupported(
      'scheduleAt',
      `TikTok schedules at most ${TIKTOK_SCHEDULE.maxLeadDays} days ahead on the web`,
    )
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Posts inside TikTok Studio's own answers. */
export function parseItems(json: unknown[], handle: string): RemotePost[] {
  const out = new Map<string, RemotePost>()
  const items = findObjects(
    json,
    (o) =>
      !!str(o.item_id ?? o.aweme_id ?? o.itemId ?? (o.desc !== undefined && o.id)) &&
      (o.desc !== undefined || o.description !== undefined || o.title !== undefined),
  )
  for (const o of items) {
    const id = str(o.item_id ?? o.aweme_id ?? o.itemId ?? o.id)
    if (!/^\d{8,}$/.test(id) || out.has(id)) continue
    const stats = (o.statistics ?? o.stats ?? o.item_stats ?? {}) as Record<string, unknown>
    const created = num(o.create_time ?? o.createTime ?? o.post_time)
    const scheduled = num(o.schedule_time ?? o.scheduleTime ?? o.scheduled_time)
    const isScheduled = !!scheduled && scheduled * 1000 > Date.now()
    const statusText = str(o.status ?? o.item_status ?? '')
    const views = num(stats.play_count ?? stats.playCount ?? stats.view_count ?? o.play_count)
    const statOut: Record<string, number> = {}
    for (const [k, v] of Object.entries({
      views,
      likes: num(stats.digg_count ?? stats.diggCount ?? stats.like_count),
      comments: num(stats.comment_count ?? stats.commentCount),
      shares: num(stats.share_count ?? stats.shareCount),
      saves: num(stats.collect_count ?? stats.collectCount),
    }))
      if (v !== null) statOut[k] = v
    out.set(id, {
      remoteId: id,
      url: `https://www.tiktok.com/@${handle}/video/${id}`,
      placement: 'video',
      title: '',
      caption: str(o.desc ?? o.description ?? o.title),
      thumbnailUrl: firstUrl(
        o.cover ??
          o.cover_url ??
          o.video_cover ??
          (o.video as Record<string, unknown> | undefined)?.cover ??
          o.origin_cover,
      ),
      mediaUrl: null,
      state: /delet|remov/i.test(statusText) ? 'removed' : isScheduled ? 'scheduled' : 'published',
      scheduledAt: scheduled ? new Date(scheduled * 1000).toISOString() : null,
      publishedAt: !isScheduled && created ? new Date(created * 1000).toISOString() : null,
      stats: Object.keys(statOut).length ? statOut : null,
    })
  }
  return [...out.values()]
}
