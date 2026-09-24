/**
 * Database schema (plan §17). Drizzle definitions mirror migrations/*.sql; the SQL is the source
 * of truth for what runs, the TypeScript is the source of truth for query types. PostGIS: the
 * `viewpoints.location` geography column is added by migration 0002 only when PostGIS is
 * installed, so it is intentionally absent from this file (no MVP query needs it).
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: timestamp('email_verified', { withTimezone: true }),
    /** Auth.js adapter writes `name`; the column is `display_name`. */
    name: text('display_name'),
    image: text('image'),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

/** Auth.js adapter tables. */
export const accounts = pgTable(
  'accounts',
  {
    // Property names are the snake_case keys @auth/drizzle-adapter writes.
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const profiles = pgTable('profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  units: text('units', { enum: ['metric', 'imperial'] })
    .notNull()
    .default('metric'),
  defaultTimezoneBehavior: text('default_timezone_behavior', { enum: ['location', 'device'] })
    .notNull()
    .default('location'),
  defaultLensEquivalentMm: integer('default_lens_equivalent_mm').notNull().default(24),
  ...timestamps,
});

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    shootDate: text('shoot_date'), // civil date YYYY-MM-DD, nullable
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('projects_user_idx').on(t.userId)],
);

export const viewpoints = pgTable(
  'viewpoints',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    elevationM: doublePrecision('elevation_m'),
    timezone: text('timezone').notNull(),
    headingDeg: doublePrecision('heading_deg').notNull(),
    pitchDeg: doublePrecision('pitch_deg').notNull(),
    fieldOfViewDeg: doublePrecision('field_of_view_deg').notNull(),
    focalLengthEquivalentMm: doublePrecision('focal_length_equivalent_mm'),
    selectedDatetimeUtc: timestamp('selected_datetime_utc', { withTimezone: true }).notNull(),
    weatherMode: text('weather_mode', {
      enum: ['FORECAST', 'EXTENDED_FORECAST', 'SCENARIO', 'RECENT_PAST', 'PAST'],
    }).notNull(),
    weatherScenario: text('weather_scenario'),
    previewSourceType: text('preview_source_type', {
      enum: ['REAL_REFERENCE', 'SIMULATED_LIGHTING', 'ESTIMATED_PREVIEW'],
    }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('viewpoints_project_idx').on(t.projectId),
    index('viewpoints_user_idx').on(t.userId),
  ],
);

export const previewSnapshots = pgTable(
  'preview_snapshots',
  {
    id: text('id').primaryKey(),
    viewpointId: text('viewpoint_id')
      .notNull()
      .references(() => viewpoints.id, { onDelete: 'cascade' }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    sourceType: text('source_type').notNull(),
    providerMetadata: jsonb('provider_metadata').notNull().default({}),
    astronomyState: jsonb('astronomy_state').notNull().default({}),
    weatherState: jsonb('weather_state').notNull().default({}),
    confidenceState: jsonb('confidence_state').notNull().default({}),
    thumbnailStorageKey: text('thumbnail_storage_key'),
    /** Small inline thumbnail (data URL) until object storage exists. */
    thumbnailDataUrl: text('thumbnail_data_url'),
  },
  (t) => [index('preview_snapshots_viewpoint_idx').on(t.viewpointId)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('stripe'),
    providerCustomerId: text('provider_customer_id').notNull(),
    providerSubscriptionId: text('provider_subscription_id'),
    status: text('status').notNull(),
    planKey: text('plan_key').notNull(),
    priceId: text('price_id'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscriptions_user_idx').on(t.userId),
    uniqueIndex('subscriptions_customer_idx').on(t.providerCustomerId),
    index('subscriptions_provider_sub_idx').on(t.providerSubscriptionId),
  ],
);

/** Every processed webhook event; the unique event id makes processing idempotent. */
export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().default('stripe'),
    providerEventId: text('provider_event_id').notNull(),
    type: text('type').notNull(),
    userId: text('user_id'),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
    outcome: text('outcome').notNull(),
  },
  (t) => [uniqueIndex('subscription_events_provider_event_idx').on(t.provider, t.providerEventId)],
);

export const providerCache = pgTable(
  'provider_cache',
  {
    namespace: text('namespace').notNull(),
    cacheKey: text('cache_key').notNull(),
    payload: jsonb('payload').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.namespace, t.cacheKey] }),
    index('provider_cache_expires_idx').on(t.expiresAt),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    action: text('action').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_user_idx').on(t.userId),
    index('audit_events_created_idx').on(t.createdAt),
  ],
);

/** Request budgeting (plan §19): per-user, per-day counters by resource. */
export const usageCounters = pgTable(
  'usage_counters',
  {
    userKey: text('user_key').notNull(), // user id or hashed anonymous key
    day: text('day').notNull(), // YYYY-MM-DD UTC
    resource: text('resource').notNull(), // weather | geocoder | imagery | terrain_bytes | preview
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userKey, t.day, t.resource] })],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Viewpoint = typeof viewpoints.$inferSelect;
export type NewViewpoint = typeof viewpoints.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type PreviewSnapshot = typeof previewSnapshots.$inferSelect;
