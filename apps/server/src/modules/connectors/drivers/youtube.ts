import type { Placement } from '@greenlit/shared/areas/posts'
import type { Locator, Page } from 'playwright-core'
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
  decodeHtml,
  findObjects,
  firstUrl,
  firstVisible,
  label,
  num,
  pageMeta,
  reachable,
  setText,
  sleep,
  sniffJson,
  str,
  until,
  zoned,
} from './util.ts'

/**
 * YouTube through YouTube Studio (studio.youtube.com) with the normal Google account. Studio's own elements carry
 * stable ids (#title-textarea, #next-button, tp-yt-paper-radio-button[name=PUBLIC]…), used here instead of text
 * wherever they exist. Scheduling is native: YouTube publishes at the time even when Greenlit is off.
 * Studio on the web has no Shorts sound library (sounds are added in the YouTube app), so `music` is off.
 */

const STUDIO = 'https://studio.youtube.com'

const L = {
  uploadVideos: label(['Upload videos', 'Carica video']),
  tags: label(['Tags', 'Tag']),
  showMore: label(['Show more', 'Mostra altro', 'Altro']),
  next: label(['Next', 'Avanti'], true),
  save: label(['Save', 'Salva'], true),
  schedule: label(['Schedule', 'Programma', 'Pianifica']),
  done: label(['Publish', 'Pubblica', 'Schedule', 'Programma', 'Save', 'Salva', 'Done', 'Fine'], true),
  close: label(['Close', 'Chiudi'], true),
  deleteForever: label(['Delete forever', 'Elimina definitivamente']),
  understand: label([
    'I understand that deleting is permanent',
    'Sono consapevole che l’eliminazione è definitiva',
    "Sono consapevole che l'eliminazione è definitiva",
    'deleting is permanent',
    'eliminazione è definitiva',
  ]),
  addLanguage: label(['Add language', 'Aggiungi lingua']),
  publish: label(['Publish', 'Pubblica'], true),
  add: label(['Add', 'Aggiungi'], true),
}

const capabilities = {
  ...noCapabilities,
  placements: ['video', 'short'] as Placement[],
  nativeSchedule: true,
  editAfterPublish: true,
  delete: true,
  music: false,
  audioMix: false,
  translations: true,
  thumbnail: true,
  location: false,
  firstComment: false,
  sync: true,
  stats: true,
}

