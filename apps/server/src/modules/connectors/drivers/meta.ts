import type { Platform } from '@greenlit/shared/areas/posts'
import type { Locator, Page } from 'playwright-core'
import {
  commentFacebook,
  facebookCapabilities,
  listFacebook,
  META_SCHEDULE,
  removeFacebook,
  updateFacebook,
} from './facebook.ts'
import { graphAs, rememberPageToken, userToken } from './graph.ts'
import {
  commentInstagram,
  instagramCapabilities,
  listInstagram,
  removeInstagram,
  updateInstagram,
} from './instagram.ts'
import {
  accountKey,
  ConnectorUnsupported,
  type DiscoveredAccount,
  type Driver,
  type DriverAccount,
  type DriverRun,
  NeedsLogin,
  type PublishOutcome,
  type PublishRequest,
  type RemotePost,
} from './types.ts'
import {
  clickOne,
  cookie,
  findObjects,
  firstVisible,
  label,
  pageMeta,
  parseTracks,
  probeClip,
  setText,
  sleep,
  sniffJson,
  str,
  until,
  zoned,
} from './util.ts'

/**
 * Facebook Pages and Instagram professional accounts through Meta Business Suite (business.facebook.com). The owner
 * signs in once on Business Suite's own login (with Facebook, Instagram or a managed Meta business account) and
 * picks which of the Pages that login manages — its own and its business portfolios' — and linked Instagram
 * accounts to connect; nobody signs in to the Pages themselves. They all share the one browser profile and
 * `platformIds` tells them apart ({ pageId, igUserId, businessId }).
 *
 * Posting drives the Business Suite composers (post, reel, story) like a person would; Business Suite keeps
 * scheduled posts on Meta's side.
 */

const BS = 'https://business.facebook.com'

const L = {
  createPost: label(['Create post', 'Crea post', 'Crea un post']),
  createReel: label(['Create reel', 'Crea reel', 'Crea un reel']),
  createStory: label(['Create story', 'Crea storia', 'Crea una storia']),
  addMedia: label([
    'Add photo/video',
    'Add photo',
    'Add video',
    'Aggiungi foto/video',
    'Aggiungi foto',
    'Aggiungi video',
    'Add media',
    'Aggiungi contenuti multimediali',
    'Upload video',
    'Carica video',
  ]),
  fromComputer: label([
    'Upload from desktop',
    'Upload from computer',
    'Carica dal computer',
    'Carica dal desktop',
  ]),
  postTo: label(['Post to', 'Share to', 'Pubblica su', 'Condividi su']),
  text: label([
    'Write into the dialogue box',
    'include text with your post',
    'Scrivi nella finestra di dialogo',
    'Text',
    'Testo',
    'Description',
    'Descrizione',
    'Describe your reel',
    'Descrivi il tuo reel',
    "What's on your mind",
    'A cosa stai pensando',
  ]),
  location: label(['Add location', 'Location', 'Aggiungi luogo', 'Luogo', 'Posizione']),
  scheduling: label([
    'Scheduling options',
    'Schedule',
    'Set date and time',
    'Opzioni di programmazione',
    'Programma',
    'Imposta data e ora',
  ]),
  setDateTime: label(['Set date and time', 'Imposta data e ora']),
  next: label(['Next', 'Avanti'], true),
  scheduleButton: label(['Schedule', 'Programma', 'Pianifica'], true),
  finalButtons: label(
    [
      'Publish',
      'Pubblica',
      'Schedule',
      'Programma',
      'Share',
      'Condividi',
      'Share now',
      'Condividi ora',
      'Post',
      'Posta',
    ],
    true,
  ),
  music: label(['Add audio', 'Aggiungi audio', 'Add music', 'Music', 'Aggiungi musica', 'Musica']),
  search: label(['Search', 'Cerca', 'Search music', 'Cerca musica']),
  add: label(['Add', 'Aggiungi', 'Use', 'Usa', 'Done', 'Fine', 'Save', 'Salva', 'Apply', 'Applica'], true),
  cover: label(['Cover', 'Copertina', 'Thumbnail', 'Miniatura', 'Edit thumbnail', 'Modifica miniatura']),
  uploadImage: label(['Upload image', 'Carica immagine', 'Upload', 'Carica']),
  discard: label(
    [
      'Discard changes',
      'Scarta modifiche',
      'Elimina modifiche',
      'Discard',
      'Scarta',
      'Discard post',
      'Elimina post',
      'Leave',
      'Esci',
      'Close',
      'Chiudi',
    ],
    true,
  ),
  cancel: label(['Cancel', 'Annulla'], true),
  savePreference: label(['Save preference', 'Salva preferenza', 'Salva preferenze']),
}

