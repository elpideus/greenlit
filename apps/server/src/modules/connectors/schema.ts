import type { AccountState, Capabilities } from '@greenlit/shared/areas/connectors'
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk, updatedAt } from '../../core/schema.ts'

/**
 * A social account Greenlit publishes to. Accounts are signed in through a browser profile of their own
 * (DATA_DIR/sessions/<session_dir>), so the owner signs in once with the normal account and no developer app.
 * Accounts that come from the same login (a Facebook Page and its Instagram account) share one profile.
 */
export const connectorAccounts = pgTable(
  'connector_accounts',
  {
    id: pk(),
    platform: text('platform').notNull(),
    /** Driver that talks to the platform (youtube-studio, meta-business-suite, tiktok-studio…). */
    driver: text('driver').notNull(),
    /** The platform's own id of the account (channel id, page id, Instagram user id, TikTok user id). */
    externalId: text('external_id').notNull(),
    name: text('name').notNull().default(''),
    handle: text('handle').notNull().default(''),
    /** Remote picture as read from the platform (expires); a copy is served by Greenlit. */
    avatarUrl: text('avatar_url'),
    /** Short hash of the local avatar copy, null when there is none. */
    avatarVersion: text('avatar_version'),
    profileUrl: text('profile_url'),
    state: text('state').$type<AccountState>().notNull().default('connecting'),
    stateMessage: text('state_message'),
    capabilities: jsonb('capabilities').$type<Capabilities>().notNull(),
    /** Ids the driver needs: page id, Instagram business id, business id, channel id, sec uid… */
    platformIds: jsonb('platform_ids').$type<Record<string, string>>().notNull().default({}),
    /** Browser profile folder, relative to DATA_DIR/sessions. */
    sessionDir: text('session_dir').notNull(),
    /** Who signed in (the Google account, the Facebook login), as the platform shows them. */
    signIn: jsonb('sign_in').$type<{ name: string; handle?: string; avatarUrl?: string | null }>(),
    /**
     * The same account reached through another connector: this one is merged into that one (the platform's own
     * connector) and fills in what it cannot do.
     */
    mergedInto: uuid('merged_into'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('connector_accounts_external').on(t.platform, t.externalId),
    index('connector_accounts_session').on(t.sessionDir),
  ],
)

export type AccountRow = typeof connectorAccounts.$inferSelect