export const youtube: Driver = {
  id: 'youtube-studio',
  name: 'YouTube Studio',
  platforms: ['youtube'],
  signIn: {
    url: `https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=${encodeURIComponent(`${STUDIO}/`)}`,
    method: 'password',
    cookieDomains: ['youtube.com', 'google.com'],
  },
  capabilities: () => capabilities,

  async looksSignedIn(context) {
    const sapisid =
      (await cookie(context, 'https://www.youtube.com', 'SAPISID')) ??
      (await cookie(context, 'https://www.youtube.com', '__Secure-3PAPISID'))
    const login =
      (await cookie(context, 'https://www.youtube.com', 'LOGIN_INFO')) ??
      (await cookie(context, 'https://www.youtube.com', 'SID'))
    return !!sapisid && !!login
  },

  async discover(run) {
    const page = await run.page()
    const channelId = await openStudio(page)
    if (!channelId) return []
    const info = await channelInfo(run, channelId)
    return [
      {
        platform: 'youtube',
        externalId: channelId,
        name: info.name || 'YouTube channel',
        handle: info.handle,
        avatarUrl: info.avatar,
        profileUrl: info.handle
          ? `https://www.youtube.com/${info.handle}`
          : `https://www.youtube.com/channel/${channelId}`,
        platformIds: { channelId },
        capabilities,
      },
    ]
  },

  async check(run, account) {
    if (!(await this.looksSignedIn(run.context)))
      return { ok: false, reason: 'Google signed Greenlit out of YouTube. Reconnect to sign in again.' }
    const page = await run.page()
    try {
      const id = await openStudio(page)
      if (!id) return { ok: false, reason: 'This Google account has no YouTube channel any more.' }
      if (id !== account.externalId)
        return {
          ok: false,
          reason:
            'YouTube Studio opens another channel with this login. Reconnect and pick the right channel.',
        }
      return { ok: true }
    } catch (err) {
      if (err instanceof NeedsLogin) return { ok: false, reason: err.message }
      throw err
    }
  },

  async publish(run, account, req) {
    const video = req.files.find((f) => f.kind === 'video')
    if (!video)
      throw new ConnectorUnsupported(
        'placement',
        'YouTube Studio uploads videos; community posts are not supported yet',
      )
    const page = await run.page()
    const channelId = account.platformIds.channelId || account.externalId
    run.step('Opening the YouTube Studio upload dialog')
    await page.goto(`${STUDIO}/channel/${channelId}/videos/upload?d=ud`, { waitUntil: 'domcontentloaded' })
    await assertStudio(page)
    // The upload address opens Studio's upload dialog by itself, a moment after the page: wait for its file field
    // before anything else (clicking Create behind the open dialog never lands).
    const input = page
      .locator('ytcp-uploads-file-picker input[type=file], input[type=file][name=Filedata]')
      .first()
    const ready = await input
      .waitFor({ state: 'attached', timeout: 25_000 })
      .then(() => true)
      .catch(() => false)
    if (ready) await input.setInputFiles(video.path)
    else {
      const picker = page
        .getByRole('button', { name: label(['Select files', 'Seleziona file'], true) })
        .first()
      if (!(await picker.isVisible().catch(() => false))) {
        await clickOne(
          [page.locator('#create-icon'), page.getByRole('button', { name: label(['Create', 'Crea'], true) })],
          'Create',
        )
        await clickOne(
          [page.locator('#text-item-0'), page.getByRole('menuitem', { name: L.uploadVideos })],
          'Upload videos',
        )
      }
      const chooser = page.waitForEvent('filechooser', { timeout: 30_000 })
      await picker.click({ timeout: 30_000 })
      await (await chooser).setFiles(video.path)
    }
    run.step('Video sent to YouTube')

    const title = page.locator('#title-textarea #textbox').first()
    await title.waitFor({ state: 'visible', timeout: 120_000 })
    const videoId = await until(() => readVideoId(page), 'YouTube to give the video an id', 120_000, 1000)
    run.step(`YouTube video id ${videoId}`)
    try {
      await fillDetails(page, run, req)
      await goToVisibility(page, run)
      await setVisibility(page, run, req)
      await waitForUpload(page, run)
      // Publish, or Schedule ("Programma") once a time is set: the same button of the upload dialog. The
      // dialog's own element has no box (its paper dialog inside is fixed), so the button is what is looked for.
      const dialog = page.locator('ytcp-uploads-dialog')
      const done = await firstVisible(
        [dialog.locator('#done-button'), dialog.getByRole('button', { name: L.done })],
        30_000,
      )
      if (!done)
        throw new Error('The upload dialog shows no Publish button (YouTube Studio may have closed it)')
      await until(
        async () => (await done.getAttribute('aria-disabled')) !== 'true' && (await done.isEnabled()),
        'the Publish button',
        60_000,
        1000,
      )
      if (req.dryRun) {
        const shot = await run.snapshot(page, 'before-publish')
        const pressed = (await done.textContent().catch(() => ''))?.trim() || 'Publish'
        // The upload created a private draft: take it away again.
        await closeDialog(page)
        await deleteVideo(run, channelId, videoId).catch((err) =>
          run.warn(
            `The private draft ${videoId} could not be deleted (${(err as Error).message}); delete it in YouTube Studio.`,
          ),
        )
        return {
          remoteId: 'dry-run',
          url: null,
          state: req.scheduleAt ? 'scheduled' : 'published',
          dryRun: { steps: [], warnings: [], screenshot: shot, wouldPress: pressed },
        } satisfies PublishOutcome
      }
      run.step(`Pressing ${(await done.textContent())?.trim()}`)
      await done.click()
      // YouTube confirms with its "published / scheduled" dialog, or a "still processing" one. Their own
      // elements have no box (as the upload dialog's has none), so their buttons are looked for; the upload
      // dialog is never closed here: closing it before YouTube has saved leaves the video a private draft
      // (all nine Shorts of 25 Nov 2026).
      const confirmation = page.locator(
        'ytcp-video-share-dialog #close-button, ytcp-uploads-still-processing-dialog #close-button',
      )
      const confirmed = await confirmAfterLastButton(page, run, confirmation)
      if (confirmed) {
        run.step(req.scheduleAt ? 'YouTube confirmed the schedule' : 'YouTube confirmed the publish')
        await sleep(1500)
        await confirmed.click().catch(() => {})
        await sleep(700)
      }
      // The video's state is read back from YouTube afterwards (youtube-api), which says whether it went out.
      else {
        await run.snapshot(page, 'no-confirmation')
        run.warn('YouTube Studio showed no confirmation after the last button')
      }
    } catch (err) {
      if (req.dryRun) await deleteVideo(run, channelId, videoId).catch(() => {})
      throw err
    }
    if (Object.keys(req.translations).length)
      await setTranslations(run, videoId, req).catch((err) =>
        run.warn(`Translations not added: ${(err as Error).message}`),
      )
    const short = req.placement === 'short'
    return {
      remoteId: videoId,
      url: short ? `https://www.youtube.com/shorts/${videoId}` : `https://youtu.be/${videoId}`,
      state: req.scheduleAt ? 'scheduled' : 'published',
    }
  },

  async update(run, account, remoteId, patch) {
    const page = await run.page()
    run.step('Opening the video details in YouTube Studio')
    await page.goto(`${STUDIO}/video/${remoteId}/edit`, { waitUntil: 'domcontentloaded' })
    await assertStudio(page)
    await page.locator('#title-textarea #textbox').first().waitFor({ state: 'visible', timeout: 60_000 })
    if (patch.title !== undefined)
      await setText(page, page.locator('#title-textarea #textbox').first(), patch.title.slice(0, 100))
    if (patch.caption !== undefined)
      await setText(
        page,
        page.locator('#description-textarea #textbox').first(),
        patch.caption.slice(0, 5000),
      )
    if (patch.thumbnailPath) await setThumbnail(page, run, patch.thumbnailPath)
    if (patch.tags?.length) {
      // Tags sit under "Show more" on the video's page too.
      const more = await firstVisible(
        [page.locator('#toggle-button'), page.getByRole('button', { name: L.showMore })],
        3000,
      )
      if (
        more &&
        !(await page
          .locator('#tags-container')
          .first()
          .isVisible()
          .catch(() => false))
      )
        await more.click().catch(() => {})
      await setTags(page, run, patch.tags)
    }
    // Visibility only changes for a new schedule or an explicit privacy choice (never flips a private video public).
    if (
      (patch.scheduleAt instanceof Date && patch.scheduleAt.getTime() > Date.now()) ||
      patch.options?.privacy !== undefined
    ) {
      await clickOne(
        [
          page
            .locator('ytcp-video-metadata-visibility #select-button, ytcp-video-metadata-visibility')
            .first(),
        ],
        'the visibility menu',
      )
      const schedule = await setVisibility(page, run, {
        ...patch,
        scheduleAt: patch.scheduleAt ?? null,
        options: patch.options ?? {},
        timeZone: patch.timeZone ?? run.timeZone,
      } as PublishRequest)
      const done = await firstVisible(
        [
          page.locator('ytcp-video-visibility-select #save-button, #save-button').first(),
          page.getByRole('button', { name: L.save }),
        ],
        8000,
      )
      if (!done) throw new Error('Could not find Done in the visibility menu')
      if (schedule?.unchanged) {
        // Done stays off while nothing changed: the menu is closed as it came (on a video's page Escape closes
        // only the menu; there is no upload dialog under it).
        await page.keyboard.press('Escape')
        await sleep(600)
        if (await done.isVisible().catch(() => false))
          run.warn('The visibility menu stayed open after Escape')
      } else {
        // As a person would, the date and time are read before pressing Done: Studio may have taken them its own
        // way, and saving then would move the video to a time nobody asked for.
        if (schedule && !schedule.matches)
          throw Object.assign(
            new Error(
              `YouTube Studio shows ${schedule.shown} for the schedule after ${schedule.wanted} was typed: nothing was saved`,
            ),
            { retriable: false },
          )
        await closeLists(page, done)
        await done.click()
      }
    }
    const save = page.locator('ytcp-button#save, #save').first()
    if (await save.isVisible().catch(() => false)) {
      const enabled = await until(
        async () => (await save.getAttribute('aria-disabled')) !== 'true',
        'Save to be enabled',
        15_000,
        500,
      ).then(
        () => true,
        () => false,
      )
      // Save stays off when Studio already had everything (clicking it would only wait for nothing).
      if (!enabled) run.warn('YouTube Studio had nothing to save')
      else {
        await save.click()
        await sleep(2500)
        run.step('Saved in YouTube Studio')
      }
    }
    // Saved already: translations Studio does not take are a warning, as when publishing (26 Nov 2026: a video
    // with no language of its own showed no "Add language", and the whole update counted as failed and was retried).
    if (patch.translations && Object.keys(patch.translations).length)
      await setTranslations(run, remoteId, patch as PublishRequest).catch((err) =>
        run.warn(`Translations not added: ${(err as Error).message}`),
      )
    run.step(`Updated ${remoteId} on ${account.name}`)
  },

  async remove(run, account, remoteId) {
    if (remoteId === 'dry-run') return
    await deleteVideo(run, account.platformIds.channelId || account.externalId, remoteId)
  },

  async list(run, account) {
    const page = await run.page()
    const channelId = account.platformIds.channelId || account.externalId
    const posts = new Map<string, RemotePost>()
    // The two content tabs (Videos, Shorts) each load their own list.
    for (const tab of ['upload', 'short'] as const) {
      const { bodies } = await sniffJson(
        page,
        (u) => /youtubei\/v1\/creator\/(list_creator_videos|get_creator_videos)/.test(u),
        async () => {
          await page.goto(`${STUDIO}/channel/${channelId}/videos/${tab}`, { waitUntil: 'domcontentloaded' })
          await assertStudio(page)
          await sleep(4000)
        },
        1500,
      )
      for (const p of parseStudioVideos(
        bodies.map((b) => b.json),
        tab === 'short' ? 'short' : 'video',
      ))
        if (!posts.has(p.remoteId)) posts.set(p.remoteId, p)
    }
    if (!posts.size)
      run.warn('YouTube Studio returned no videos (empty channel, or the content page changed).')
    return [...posts.values()]
  },

  async searchMusic() {
    return []
  },
}