export const meta: Driver = {
  id: 'meta-business-suite',
  name: 'Meta Business Suite',
  platforms: ['facebook', 'instagram'],
  signIn: {
    // Business Suite's own login: Facebook, Instagram or a managed Meta business account.
    url: `${BS}/latest/home`,
    method: 'password',
    cookieDomains: ['facebook.com'],
  },
  capabilities: (p: Platform) => (p === 'instagram' ? instagramCapabilities : facebookCapabilities),

  async looksSignedIn(context) {
    // Read for business.facebook.com: covers both .facebook.com and Business Suite's own session cookies.
    return (
      !!(await cookie(context, BS, 'c_user')) &&
      !!(await cookie(context, BS, 'xs')) &&
      !context.pages().some((p) => /\/(business\/)?login(page)?\b|\/checkpoint\//.test(p.url()))
    )
  },

  /**
   * Every Page this login can post to — the Pages it manages itself and those of the business portfolios it
   * belongs to — and the Instagram account linked to each, deduplicated by id.
   */
  async discover(run) {
    const token = await userToken(run).catch((err) => {
      if (err instanceof NeedsLogin) throw err
      return null
    })
    if (token) {
      const pages = new Map<string, PageRow & { via: string | null; businessId: string | null }>()
      let reached = false
      try {
        const own = await graphAs<{ data?: PageRow[] }>(run, 'user', 'me/accounts', {
          fields: PAGE_FIELDS,
          limit: '100',
        })
        reached = true
        for (const p of own.data ?? []) pages.set(p.id, { ...p, via: null, businessId: null })
      } catch (err) {
        if (err instanceof NeedsLogin) throw err
        run.warn(`Your own Pages could not be read (${(err as Error).message})`)
      }
      try {
        const biz = await graphAs<{ data?: BusinessRow[] }>(run, 'user', 'me/businesses', {
          fields: `id,name,owned_pages.limit(100){${PAGE_FIELDS}},client_pages.limit(100){${PAGE_FIELDS}}`,
          limit: '50',
        })
        reached = true
        for (const b of biz.data ?? [])
          for (const p of [...(b.owned_pages?.data ?? []), ...(b.client_pages?.data ?? [])]) {
            const had = pages.get(p.id)
            if (!had) pages.set(p.id, { ...p, via: b.name, businessId: b.id })
            else {
              had.businessId ??= b.id
              had.access_token ??= p.access_token
              had.instagram_business_account ??= p.instagram_business_account
            }
          }
      } catch (err) {
        if (err instanceof NeedsLogin) throw err
        run.log.debug({ err: (err as Error).message }, 'business portfolios not readable')
      }
      if (reached) {
        // Who signed in to Business Suite (shown above the Pages it reaches).
        const me = await graphAs<{ name?: string }>(run, 'user', 'me', { fields: 'name' }).catch(() => null)
        const login = me?.name ? { name: me.name } : null
        return pages.size
          ? [...pages.values()].flatMap((p) => accountsOfPage(run, p)).map((a) => ({ ...a, login }))
          : []
      }
    }
    return discoverFromPage(run)
  },

  async check(run, account) {
    if (!(await this.looksSignedIn(run.context)))
      return { ok: false, reason: 'Facebook signed Greenlit out. Reconnect to sign in again.' }
    try {
      const found = await this.discover(run)
      if (!found.some((f) => f.platform === account.platform && f.externalId === account.externalId)) {
        return {
          ok: false,
          reason:
            account.platform === 'instagram'
              ? 'This login no longer manages the Page linked to this Instagram account.'
              : 'This login no longer manages this Page.',
        }
      }
      return { ok: true }
    } catch (err) {
      if (err instanceof NeedsLogin) return { ok: false, reason: err.message }
      throw err
    }
  },

  async publish(run, account, req) {
    if (req.scheduleAt) {
      const lead = req.scheduleAt.getTime() - Date.now()
      if (lead < META_SCHEDULE.minLeadMinutes * 60_000)
        throw new ConnectorUnsupported(
          'scheduleAt',
          `Business Suite schedules at least ${META_SCHEDULE.minLeadMinutes} minutes ahead`,
        )
      if (lead > META_SCHEDULE.maxLeadDays * 86_400_000)
        throw new ConnectorUnsupported(
          'scheduleAt',
          `Business Suite schedules at most ${META_SCHEDULE.maxLeadDays} days ahead`,
        )
    }
    const page = await openComposer(run, account, req)
    const { result, bodies } = await sniffJson(
      page,
      (u) => /graphql|api\/graphql|ajax|upload/.test(u),
      () => compose(page, run, account, req),
      4000,
    )
    if (req.dryRun) return result
    const id = await findCreatedId(
      run,
      account,
      req,
      bodies.map((b) => b.json),
    )
    if (id && req.firstComment && !req.scheduleAt) {
      await (account.platform === 'instagram' ? commentInstagram : commentFacebook)(
        run,
        account,
        id,
        req.firstComment,
      ).catch((err) => run.warn(`First comment not posted: ${(err as Error).message}`))
    } else if (req.firstComment && req.scheduleAt)
      run.warn(
        'The first comment can only be added once the post is live (Business Suite has no first-comment field).',
      )
    return {
      remoteId: id ?? `pending:${Date.now()}`,
      url: id ? postUrl(account, id, req) : null,
      state: req.scheduleAt ? 'scheduled' : 'published',
    }
  },

  async update(run, account, remoteId, patch) {
    if (account.platform === 'instagram') updateInstagram(patch)
    await updateFacebook(run, account, remoteId, patch)
  },

  async remove(run, account, remoteId) {
    if (remoteId.startsWith('pending:') || remoteId === 'dry-run') return
    if (account.platform === 'instagram') removeInstagram()
    await removeFacebook(run, account, remoteId)
  },

  async list(run, account, opts) {
    return account.platform === 'instagram'
      ? listInstagram(run, account, opts.since)
      : listFacebook(run, account, opts.since)
  },

  async searchMusic(run, account, query, placement) {
    if (placement !== 'reel' || !this.capabilities(account.platform).music) return []
    const page = await openComposer(run, account, { placement: 'reel' } as PublishRequest)
    try {
      await uploadMedia(page, run, [await probeClip(run.dataDir)])
      await waitMedia(page, run)
      const { bodies } = await sniffJson(
        page,
        (u) => /graphql/.test(u),
        async () => {
          await openMusic(page)
          if (query) {
            const box = await firstVisible(
              [
                page.getByRole('searchbox'),
                page.getByPlaceholder(L.search),
                page.getByRole('textbox', { name: L.search }),
              ],
              8000,
            )
            if (!box) throw new Error('Business Suite’s music search box did not show up')
            await box.fill(query)
          }
          await sleep(3500)
        },
        1500,
      )
      return parseTracks(bodies).slice(0, 40)
    } finally {
      await leave(page)
    }
  },
}

// ── discovery ───────────────────────────────────────────────────────────

const PAGE_FIELDS =
  'id,name,username,link,access_token,picture.width(256).height(256){url},instagram_business_account{id,username,name,profile_picture_url}'

interface PageRow {
  id: string
  name: string
  username?: string
  link?: string
  access_token?: string
  picture?: { data?: { url?: string } }
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string }
}

