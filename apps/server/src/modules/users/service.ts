import { createHash, randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreateUserInput, Locale, Me, Role, UpdateUserInput, User, UserRef } from '@greenlit/shared'
import { hash, verify } from '@node-rs/argon2'
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import sharp from 'sharp'
import type { Actor, ActorUser } from '../../core/actor.ts'
import { badRequest, conflict, HttpError, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import { apiTokens, sessions, users } from './schema.ts'

type UserRow = typeof users.$inferSelect

export const SESSION_COOKIE = 'gl_session'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** Permissions a share-link session keeps: look at what it was sent and talk about it. */
const SHARE_PERMISSIONS = [
  'media.read',
  'posts.read',
  'projects.read',
  'comments.read',
  'comments.create',
  'calendar.read',
  'reviews.decide',
]

export class UsersService {
  private refCache = new Map<string, UserRef>()

  private ctx: ModuleContext
  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }

  private get db() {
    return this.ctx.db
  }

  avatarDir() {
    return join(this.ctx.config.dataDir, 'avatars')
  }

  toUser(r: UserRow): User {
    return {
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      avatarUrl: r.avatarPath ? `/api/users/${r.id}/avatar?v=${r.avatarPath.slice(-12, -5)}` : null,
      role: r.role as Role,
      locale: r.locale as Locale,
      disabled: r.disabled,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    }
  }

  toRef(r: UserRow): UserRef {
    const u = this.toUser(r)
    return { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl }
  }

  async count() {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users)
    return row?.n ?? 0
  }

  async list(): Promise<User[]> {
    const rows = await this.db.select().from(users).orderBy(asc(users.displayName))
    return rows.map((r) => this.toUser(r))
  }

  async get(id: string): Promise<UserRow> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id))
    if (!row) throw notFound('User not found')
    return row
  }

  /** UserRefs for any ids (missing ids are skipped). Cached; refreshed when a user changes. */
  async refs(ids: (string | null | undefined)[]): Promise<Map<string, UserRef>> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))]
    const missing = wanted.filter((id) => !this.refCache.has(id))
    if (missing.length) {
      const rows = await this.db.select().from(users).where(inArray(users.id, missing))
      for (const r of rows) this.refCache.set(r.id, this.toRef(r))
    }
    const out = new Map<string, UserRef>()
    for (const id of wanted) {
      const ref = this.refCache.get(id)
      if (ref) out.set(id, ref)
    }
    return out
  }

  async ref(id: string | null | undefined): Promise<UserRef | null> {
    if (!id) return null
    return (await this.refs([id])).get(id) ?? null
  }

  async create(input: CreateUserInput): Promise<User> {
    try {
      const [row] = await this.db
        .insert(users)
        .values({
          email: input.email.trim(),
          displayName: input.displayName.trim(),
          role: input.role,
          locale: input.locale,
          passwordHash: await hash(input.password),
        })
        .returning()
      this.ctx.events.emit('user.changed', { id: row!.id })
      return this.toUser(row!)
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('Someone already uses this email')
      throw err
    }
  }

  async update(id: string, input: UpdateUserInput, actor: Actor): Promise<User> {
    const current = await this.get(id)
    if (input.role && input.role !== 'admin' && current.role === 'admin') await this.ensureAnotherAdmin(id)
    if (input.disabled && current.role === 'admin') await this.ensureAnotherAdmin(id)
    if (actor.kind === 'user' && actor.user.id === id && input.role && input.role !== current.role)
      throw badRequest('You cannot change your own role')
    const patch: Partial<UserRow> = { updatedAt: new Date() }
    if (input.email !== undefined) patch.email = input.email.trim()
    if (input.displayName !== undefined) patch.displayName = input.displayName.trim()
    if (input.role !== undefined) patch.role = input.role
    if (input.locale !== undefined) patch.locale = input.locale
    if (input.disabled !== undefined) patch.disabled = input.disabled
    if (input.password) patch.passwordHash = await hash(input.password)
    try {
      const [row] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning()
      this.refCache.delete(id)
      if (input.password || input.disabled)
        await this.revokeSessions(
          id,
          actor.kind === 'user' && actor.user.id === id ? actor.sessionId : undefined,
        )
      this.ctx.events.emit('user.changed', { id })
      return this.toUser(row!)
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('Someone already uses this email')
      throw err
    }
  }

  async remove(id: string, actor: Actor) {
    const row = await this.get(id)
    if (actor.kind === 'user' && actor.user.id === id) throw badRequest('You cannot delete your own account')
    if (row.role === 'admin') await this.ensureAnotherAdmin(id)
    await this.db.delete(users).where(eq(users.id, id))
    this.refCache.delete(id)
    this.ctx.events.emit('user.changed', { id })
  }

  private async ensureAnotherAdmin(exceptId: string) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.disabled, false), sql`${users.id} <> ${exceptId}`))
    if ((row?.n ?? 0) === 0) throw badRequest('Greenlit needs at least one active admin')
  }

  async verifyPassword(row: UserRow, password: string) {
    try {
      return await verify(row.passwordHash, password)
    } catch {
      return false
    }
  }

  async login(email: string, password: string): Promise<UserRow> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email.trim()})`)
    // Always spend the hashing time so response timing does not reveal which emails exist.
    const ok = row
      ? await this.verifyPassword(row, password)
      : await verify('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$Zm9v', password).catch(() => false)
    if (!row || !ok) throw new HttpError('unauthenticated', 'Wrong email or password')
    if (row.disabled) throw new HttpError('forbidden', 'This account is disabled')
    return row
  }

  async setAvatar(id: string, input: Buffer) {
    const row = await this.get(id)
    const out = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize(512, 512, { fit: 'cover' })
      .webp({ quality: 86 })
      .toBuffer()
    await mkdir(this.avatarDir(), { recursive: true })
    const name = `${id}-${sha256(out.toString('base64')).slice(0, 12)}.webp`
    await writeFile(join(this.avatarDir(), name), out)
    if (row.avatarPath) await rm(join(this.avatarDir(), row.avatarPath), { force: true })
    await this.db.update(users).set({ avatarPath: name, updatedAt: new Date() }).where(eq(users.id, id))
    this.refCache.delete(id)
    this.ctx.events.emit('user.changed', { id })
  }

  async clearAvatar(id: string) {
    const row = await this.get(id)
    if (row.avatarPath) await rm(join(this.avatarDir(), row.avatarPath), { force: true })
    await this.db.update(users).set({ avatarPath: null }).where(eq(users.id, id))
    this.refCache.delete(id)
    this.ctx.events.emit('user.changed', { id })
  }

  // ── sessions ────────────────────────────────────────────────────────────

  async createSession(
    userId: string,
    opts: {
      days: number
      userAgent?: string
      ip?: string
      share?: { linkId: string; targetType: string; targetId: string | null }
    },
  ) {
    const token = randomBytes(32).toString('base64url')
    await this.db.insert(sessions).values({
      tokenHash: sha256(token),
      userId,
      kind: opts.share ? 'share' : 'web',
      shareLinkId: opts.share?.linkId,
      shareTargetType: opts.share?.targetType,
      shareTargetId: opts.share?.targetId ?? undefined,
      userAgent: opts.userAgent?.slice(0, 300),
      ip: opts.ip,
      expiresAt: new Date(Date.now() + opts.days * 86_400_000),
    })
    await this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId))
    return token
  }

  async resolveSession(token: string): Promise<Actor | null> {
    const [row] = await this.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    if (!row || row.u.disabled) return null
    if (Date.now() - row.s.lastSeenAt.getTime() > 5 * 60_000) {
      void this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.s.id))
      void this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, row.u.id))
    }
    const share = row.s.shareLinkId
      ? { linkId: row.s.shareLinkId, targetType: row.s.shareTargetType ?? '', targetId: row.s.shareTargetId }
      : undefined
    return this.actorFor(row.u, 'web', { sessionId: row.s.id, share })
  }

  async revokeSession(token: string) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)))
  }

  async revokeSessions(userId: string, keepSessionId?: string) {
    await this.db
      .delete(sessions)
      .where(
        and(eq(sessions.userId, userId), keepSessionId ? sql`${sessions.id} <> ${keepSessionId}` : undefined),
      )
  }

  // ── API tokens ──────────────────────────────────────────────────────────

  async createToken(userId: string, name: string, expiresInDays: number | null) {
    const secret = randomBytes(24).toString('base64url')
    const token = `glt_${secret}`
    const [row] = await this.db
      .insert(apiTokens)
      .values({
        userId,
        name,
        tokenHash: sha256(token),
        prefix: token.slice(0, 10),
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
      })
      .returning()
    return { token, row: row! }
  }

  async listTokens(userId: string) {
    return this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
      .orderBy(asc(apiTokens.createdAt))
  }

  async revokeToken(userId: string, id: string) {
    await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
  }

  async resolveToken(token: string, source: 'api' | 'mcp'): Promise<Actor | null> {
    const [row] = await this.db
      .select({ t: apiTokens, u: users })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(
        and(
          eq(apiTokens.tokenHash, sha256(token)),
          isNull(apiTokens.revokedAt),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
        ),
      )
    if (!row || row.u.disabled) return null
    if (!row.t.lastUsedAt || Date.now() - row.t.lastUsedAt.getTime() > 60_000) {
      void this.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.t.id))
    }
    return this.actorFor(row.u, source, { tokenId: row.t.id })
  }

  actorFor(
    u: UserRow,
    source: Actor['source'],
    extra: {
      sessionId?: string
      tokenId?: string
      share?: { linkId: string; targetType: string; targetId: string | null }
    } = {},
  ): Actor {
    const user: ActorUser = {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      avatarUrl: this.toUser(u).avatarUrl,
      role: u.role as Role,
      locale: u.locale as Locale,
    }
    let permissions = this.ctx.permissions.forRole(user.role)
    if (extra.share)
      permissions = new Set(SHARE_PERMISSIONS.filter((p) => permissions.has(p) || permissions.has('*')))
    return {
      kind: 'user',
      user,
      permissions,
      source: extra.share ? 'share' : (source as 'web'),
      sessionId: extra.sessionId,
      tokenId: extra.tokenId,
      share: extra.share,
    }
  }

  async me(actor: Actor): Promise<Me> {
    if (actor.kind !== 'user') throw new HttpError('unauthenticated')
    const row = await this.get(actor.user.id)
    return { ...this.toUser(row), permissions: [...actor.permissions], viaShareLink: !!actor.share }
  }
}