// ── Studio pieces ───────────────────────────────────────────────────────

/** Opens Studio and returns the channel id it lands on (null: the Google account has no channel). */
async function openStudio(page: Page): Promise<string | null> {
  await page.goto(`${STUDIO}/`, { waitUntil: 'domcontentloaded' })
  const url = await until(
    async () => {
      const u = page.url()
      if (/accounts\.google\.com/.test(u))
        throw new NeedsLogin('Google asks to sign in again. Reconnect YouTube.')
      if (/create_channel|\/channel_switcher/.test(u)) return u
      return /\/channel\/UC[\w-]{20,}/.test(u) ? u : null
    },
    'YouTube Studio to open',
    60_000,
    700,
  )
  const fromUrl = url.match(/\/channel\/(UC[\w-]{20,})/)?.[1]
  if (fromUrl) return fromUrl
  const fromCfg = await page
    .evaluate(() =>
      (window as unknown as { ytcfg?: { get: (k: string) => unknown } }).ytcfg?.get('CHANNEL_ID'),
    )
    .catch(() => null)
  return typeof fromCfg === 'string' && fromCfg ? fromCfg : null
}

async function assertStudio(page: Page) {
  await page.waitForLoadState('domcontentloaded')
  if (/accounts\.google\.com/.test(page.url()))
    throw new NeedsLogin('Google asks to sign in again. Reconnect YouTube.')
}

/** Name, @handle and picture from the public channel page. */
async function channelInfo(run: DriverRun, channelId: string) {
  const meta = await pageMeta(run.context, `https://www.youtube.com/channel/${channelId}?hl=en`)
  const html = meta.__html ?? ''
  const handle =
    html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/)?.[1] ??
    html.match(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/)?.[1] ??
    ''
  return {
    name: meta['og:title'] ?? '',
    handle: decodeHtml(decodeURIComponent(handle)),
    avatar: meta['og:image'] ?? null,
  }
}

async function readVideoId(page: Page): Promise<string | null> {
  const href = await page
    .locator(
      'ytcp-video-info a[href*="youtu"], .video-url-fadeable a, a[href*="youtu.be/"], a[href*="/shorts/"]',
    )
    .first()
    .getAttribute('href', { timeout: 1000 })
    .catch(() => null)
  return href?.match(/(?:youtu\.be\/|shorts\/|v=)([\w-]{11})/)?.[1] ?? null
}