interface BusinessRow {
  id: string
  name: string
  owned_pages?: { data?: PageRow[] }
  client_pages?: { data?: PageRow[] }
}

function accountsOfPage(
  run: DriverRun,
  p: PageRow & { via: string | null; businessId: string | null },
): DiscoveredAccount[] {
  if (p.access_token) rememberPageToken(run.context, p.id, p.access_token)
  const ig = p.instagram_business_account
  const biz = p.businessId ? { businessId: p.businessId, ...(p.via ? { businessName: p.via } : {}) } : {}
  const page: DiscoveredAccount = {
    platform: 'facebook',
    externalId: p.id,
    name: p.name,
    handle: p.username ? `@${p.username}` : '',
    avatarUrl: p.picture?.data?.url ?? null,
    profileUrl: p.link ?? `https://www.facebook.com/${p.id}`,
    platformIds: { pageId: p.id, ...(ig ? { igUserId: ig.id } : {}), ...biz },
    capabilities: facebookCapabilities,
    via: p.via,
  }
  if (!ig) return [page]
  return [
    page,
    {
      platform: 'instagram',
      externalId: ig.id,
      name: ig.name || ig.username || p.name,
      handle: ig.username ? `@${ig.username}` : '',
      avatarUrl: ig.profile_picture_url ?? null,
      profileUrl: ig.username ? `https://www.instagram.com/${ig.username}/` : null,
      platformIds: {
        igUserId: ig.id,
        pageId: p.id,
        ...(ig.username ? { username: ig.username } : {}),
        ...biz,
      },
      capabilities: instagramCapabilities,
      via: p.via,
      linkedTo: accountKey('facebook', p.id),
    },
  ]
}

/** Without the planner token: the Page Business Suite opens on, with its public details. */
async function discoverFromPage(run: DriverRun): Promise<DiscoveredAccount[]> {
  const page = await run.page()
  await page.goto(`${BS}/latest/home`, { waitUntil: 'domcontentloaded' })
  if (/\/login|loginpage/.test(page.url())) throw new NeedsLogin('Facebook asks to sign in again.')
  const pageId = await until(
    async () => new URL(page.url()).searchParams.get('asset_id'),
    'Business Suite to open a Page',
    45_000,
    800,
  ).catch(() => null)
  if (!pageId) return []
  const businessId = new URL(page.url()).searchParams.get('business_id')
  const m = await pageMeta(run.context, `https://www.facebook.com/${pageId}`)
  run.warn('Instagram could not be read without the Business Suite planner; reconnect later to add it.')
  return [
    {
      platform: 'facebook',
      externalId: pageId,
      name: m['og:title'] ?? 'Facebook Page',
      handle: '',
      avatarUrl: m['og:image'] ?? null,
      profileUrl: `https://www.facebook.com/${pageId}`,
      platformIds: { pageId, ...(businessId ? { businessId } : {}) },
      capabilities: facebookCapabilities,
    },
  ]
}

// ── composer ────────────────────────────────────────────────────────────

async function openComposer(
  run: DriverRun,
  account: DriverAccount,
  req: Pick<PublishRequest, 'placement'>,
): Promise<Page> {
  const page = await run.page()
  const pageId = account.platformIds.pageId
  const kind =
    req.placement === 'reel' ? 'reels_composer' : req.placement === 'story' ? 'story_composer' : 'composer'
  run.step(
    `Opening the Business Suite ${req.placement === 'reel' ? 'reel' : req.placement === 'story' ? 'story' : 'post'} composer`,
  )
  const business = account.platformIds.businessId ? `&business_id=${account.platformIds.businessId}` : ''
  // No `ref`: opened with ref=biz_web_content_manager the composer's caption editor fails to render (2026-11).
  await page.goto(`${BS}/latest/${kind}/?asset_id=${pageId}${business}`, {
    waitUntil: 'domcontentloaded',
  })
  if (/\/login|loginpage|checkpoint/.test(page.url()))
    throw new NeedsLogin('Facebook asks to sign in again. Reconnect the account.')
  const ready = await firstVisible(
    [
      page.locator('input[type=file]'),
      page.getByRole('button', { name: L.addMedia }),
      page.getByText(L.addMedia),
    ],
    25_000,
  )
  if (!ready) {
    // Older layouts: open it from the planner.
    await page.goto(`${BS}/latest/content_calendar?asset_id=${pageId}${business}`, {
      waitUntil: 'domcontentloaded',
    })
    const create =
      req.placement === 'reel' ? L.createReel : req.placement === 'story' ? L.createStory : L.createPost
    await clickOne(
      [
        page.getByRole('button', { name: create }),
        page.getByRole('link', { name: create }),
        page.getByText(create),
      ],
      'the Create button in Business Suite',
      25_000,
    )
  }
  return page
}