async function fillDetails(page: Page, run: DriverRun, req: PublishRequest) {
  await setText(
    page,
    page.locator('#title-textarea #textbox').first(),
    (req.title || req.caption.split('\n')[0] || 'Untitled').slice(0, 100),
  )
  await setText(page, page.locator('#description-textarea #textbox').first(), req.caption.slice(0, 5000))
  run.step('Title and description written')
  if (req.thumbnailPath) await setThumbnail(page, run, req.thumbnailPath)
  const kids = req.options.madeForKids === true
  await clickOne(
    [
      page.locator(
        `tp-yt-paper-radio-button[name="${kids ? 'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK'}"]`,
      ),
    ],
    'the audience choice',
    20_000,
  )
  run.step(kids ? 'Audience: made for kids' : 'Audience: not made for kids')
  const altered = req.options.alteredContent ?? req.options.aiGenerated
  if (req.options.allowComments === false)
    run.warn('Turning comments off is not automated yet: switch them off in YouTube Studio → Comments.')
  const needsMore = req.tags.length || req.options.category || altered !== undefined
  if (needsMore) {
    const more = await firstVisible(
      [page.locator('#toggle-button'), page.getByRole('button', { name: L.showMore })],
      4000,
    )
    if (more) await more.click()
    if (req.tags.length) await setTags(page, run, req.tags)
    if (typeof altered === 'boolean') {
      const radio = page
        .locator(
          `tp-yt-paper-radio-button[name="${altered ? 'VIDEO_HAS_ALTERED_CONTENT_YES' : 'VIDEO_HAS_ALTERED_CONTENT_NO'}"]`,
        )
        .first()
      if (await radio.isVisible().catch(() => false)) {
        await radio.click()
        run.step(`Altered or synthetic content: ${altered ? 'yes' : 'no'}`)
      } else run.warn('The “altered content” question was not found')
    }
    if (typeof req.options.category === 'string' && req.options.category) {
      try {
        await clickOne([page.locator('ytcp-form-select#category, #category').first()], 'the category menu')
        await clickOne(
          [
            page.getByRole('option', { name: label([req.options.category]) }),
            page.locator('tp-yt-paper-item').filter({ hasText: req.options.category }),
          ],
          `category ${req.options.category}`,
          5000,
        )
        run.step(`Category: ${req.options.category}`)
      } catch (err) {
        run.warn(`Category not set: ${(err as Error).message}`)
      }
    }
  }
}

async function setThumbnail(page: Page, run: DriverRun, path: string) {
  const input = page
    .locator(
      'input#file-loader, ytcp-thumbnails-compact-editor-uploader input[type=file], input[type=file][accept*="image"]',
    )
    .first()
  if (!(await input.count()))
    return run.warn(
      'Thumbnail upload is not available for this video (Shorts take a frame, or the channel is not verified)',
    )
  await input.setInputFiles(path)
  await sleep(2500)
  run.step('Thumbnail uploaded')
}

async function setTags(page: Page, run: DriverRun, tags: string[]) {
  const box = await firstVisible(
    [
      page.locator('#tags-container input#text-input'),
      page.locator('ytcp-free-text-chip-bar input'),
      page.getByRole('textbox', { name: L.tags }),
    ],
    5000,
  )
  if (!box) return run.warn('The tags field was not found')
  // Remove the existing chips, then type the new tags separated by commas.
  for (let i = 0; i < 60; i++) {
    const chip = page
      .locator('#tags-container ytcp-chip #delete-icon, ytcp-free-text-chip-bar ytcp-chip #delete-icon')
      .first()
    if (!(await chip.isVisible().catch(() => false))) break
    await chip.click()
  }
  await box.click()
  await page.keyboard.insertText(`${tags.join(',')},`)
  run.step(`Tags: ${tags.join(', ')}`)
}

async function goToVisibility(page: Page, run: DriverRun) {
  for (let i = 0; i < 4; i++) {
    if (
      await page
        .locator('tp-yt-paper-radio-button[name="PUBLIC"], ytcp-uploads-review')
        .first()
        .isVisible()
        .catch(() => false)
    )
      break
    await clickOne([page.locator('#next-button'), page.getByRole('button', { name: L.next })], 'Next')
    await sleep(900)
  }
  run.step('On the visibility step')
}

/** What the schedule's fields showed: whether they already held the time asked for, and whether they do now. */
interface ShownSchedule {
  unchanged: boolean
  matches: boolean
  shown: string
  wanted: string
}