async function compose(
  page: Page,
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  await chooseDestination(page, run, account, req.placement)
  await uploadMedia(
    page,
    run,
    req.files.map((f) => f.path),
  )
  await waitMedia(page, run)
  if (req.placement === 'reel') {
    // Older layouts put the details after an edit step.
    for (let i = 0; i < 2; i++) {
      if (await firstVisible(captionBoxes(page), 2500)) break
      const next = await firstVisible([nextButton(page)], 2500)
      if (!next) break
      await next.click()
    }
  }
  if (req.placement !== 'story') {
    const box = await firstVisible(captionBoxes(page), 15_000)
    if (!box) throw new Error('The text box of the composer was not found')
    await setText(page, box, req.caption)
    run.step('Caption written')
  }
  if (req.thumbnailPath && req.placement === 'reel') await setCover(page, run, req.thumbnailPath)
  if (req.location?.name && req.placement !== 'story') await setLocation(page, run, req.location.name)
  // Reels go Create → Edit → Share: the music is on Edit, the switches, schedule and final button on Share.
  let musicDone = !req.music
  for (let i = 0; i < 4; i++) {
    if (!musicDone && (await firstVisible([page.getByRole('button', { name: L.music })], 2500))) {
      await addMusic(page, run, req)
      musicDone = true
    }
    const next = await firstVisible([nextButton(page)], 2500)
    if (!next) break
    await next.click()
    run.step('Next')
    await sleep(1500)
  }
  if (!musicDone) {
    const msg = 'Business Suite showed no music button for this post'
    if (req.dryRun) run.warn(msg)
    else throw new Error(msg)
  }
  await setOptions(page, run, req)
  if (req.scheduleAt) await setSchedule(page, run, req)
  // Labelled as text (the previews have icon-only Share buttons), and the last one: the footer comes after the
  // "Share now / Schedule" choice.
  const final = await firstVisible(
    [page.getByRole('button', { name: L.finalButtons }).filter({ hasText: L.finalButtons }).last()],
    10_000,
  )
  if (!final) throw new Error('The Publish / Schedule button was not found')
  await until(
    async () => (await final!.isEnabled()) && (await final!.getAttribute('aria-disabled')) !== 'true',
    'the Publish button to be ready',
    10 * 60_000,
    1500,
  )
  if (req.scheduleAt) {
    // The button turns from Publish/Share into Schedule a moment after the date is set; never press it before,
    // or the post would go out at once.
    const scheduling = await until(
      async () => L.scheduleButton.test((await final.textContent()) ?? ''),
      'the Schedule button',
      10_000,
      400,
    )
      .then(() => true)
      .catch(() => false)
    if (!scheduling)
      throw new Error(
        'Business Suite did not switch to scheduling (its button still publishes now); nothing was posted',
      )
  }
  const pressed = (await final.textContent())?.trim()
  if (!pressed) throw new Error('The Publish / Schedule button has no label; nothing was pressed')
  if (req.dryRun) {
    const shot = await run.snapshot(page, 'before-publish')
    await leave(page)
    return {
      remoteId: 'dry-run',
      url: null,
      state: req.scheduleAt ? 'scheduled' : 'published',
      dryRun: { steps: [], warnings: [], screenshot: shot, wouldPress: pressed },
    }
  }
  run.step(`Pressing ${pressed}`)
  await final.click()
  await until(
    async () =>
      !(await final!.isVisible().catch(() => false)) ||
      (await page
        .getByText(label(['published', 'pubblicat', 'scheduled', 'programmat', 'shared', 'condivis']))
        .first()
        .isVisible()
        .catch(() => false)),
    'Business Suite to confirm',
    5 * 60_000,
    1500,
  )
  return { remoteId: '', url: null, state: req.scheduleAt ? 'scheduled' : 'published' }
}

/** The step button ("Next" as text: carousels have icon-only buttons labelled Next too). */
function nextButton(page: Page): Locator {
  return page.getByRole('button', { name: L.next }).filter({ hasText: L.next }).last()
}

/** The caption editor: a contenteditable (role combobox or textbox, depending on the composer). */
function captionBoxes(page: Page): Locator[] {
  return [
    page.getByRole('combobox', { name: L.text }),
    page.getByRole('textbox', { name: L.text }),
    page.locator('div[contenteditable="true"]'),
    page.locator('textarea'),
  ]
}

/**
 * "Post to" lists the Page, its Instagram and Facebook groups as options (aria-selected); Business Suite
 * preselects the Page and its Instagram together. Only the account being published to stays selected.
 */
async function chooseDestination(page: Page, run: DriverRun, account: DriverAccount, _placement: string) {
  const igName = (account.platformIds.username ?? account.handle.replace(/^@/, '')).toLowerCase()
  const pageName = account.name.toLowerCase()
  const opener = await firstVisible(
    [
      page.locator('[role="combobox"]:not([contenteditable="true"]):not(input)'),
      page.getByRole('button', { name: L.postTo }),
      page.getByRole('combobox', { name: L.postTo }),
    ],
    8000,
  )
  if (!opener) {
    run.warn('The “Post to” choice was not found; check the destination in the dry-run picture')
    return
  }
  await opener.click()
  const options = page.getByRole('option')
  await options
    .first()
    .waitFor({ state: 'visible', timeout: 6000 })
    .catch(() => {})
  const read = async () => {
    const out: { i: number; text: string; selected: boolean; target: boolean }[] = []
    const n = await options.count()
    for (let i = 0; i < n; i++) {
      const o = options.nth(i)
      const text = ((await o.textContent().catch(() => '')) ?? '').trim().toLowerCase()
      if (!text || L.savePreference.test(text)) continue
      const isIg = !!igName && text.startsWith(igName)
      const isPage = !isIg && text.startsWith(pageName.slice(0, 24))
      out.push({
        i,
        text,
        selected: (await o.getAttribute('aria-selected')) === 'true',
        target: account.platform === 'instagram' ? isIg : isPage,
      })
    }
    return out
  }
  let list = await read()
  const target = list.find((o) => o.target)
  if (!target) {
    await page.keyboard.press('Escape').catch(() => {})
    throw new Error(`“${account.name}” is not offered under “Post to” in Business Suite`)
  }
  // Select the target first (one destination must stay selected), then clear everything else.
  if (!target.selected) await options.nth(target.i).click()
  for (let pass = 0; pass < 3; pass++) {
    list = await read()
    const extra = list.find((o) => o.selected && !o.target)
    if (!extra) break
    await options.nth(extra.i).click()
    await sleep(400)
  }
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(500)
  const left = (await read().catch(() => list)).filter((o) => o.selected && !o.target)
  if (left.length) run.warn(`“Post to” still includes ${left.map((o) => o.text).join(', ')}`)
  run.step(`Posting to ${account.platform === 'instagram' ? 'Instagram' : 'the Facebook Page'} only`)
}

async function uploadMedia(page: Page, run: DriverRun, paths: string[]) {
  let input = page.locator('input[type=file]').first()
  if (!(await input.count())) {
    const add = await firstVisible(
      [page.getByRole('button', { name: L.addMedia }), page.getByText(L.addMedia)],
      10_000,
    )
    if (!add) throw new Error('The Add photo/video button was not found')
    const chooser = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null)
    await add.click()
    const fromPc = await firstVisible(
      [page.getByRole('menuitem', { name: L.fromComputer }), page.getByText(L.fromComputer)],
      2500,
    )
    const fc = fromPc
      ? await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), fromPc.click()]).then(
          ([c]) => c,
        )
      : await chooser
    if (fc) {
      await fc.setFiles(paths)
      run.step(`${paths.length} file${paths.length > 1 ? 's' : ''} added`)
      return
    }
    input = page.locator('input[type=file]').first()
  }
  await input.setInputFiles(paths)
  run.step(`${paths.length} file${paths.length > 1 ? 's' : ''} added`)
}

/** Waits until no upload is still going: a visible 0–99 % or an unfinished progress bar (100 % stays shown). */
async function waitMedia(page: Page, run: DriverRun) {
  await sleep(2000)
  await until(
    async () =>
      !(await page
        .evaluate(() => {
          const shown = (e: Element) => {
            const r = (e as HTMLElement).getBoundingClientRect()
            return r.width > 0 && r.height > 0
          }
          const pct = [...document.querySelectorAll('span, div')].some(
            (e) => e.children.length === 0 && /^\s*\d{1,2}\s?%\s*$/.test(e.textContent ?? '') && shown(e),
          )
          const bars = [...document.querySelectorAll('[role=progressbar]')].some((b) => {
            if (!shown(b)) return false
            const now = b.getAttribute('aria-valuenow')
            return now === null || Number(now) < Number(b.getAttribute('aria-valuemax') ?? 100)
          })
          return pct || bars
        })
        .catch(() => false)),
    'the upload to Business Suite',
    30 * 60_000,
    2000,
  )
  run.step('Upload finished')
}

async function openMusic(page: Page) {
  await clickOne(
    [page.getByRole('button', { name: L.music }), page.getByText(L.music).first()],
    'the music button of the reel composer',
    15_000,
  )
}

async function addMusic(page: Page, run: DriverRun, req: PublishRequest) {
  const m = req.music!
  try {
    await openMusic(page)
    const box = await firstVisible(
      [
        page.getByRole('searchbox'),
        page.getByPlaceholder(L.search),
        page.getByRole('textbox', { name: L.search }),
      ],
      8000,
    )
    if (!box) throw new Error('no music search box')
    await box.fill(`${m.title} ${m.artist}`.trim())
    await sleep(3000)
    const item = page
      .getByRole('dialog')
      .last()
      .locator('[role=row], [role=listitem], [role=option], [role=button]')
      .filter({ hasText: m.title })
      .first()
    await item.waitFor({ state: 'visible', timeout: 10_000 })
    await item.click()
    await clickOne(
      [page.getByRole('dialog').last().getByRole('button', { name: L.add })],
      'Add for the track',
      8000,
    )
    if (req.audio.original === 0)
      run.warn('Business Suite has no switch to mute the video’s own sound; it plays under the music.')
    run.step(`Music: ${m.title}${m.artist ? ` — ${m.artist}` : ''}`)
  } catch (err) {
    if (req.dryRun) run.warn(`Music not added: ${(err as Error).message}`)
    else throw new Error(`Could not add the track “${m.title}” in Business Suite: ${(err as Error).message}`)
  }
}