async function setVisibility(
  page: Page,
  run: DriverRun,
  req: Pick<PublishRequest, 'scheduleAt' | 'options' | 'timeZone'>,
): Promise<ShownSchedule | null> {
  if (!req.scheduleAt) {
    const privacy = String(req.options.privacy ?? 'public').toUpperCase()
    const name = privacy === 'PRIVATE' ? 'PRIVATE' : privacy === 'UNLISTED' ? 'UNLISTED' : 'PUBLIC'
    await clickOne(
      [page.locator(`tp-yt-paper-radio-button[name="${name}"]`)],
      `visibility ${name.toLowerCase()}`,
    )
    run.step(`Visibility: ${name.toLowerCase()}`)
    return null
  }
  const z = zoned(req.scheduleAt, req.timeZone)
  // The Schedule part opens with its own expand button (the upload dialog). On the page of a video that is
  // scheduled already it is open, with no such button: clicking the part itself then lands in its middle, on the
  // time field, whose list opens over a backdrop that takes every later click, the date field's included (26 Nov
  // 2026, a Short moved to another day). So the part is only opened when its date field cannot be clicked yet.
  const expandButton = page.locator('#second-container-expand-button')
  const dateField = page.locator('#datepicker-trigger')
  const shows = await firstVisible(
    [expandButton, dateField, page.locator('ytcp-visibility-scheduler'), page.getByText(L.schedule).first()],
    8000,
  )
  if (!shows) throw new Error('The Schedule option was not found')
  const button = await firstVisible([expandButton], 300)
  const open = !button && (await firstVisible([dateField], 300).then((d) => (d ? reachable(d) : false)))
  if (!open) {
    const expand = await firstVisible(
      [expandButton, page.locator('ytcp-visibility-scheduler'), page.getByText(L.schedule).first()],
      2000,
    )
    if (!expand) throw new Error('The Schedule option was not found')
    await expand.click()
  }
  // Date: Studio prints dates in the account's language; type the date the same way the field shows today's.
  const trigger = await firstVisible(
    [page.locator('#datepicker-trigger'), page.locator('ytcp-text-dropdown-trigger#datepicker-trigger')],
    8000,
  )
  if (!trigger) throw new Error('The schedule date field was not found')
  const timeField = page
    .locator('#time-of-day-container input, ytcp-form-input-container#time-of-day-container input')
    .first()
  const before = {
    date: (await trigger.textContent().catch(() => ''))?.trim() ?? '',
    time: (await firstVisible([timeField], 1000)) ? await timeField.inputValue().catch(() => '') : '',
  }
  // The time is written as the field writes it: "14:05", or "2:05 PM" when it uses AM/PM.
  const timeLike = (sample: string) =>
    /am|pm/i.test(sample)
      ? `${z.hour % 12 || 12}:${String(z.minute).padStart(2, '0')} ${z.hour < 12 ? 'AM' : 'PM'}`
      : z.hm
  const wanted = { date: formatLike(before.date, req.scheduleAt, req.timeZone), time: timeLike(before.time) }
  const same = (a: { date: string; time: string }) =>
    shownAs(a.date) === shownAs(wanted.date) && shownAs(a.time) === shownAs(wanted.time)
  const say = (a: { date: string; time: string }) => `${a.date} ${a.time}`.trim()
  if (same(before)) {
    run.step(`Schedule already ${say(before)} (${req.timeZone})`)
    return { unchanged: true, matches: true, shown: say(before), wanted: say(wanted) }
  }
  await closeLists(page, trigger)
  await trigger.click()
  const dateInput = await firstVisible(
    [page.locator('ytcp-date-picker tp-yt-paper-input input, ytcp-date-picker input').first()],
    8000,
  )
  if (!dateInput) throw new Error('The schedule date input was not found')
  // The date picker shows the same date in its own field: that one is the sample, as before.
  await dateInput.fill(formatLike(await dateInput.inputValue(), req.scheduleAt, req.timeZone))
  await dateInput.press('Enter')
  const timeInput = await firstVisible([timeField], 8000)
  if (!timeInput) throw new Error('The schedule time input was not found')
  if (!before.time) wanted.time = timeLike(await timeInput.inputValue().catch(() => ''))
  await closeLists(page, timeInput)
  await timeInput.fill(wanted.time)
  await timeInput.press('Enter')
  // Never Escape here: in the upload dialog it closes the dialog itself (Studio keeps a draft and goes back to the
  // dashboard, so there is no Schedule button left to press; seen 25 Nov 2026). A list still open is closed by
  // clicking beside it, as a person would.
  await closeLists(page)
  const after = {
    date: (await trigger.textContent().catch(() => ''))?.trim() ?? '',
    time: await timeInput.inputValue().catch(() => ''),
  }
  run.step(`Scheduled for ${z.iso} ${z.hm} (${req.timeZone}); Studio shows ${say(after)}`.trim())
  return { unchanged: false, matches: same(after), shown: say(after), wanted: say(wanted) }
}

/** A date or time as Studio shows it, for comparing: case, dots, commas and spaces aside ("12 dic 2026"). */
function shownAs(text: string) {
  return text
    .toLowerCase()
    .replace(/[.,\s\u00a0\u202f]+/g, ' ')
    .trim()
}

/**
 * After Publish / Schedule YouTube may first say it is still checking the video ("Stiamo ancora controllando i tuoi
 * contenuti" / "We're still checking your content", seen 25 Nov 2026): its OK is what lets the schedule be saved,
 * as a person would press it. Then its confirmation shows. Returns the confirmation's close button, or null.
 */
async function confirmAfterLastButton(page: Page, run: DriverRun, confirmation: ReturnType<Page['locator']>) {
  const checking = page
    .locator('tp-yt-paper-dialog, ytcp-dialog, [role=dialog]')
    .filter({ hasText: label(['ancora controllando', 'still checking']) })
    .getByRole('button', { name: label(['OK', 'Ok', 'Capito', 'Got it'], true) })
  const end = Date.now() + 90_000
  while (Date.now() < end) {
    const done = await firstVisible([confirmation], 1500)
    if (done) return done
    const ok = await firstVisible([checking], 500)
    if (ok) {
      await ok.click().catch(() => {})
      run.step('YouTube is still checking the video: OK')
      await sleep(1500)
    }
  }
  return null
}

/**
 * Closes a date picker or time list left open, without leaving the dialog or menu it is in. An open list sits over
 * a backdrop that covers the page and takes every click until the list closes, so `next` (what is clicked next)
 * counts as covered too when a click in its middle would not reach it (26 Nov 2026: the date field).
 */