async function setCover(page: Page, run: DriverRun, path: string) {
  try {
    const open = await firstVisible(
      [page.getByRole('button', { name: L.cover }), page.getByText(L.cover).first()],
      4000,
    )
    if (open) await open.click()
    const chooser = page.waitForEvent('filechooser', { timeout: 6000 })
    await clickOne(
      [page.getByRole('button', { name: L.uploadImage }), page.getByText(L.uploadImage).first()],
      'Upload image for the cover',
      6000,
    )
    await (await chooser).setFiles(path)
    await sleep(1500)
    const save = await firstVisible(
      [page.getByRole('dialog').last().getByRole('button', { name: L.add })],
      3000,
    )
    if (save) await save.click()
    run.step('Cover uploaded')
  } catch (err) {
    run.warn(`Cover not set: ${(err as Error).message}`)
  }
}

async function setLocation(page: Page, run: DriverRun, name: string) {
  try {
    const box = await firstVisible(
      [
        page.getByRole('combobox', { name: L.location }),
        page.getByPlaceholder(L.location),
        page.getByRole('textbox', { name: L.location }),
      ],
      3000,
    )
    const field =
      box ??
      (await (async () => {
        const open = await firstVisible([page.getByRole('button', { name: L.location })], 2000)
        if (!open) return null
        await open.click()
        return firstVisible(
          [
            page.getByRole('combobox'),
            page.getByPlaceholder(L.location),
            page.getByRole('textbox', { name: L.location }),
          ],
          4000,
        )
      })())
    if (!field) throw new Error('no location field')
    await field.fill(name)
    await sleep(1800)
    await clickOne(
      [page.getByRole('option').first(), page.getByRole('listbox').getByRole('option').first()],
      'a place suggestion',
      5000,
    )
    run.step(`Location: ${name}`)
  } catch (err) {
    run.warn(`Location not set: ${(err as Error).message}`)
  }
}

/** Switches the composer offers (labels differ per account type; missing ones are reported, never guessed). */
async function setOptions(page: Page, run: DriverRun, req: PublishRequest) {
  const toggles: [string, RegExp][] = [
    [
      'paidPartnership',
      label([
        'Paid partnership label',
        'Add paid partnership label',
        'Etichetta di partnership retribuita',
        'Partnership retribuita',
      ]),
    ],
    [
      'shareToFeed',
      label(['Also share to feed', 'Share to feed', 'Condividi anche nel feed', 'Condividi nel feed']),
    ],
    [
      'aiGenerated',
      label([
        'AI info',
        'Made with AI',
        'AI-generated',
        'Informazioni sull’IA',
        'Creato con l’IA',
        'Generato con l’IA',
      ]),
    ],
  ]
  for (const [key, name] of toggles) {
    const want = req.options[key]
    if (typeof want !== 'boolean') continue
    const sw = await firstVisible(
      [page.getByRole('switch', { name }), page.getByRole('checkbox', { name })],
      2000,
    )
    if (!sw) {
      if (want) run.warn(`${key}: Business Suite shows no such switch for this post`)
      continue
    }
    if (((await sw.getAttribute('aria-checked')) === 'true') !== want) await sw.click()
    run.step(`${key}: ${want}`)
  }
  if (req.options.allowComments === false)
    run.warn(
      'Business Suite cannot turn comments off before posting; switch them off on the post afterwards.',
    )
}

async function setSchedule(page: Page, run: DriverRun, req: PublishRequest) {
  const z = zoned(req.scheduleAt!, req.timeZone)
  const toggle = await firstVisible(
    [
      page.getByRole('switch', { name: L.setDateTime }),
      page.getByRole('checkbox', { name: L.setDateTime }),
      page.getByRole('button', { name: L.scheduling }),
      page.getByText(L.scheduling).first(),
    ],
    8000,
  )
  if (!toggle) throw new Error('The scheduling options were not found')
  const role = await toggle.getAttribute('role')
  if (role === 'switch' || role === 'checkbox') {
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click()
  } else {
    await toggle.click()
    const sw = await firstVisible(
      [
        page.getByRole('switch', { name: L.setDateTime }),
        page.getByRole('checkbox', { name: L.setDateTime }),
      ],
      3000,
    )
    if (sw && (await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
  }
  // Date: a text field (mm/dd/yyyy or dd/mm/yyyy, from its placeholder); time: hour/minute(/AM-PM) spin buttons.
  const date = await firstVisible(
    [
      page.getByRole('textbox', { name: label(['Date', 'Data']) }),
      page.locator('input[placeholder*="yyyy" i], input[placeholder*="aaaa" i], input[placeholder*="/"]'),
    ],
    6000,
  )
  if (!date) throw new Error('The schedule date field was not found')
  const ph = ((await date.getAttribute('placeholder')) ?? '').toLowerCase()
  const dd = String(z.day).padStart(2, '0')
  const mo = String(z.month).padStart(2, '0')
  const value = /^m/.test(ph)
    ? `${mo}/${dd}/${z.year}`
    : /^y|^a/.test(ph)
      ? `${z.year}-${mo}-${dd}`
      : `${dd}/${mo}/${z.year}`
  await date.click()
  await date.fill(value)
  await date.press('Enter').catch(() => {})
  const spins = page.getByRole('spinbutton')
  const count = await spins.count()
  if (count >= 2) {
    const ampm = count >= 3
    const hour = ampm ? z.hour % 12 || 12 : z.hour
    await typeSpin(spins.nth(0), String(hour).padStart(2, '0'))
    await typeSpin(spins.nth(1), String(z.minute).padStart(2, '0'))
    if (ampm) await typeSpin(spins.nth(2), z.hour < 12 ? 'A' : 'P')
  } else {
    const time = await firstVisible(
      [
        page.getByRole('textbox', { name: label(['Time', 'Ora', 'Orario']) }),
        page.locator('input[type=time]'),
      ],
      4000,
    )
    if (!time) throw new Error('The schedule time field was not found')
    await time.fill(z.hm)
  }
  run.step(`Scheduled for ${z.iso} ${z.hm} (${req.timeZone})`)
}

async function typeSpin(spin: Locator, value: string) {
  await spin.click()
  await spin.press('Control+A').catch(() => {})
  await spin.pressSequentially(value, { delay: 60 })
}

/** Leaves the composer without saving anything (Cancel → Discard changes; never "Finish later"). */
async function leave(page: Page) {
  const cancel = await firstVisible([page.getByRole('button', { name: L.cancel })], 1500)
  if (cancel) await cancel.click().catch(() => {})
  else await page.keyboard.press('Escape').catch(() => {})
  const discard = await firstVisible(
    [page.getByRole('dialog').last().getByRole('button', { name: L.discard })],
    2500,
  )
  if (discard) await discard.click().catch(() => {})
  await sleep(600)
  await page.goto('about:blank').catch(() => {})
}

/** The new post's id: from Business Suite's own answers, else the newest matching post on the account. */
async function findCreatedId(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
  json: unknown[],
): Promise<string | null> {
  const pageId = account.platformIds.pageId
  const ids = findObjects(
    json,
    (o) => !!str(o.post_id ?? o.story_id ?? o.ig_media_id ?? o.instagram_media_id ?? o.video_id),
  )
    .map((o) =>
      str(
        account.platform === 'instagram'
          ? (o.ig_media_id ?? o.instagram_media_id)
          : (o.post_id ?? o.story_id ?? o.video_id),
      ),
    )
    .filter(Boolean)
  if (ids[0])
    return account.platform === 'facebook' && !ids[0].includes('_') && req.placement === 'feed'
      ? `${pageId}_${ids[0]}`
      : ids[0]
  const want = req.caption.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)
  let match: RemotePost | undefined
  // Business Suite lists a new post after a little while: look a few times (Instagram's scheduled posts are not
  // listed at all until they go live; those are linked by the sync).
  for (let i = 0; i < 3 && !match; i++) {
    await sleep(i ? 20_000 : 5000)
    const posts = await meta.list(run, account, {}).catch(() => [] as RemotePost[])
    match = posts.find(
      (p) =>
        p.caption.toLowerCase().replace(/\s+/g, ' ').trim().startsWith(want) &&
        (req.scheduleAt ? p.state === 'scheduled' : true),
    )
    if (account.platform === 'instagram' && req.scheduleAt) break
  }
  if (!match) run.warn('Business Suite accepted the post; its id is linked on the next sync.')
  return match?.remoteId ?? null
}

function postUrl(account: DriverAccount, id: string, req: PublishRequest) {
  if (account.platform === 'instagram') return null
  if (req.placement === 'reel') return `https://www.facebook.com/reel/${id}`
  return `https://www.facebook.com/${id}`
}