async function closeLists(page: Page, next?: Locator) {
  const open = page.locator(
    'tp-yt-iron-dropdown:not([aria-hidden="true"]) tp-yt-paper-listbox, ytcp-date-picker #calendar-main',
  )
  for (let i = 0; i < 3; i++) {
    const listOpen = await open
      .first()
      .isVisible()
      .catch(() => false)
    if (!listOpen && (!next || (await reachable(next)))) return
    if (!(await clickAside(page))) return
    await sleep(400)
  }
}

/**
 * A click where there is nothing to press, as a person closes a list: the upload dialog's title, or (the visibility
 * menu on a video's page has no title) the margin just left of the schedule's date field. It lands on whatever is on
 * top there, an open list's backdrop included, which is what closes the list.
 */
async function clickAside(page: Page) {
  const title = await firstVisible(
    [page.locator('ytcp-uploads-dialog #dialog-title, ytcp-uploads-dialog h1').first()],
    1000,
  )
  if (title) {
    await title.click({ position: { x: 4, y: 4 }, force: true, timeout: 3000 }).catch(() => {})
    return true
  }
  const box = await page
    .locator('#datepicker-trigger')
    .first()
    .boundingBox({ timeout: 1000 })
    .catch(() => null)
  if (!box) return false
  await page.mouse.click(box.x - 8, box.y + box.height / 2)
  return true
}

/** Writes the date in the same pattern as `sample` (the date Studio shows), e.g. "Nov 21, 2026" or "21 nov 2026". */
function formatLike(sample: string, date: Date, timeZone: string): string {
  const z = zoned(date, timeZone)
  const lang = /[a-z]/i.test(sample)
    ? /(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\b/i.test(sample) &&
      !/(may|jun|jul|aug|sep|oct|dec)\b/i.test(sample)
      ? 'it'
      : 'en'
    : 'num'
  if (lang === 'num') {
    // 21/11/2026 or 11/21/2026: keep the order the sample uses (a first number > 12 means day first).
    const first = Number(sample.split(/\D+/)[0])
    const dayFirst = first > 12 || /^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(sample)
    const d = String(z.day).padStart(2, '0')
    const m = String(z.month).padStart(2, '0')
    const sep = sample.match(/\D/)?.[0] ?? '/'
    return /^\d{4}/.test(sample)
      ? `${z.year}${sep}${m}${sep}${d}`
      : dayFirst
        ? `${d}${sep}${m}${sep}${z.year}`
        : `${m}${sep}${d}${sep}${z.year}`
  }
  const locale = lang === 'it' ? 'it-IT' : 'en-US'
  return new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'short', year: 'numeric' })
    .format(date)
    .replace('.', '')
}

/** Waits until the file is fully uploaded (closing the tab earlier would lose it). */
async function waitForUpload(page: Page, run: DriverRun) {
  await until(
    async () => {
      const text =
        (await page
          .locator('ytcp-video-upload-progress, .progress-label')
          .first()
          .textContent({ timeout: 1000 })
          .catch(() => '')) ?? ''
      return !/(upload|caricament)\w*\s+\d{1,3}\s?%|\d{1,3}\s?%\s+(upload|caricat)/i.test(text)
    },
    'the upload to finish',
    3 * 3600_000,
    3000,
  )
  run.step('Upload complete')
}

async function closeDialog(page: Page) {
  for (let i = 0; i < 3; i++) {
    const close = await firstVisible(
      [
        page.locator(
          'ytcp-video-share-dialog #close-button, ytcp-uploads-dialog #close-button, ytcp-uploads-still-processing-dialog #close-button',
        ),
        page.getByRole('button', { name: L.close }),
      ],
      2500,
    )
    if (!close) return
    await close.click().catch(() => {})
    await sleep(700)
  }
}

/**
 * Deletes an upload from its own Studio page (⋮ → Delete → "deleting is permanent" → Delete forever). The content
 * list would miss Shorts (another tab) and drafts (no video link), so the video's page is used.
 */
async function deleteVideo(run: DriverRun, _channelId: string, videoId: string) {
  const page = await run.page()
  run.step(`Deleting ${videoId} in YouTube Studio`)
  await page.goto(`${STUDIO}/video/${videoId}/edit`, { waitUntil: 'domcontentloaded' })
  await assertStudio(page)
  await until(async () => page.url().includes(`/video/${videoId}/`), 'the video’s Studio page', 45_000, 700)
  await clickOne(
    [
      page.locator('#overflow-menu-button, ytcp-icon-button#overflow-menu-button'),
      page.getByRole('button', { name: label(['Options', 'Opzioni', 'Altre azioni', 'More actions'], true) }),
    ],
    'the video menu',
  )
  await clickOne(
    [
      page
        .locator('tp-yt-paper-item, [role=menuitem]')
        .filter({ hasText: label(['Delete', 'Elimina'], true) }),
      page.getByRole('menuitem', { name: L.deleteForever }),
    ],
    'Delete',
  )
  const dialog = page
    .locator('ytcp-confirmation-dialog, tp-yt-paper-dialog')
    .filter({ has: page.locator('#confirm-checkbox') })
    .first()
  await clickOne(
    [dialog.locator('#confirm-checkbox'), page.getByRole('checkbox', { name: L.understand })],
    'the “deleting is permanent” box',
  )
  await clickOne(
    [dialog.locator('#confirm-button'), page.getByRole('button', { name: L.deleteForever })],
    'the final Delete forever',
  )
  await until(
    async () => !page.url().includes(`/video/${videoId}/`),
    'Studio to leave the deleted video',
    30_000,
    700,
  ).catch(() => {})
  run.step('Deleted on YouTube')
}

/** Adds title & description translations (Studio → Subtitles/Languages). */
async function setTranslations(run: DriverRun, videoId: string, req: Pick<PublishRequest, 'translations'>) {
  const page = await run.page()
  try {
    await addTranslations(run, page, videoId, req)
  } catch (err) {
    // A publish only warns about translations: keep a picture of the page for the warning.
    await run.snapshot(page, 'translations-failed')
    throw err
  }
}

/**
 * Studio's Languages page asks for the video's own language before it offers "Add language" ("Lingua del video:
 * Imposta lingua", then Conferma). It is set to Italian, the account's language for titles and descriptions, without
 * making it the channel's default.
 */
async function setVideoLanguage(run: DriverRun, page: Page, lang: string) {
  // Studio draws the page a moment after it loads: its language field (or, for a video that has its language, the
  // Add language button) is waited for. Looking at once found nothing, so the language was never set and Add language
  // never came (26 Nov 2026: "Lingua del video: Imposta lingua" still showing on the failed page).
  const unsetWords = ['Imposta lingua', 'Select language', 'Set language']
  // the field's text may carry its label too ("Lingua del video Imposta lingua"); the bare words are its value
  const unset = label(unsetWords)
  const field = page.locator('#language-input #trigger').first()
  const unsetText = page.getByText(label(unsetWords, true)).first()
  const ready = await firstVisible(
    [
      field,
      unsetText,
      page.locator('#add-translations-button'),
      page.getByRole('button', { name: L.addLanguage }),
    ],
    20_000,
  )
  if (!ready) return
  const trigger = (await firstVisible([field], 300)) ?? (await firstVisible([unsetText], 300))
  if (!trigger) return
  const shown = async () =>
    ((await trigger.textContent({ timeout: 2000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
  if (!unset.test(await shown())) return
  const italian = new Intl.DisplayNames(['it'], { type: 'language' }).of(lang) ?? lang
  const english = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang
  // "Imposta come predefinita per il mio canale" (ticked at first) is unticked, so the channel's default stays as it
  // is. The box's inner element (role=checkbox) sits under its container, which takes the click (26 Nov 2026, a
  // look at the real page: a click on the inner one never landed): the box's own element is clicked.
  const asDefault = page.getByRole('checkbox', { name: label(['predefinita', 'default']) }).first()
  const ticked = async () =>
    (await asDefault.getAttribute('aria-checked', { timeout: 2000 }).catch(() => null)) === 'true'
  // Right after the form shows, a click on it may not take yet (26 Nov 2026, the first live run with the box's own
  // element: still ticked): it is tried a few times. A box that stays ticked stops here, before Conferma, so the
  // channel's default is never changed by Greenlit.
  const host = page.locator('ytcp-checkbox-lit').filter({ has: asDefault }).first()
  let why = ''
  for (let i = 0; i < 4 && (await ticked()); i++) {
    why = await ((await host.count()) ? host : asDefault).click({ timeout: 5000 }).then(
      () => '',
      (err: Error) => `: ${err.message.split('\n')[0]}`,
    )
    await sleep(800)
  }
  if (await ticked())
    throw new Error(
      `The "make it the channel's default" box would not untick${why}; the video's language was left unset`,
    )
  // The list ("Lingua del video") has every language (238 on 26 Nov 2026, Italian names), each item carrying its code
  // as `test-id` ("it"); by name when it has none. A click right after the list opens or scrolls does not choose
  // (the same look: it took once the list had settled), so the list is given a moment, and a second try.
  // Only a list that shows: Studio may keep others in the page (the Add language one).
  const list = page
    .locator('tp-yt-paper-listbox[role=listbox]')
    .filter({ visible: true })
    .filter({ has: page.locator('tp-yt-paper-item') })
  const open = async () => {
    await trigger.click()
    await list.first().waitFor({ state: 'visible', timeout: 10_000 })
    await sleep(700)
  }
  for (let attempt = 0; attempt < 3 && unset.test(await shown()); attempt++) {
    if (
      !(await list
        .first()
        .isVisible()
        .catch(() => false))
    )
      await open()
    const items = list.first().locator('tp-yt-paper-item[role=option]')
    const byCode = list.first().locator(`tp-yt-paper-item[test-id="${lang}"]`).first()
    let item = byCode
    if (!(await byCode.count())) {
      const at = await items.evaluateAll(
        (els, names) =>
          els.findIndex((e) => {
            // biome-ignore lint/performance/useDomNodeTextContent: the item's lines as shown; its first is the name
            const first = ((e as HTMLElement).innerText || '').split('\n')[0]!.trim().toLowerCase()
            return names.includes(first)
          }),
        [italian.toLowerCase(), english.toLowerCase()],
      )
      if (at < 0) throw new Error(`${english} is not in YouTube's language list`)
      item = items.nth(at)
    }
    await item.scrollIntoViewIfNeeded()
    await sleep(500)
    await item.click()
    await sleep(1000)
  }
  if (unset.test(await shown())) {
    await run.snapshot(page, 'language-not-taken')
    throw new Error(`YouTube did not take ${english} as the video's language`)
  }
  const confirm = await firstVisible(
    [
      page.locator('ytcp-button#confirm-button'),
      page.getByRole('button', { name: label(['Conferma', 'Confirm'], true) }),
    ],
    5000,
  )
  if (!confirm) throw new Error('Could not find Confirm for the language')
  // Conferma comes on once the language is taken; a picture of the form is kept when it does not.
  const on = await until(
    async () =>
      (await confirm.getAttribute('aria-disabled').catch(() => 'true')) !== 'true' &&
      (await confirm.isEnabled().catch(() => false)),
    'Confirm',
    8000,
    400,
  ).then(
    () => true,
    () => false,
  )
  if (!on) {
    await run.snapshot(page, 'language-not-taken')
    const value = (await shown()).split('. ').pop() ?? ''
    throw new Error(
      `Confirm stayed off for the video's language (the field shows "${value}", the default box is ${(await ticked()) ? 'ticked' : 'not ticked'})`,
    )
  }
  await confirm.click()
  await sleep(1500)
  run.step(`Video language: ${english}`)
}

async function addTranslations(
  run: DriverRun,
  page: Page,
  videoId: string,
  req: Pick<PublishRequest, 'translations'>,
) {
  await page.goto(`${STUDIO}/video/${videoId}/translations`, { waitUntil: 'domcontentloaded' })
  await assertStudio(page)
  await setVideoLanguage(run, page, 'it')
  for (const [lang, t] of Object.entries(req.translations)) {
    if (!t.title && !t.caption) continue
    // Studio names languages in the account's language (Italian: "Inglese"), whatever the browser's is.
    const names = [
      ...new Set(
        [run.locale, 'it', 'en'].map(
          (l) => new Intl.DisplayNames([l], { type: 'language' }).of(lang) ?? lang,
        ),
      ),
    ]
    const english = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang
    let row = page
      .locator('ytgn-video-translation-row, ytcp-video-translation-row, [role=row]')
      .filter({ hasText: label(names) })
      .first()
    if (!(await row.isVisible().catch(() => false))) {
      await clickOne(
        [page.locator('#add-translations-button'), page.getByRole('button', { name: L.addLanguage })],
        'Add language',
      )
      // The list is the same kind as the video's language list: items with their code as `test-id`, Italian names,
      // and a click while it is still opening does not choose.
      const menu = page
        .locator('tp-yt-paper-listbox[role=listbox]')
        .filter({ visible: true })
        .filter({ has: page.locator('tp-yt-paper-item') })
        .first()
      await menu.waitFor({ state: 'visible', timeout: 10_000 })
      await sleep(700)
      let item = menu.locator(`tp-yt-paper-item[test-id="${lang}"]`).first()
      if (!(await item.count()))
        item = menu
          .locator('tp-yt-paper-item')
          .filter({ hasText: label(names, true) })
          .first()
      if (!(await item.count())) throw new Error(`Could not find ${english} in the language list`)
      await item.scrollIntoViewIfNeeded()
      await sleep(500)
      await item.click()
      await sleep(1200)
      row = page
        .locator('ytgn-video-translation-row, ytcp-video-translation-row, [role=row]')
        .filter({ hasText: label(names) })
        .first()
    }
    await clickOne(
      [
        row.locator('#metadata-cell').getByRole('button'),
        row.getByRole('button', { name: label(['Add', 'Aggiungi', 'Edit', 'Modifica'], true) }).last(),
      ],
      `the title & description cell for ${english}`,
    )
    const dialog = page.getByRole('dialog').last()
    const fields = dialog.locator('[contenteditable="true"], textarea')
    await fields.first().waitFor({ state: 'visible', timeout: 15_000 })
    if (t.title) await setText(page, fields.nth(0), t.title.slice(0, 100))
    if (t.caption) await setText(page, fields.nth(1), t.caption.slice(0, 5000))
    await clickOne(
      [dialog.locator('#publish-button'), dialog.getByRole('button', { name: L.publish })],
      'Publish in the translation dialog',
    )
    await sleep(1500)
    run.step(`Translation added: ${english}`)
  }
}

/** Videos inside Studio's own list answers. */
export function parseStudioVideos(json: unknown[], placement: 'video' | 'short'): RemotePost[] {
  const out = new Map<string, RemotePost>()
  for (const v of findObjects(
    json,
    (o) => typeof o.videoId === 'string' && (o.title !== undefined || o.privacy !== undefined),
  )) {
    const id = str(v.videoId)
    if (out.has(id)) continue
    const privacy = str(v.privacy ?? (v.status as Record<string, unknown> | undefined)?.privacy)
    const sched = findObjects(v.scheduledPublishingDetails ?? v.scheduledPublishing ?? {}, () => true)
      .flatMap((o) => Object.entries(o))
      .find(([k, val]) => /sec/i.test(k) && (num(val) ?? 0) > 1_000_000_000)
    const scheduledAt = sched ? new Date(num(sched[1])! * 1000) : null
    const published = num(v.timePublishedSeconds)
    const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now()
    const metrics = (v.publicMetrics ?? v.metrics ?? {}) as Record<string, unknown>
    const stats: Record<string, number> = {}
    for (const [k, key] of [
      ['views', 'viewCount'],
      ['likes', 'likeCount'],
      ['comments', 'commentCount'],
    ] as const) {
      const n = num(metrics[key])
      if (n !== null) stats[k] = n
    }
    const short = placement === 'short' || /SHORT/i.test(str(v.videoType ?? v.contentType))
    out.set(id, {
      remoteId: id,
      url: short ? `https://www.youtube.com/shorts/${id}` : `https://youtu.be/${id}`,
      placement: short ? 'short' : 'video',
      title: str(v.title),
      caption: str(v.description),
      thumbnailUrl: firstUrl(v.thumbnailDetails) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      mediaUrl: null,
      state: /DELETED|REMOVED/i.test(str(v.status))
        ? 'removed'
        : isScheduled || (/PRIVATE/.test(privacy) && scheduledAt)
          ? 'scheduled'
          : 'published',
      scheduledAt: scheduledAt?.toISOString() ?? null,
      publishedAt: !isScheduled && published ? new Date(published * 1000).toISOString() : null,
      stats: Object.keys(stats).length ? stats : null,
    })
  }
  return [...out.values()]
}
