import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ReleaseDraft, ReleaseEnvironment } from "@riic/arknights-domain/releases/types";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const gameReport = pgTable("game_report", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  roleKey: text("role_key").notNull(),
  sourceType: text("source_type").$type<"screenshot" | "manual">().notNull(),
  days: jsonb("days").$type<import("@riic/arknights-domain/game-report").GameReportRecord["days"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("game_report_user_role_created_idx").on(table.userId, table.roleKey, table.createdAt),
  check("game_report_source_type_check", sql`${table.sourceType} IN ('screenshot', 'manual')`),
]);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const rateLimit = pgTable("rateLimit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const sklandBinding = pgTable("skland_binding", {
  bindingKey: text("binding_key").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastAuthorizedAt: timestamp("last_authorized_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("skland_binding_user_id_idx").on(table.userId)]);

export const appSchema = pgSchema("app");

export const defenseRoom = appSchema.table("defense_room", {
  id: text("id").primaryKey(),
  hostId: text("host_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  server: text("server").notNull(),
  roomCode: text("room_code").default("").notNull(),
  inviteCode: text("invite_code").notNull(),
  note: text("note").default("").notNull(),
  status: text("status").default("open").notNull(),
  difficulty: text("difficulty").default("ac1").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).default(sql`now() + interval '2 hours'`).notNull(),
}, table => [index("defense_room_lobby_idx").on(table.server,table.status,table.expiresAt),
  uniqueIndex("defense_room_invite_code_idx").on(table.inviteCode),
  check("defense_room_server_check",sql`${table.server} IN ('official','bilibili')`),
  check("defense_room_status_check",sql`${table.status} IN ('open','started','closed')`),
  check("defense_room_difficulty_check",sql`${table.difficulty} IN ('ac1','ac2','ac3','ac4')`)]);

export const defenseProfile = appSchema.table("defense_profile", {
  portrait: text("portrait").default("default").notNull(),
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  favoriteFactions: text("favorite_factions").array().default(sql`ARRAY[]::text[]`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [check("defense_profile_portrait_check", sql`portrait IN ('default','portrait-1','portrait-2') OR portrait ~ '^char_[a-z0-9_]{1,64}$'`), check("defense_profile_factions_check",sql`cardinality(${table.favoriteFactions}) <= 23 AND ${table.favoriteFactions} <@ ARRAY['aegir','kazimierz','laterano','sargon','victoria','kjerag','siracusa','yan','harmony','precision','swift','dexterity','arcane','steadfast','support','foresight','miracle','investor','assault','unyielding','assistant','solo','technique']::text[]`)]);

export const defenseMember = appSchema.table("defense_member", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull().references(() => defenseRoom.id, { onDelete: "cascade" }),
  seat: integer("seat").notNull(),
  isReady: boolean("is_ready").default(false).notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("defense_member_room_idx").on(table.roomId),
  uniqueIndex("defense_member_room_seat_idx").on(table.roomId,table.seat),
  check("defense_member_seat_check",sql`${table.seat} BETWEEN 0 AND 3`)]);

// Archival ownership is independent of expiring Skland / gacha credentials.
export const gachaArchive = appSchema.table("gacha_archive", {
  uid: text("uid").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  nickname: text("nickname").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  warnings: jsonb("warnings").$type<string[]>().default([]).notNull(),
}, (table) => [index("gacha_archive_user_idx").on(table.userId)]);

export const gachaDraw = appSchema.table("gacha_draw", {
  uid: text("uid").notNull().references(() => gachaArchive.uid, { onDelete: "cascade" }),
  drawKey: text("draw_key").notNull(),
  record: jsonb("record").$type<import("@riic/arknights-domain/gacha-history").GachaRecord>().notNull(),
  source: text("source").$type<"official" | "browser">().notNull(),
}, (table) => [
  uniqueIndex("gacha_draw_uid_key_idx").on(table.uid, table.drawKey),
  check("gacha_draw_source_check", sql`${table.source} IN ('official', 'browser')`),
]);

export const releaseNote = appSchema.table("release_note", {
  id: text("id").primaryKey(),
  environment: text("environment").$type<ReleaseEnvironment>().notNull(),
  version: text("version").notNull(),
  draft: jsonb("draft").$type<ReleaseDraft>().notNull(),
  published: jsonb("published").$type<ReleaseDraft>(),
  revision: integer("revision").default(1).notNull(),
  firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("release_note_environment_version_uidx").on(table.environment, table.version),
  index("release_note_environment_published_idx").on(table.environment, table.publishedAt),
  check("release_note_environment_check", sql`${table.environment} IN ('production', 'development', 'local')`),
  check("release_note_revision_check", sql`${table.revision} > 0`),
  check("release_note_version_check", sql`${table.draft}->>'version' = ${table.version} AND (${table.published} IS NULL OR ${table.published}->>'version' = ${table.version})`),
]);

/**
 * 人工维护的基建技能补充说明。
 *
 * 这里只保存稳定 ID 与人工文本，不属于 arkntools 自动生成资源，所以上游资源同步不会覆盖它。
 */
export const skillAnnotation = appSchema.table("skill_annotation", {
  id: text("id").primaryKey(),
  operatorId: text("operator_id").notNull(),
  skillId: text("skill_id").notNull(),
  note: text("note").notNull(),
  createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("skill_annotation_operator_skill_uidx").on(table.operatorId, table.skillId),
  index("skill_annotation_updated_at_idx").on(table.updatedAt),
]);

export const planRun = appSchema.table("plan_run", {
  diagnosticId: text("diagnostic_id").primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  dataOwnerTag: text("data_owner_tag"),
  sourceType: text("source_type").notNull(),
  status: text("status").notNull(),
  layoutTemplate: text("layout_template").notNull(),
  roomCount: integer("room_count").notNull(),
  operatorCount: integer("operator_count").notNull(),
  rotation: text("rotation").notNull(),
  fiammettaEnable: boolean("fiammetta_enable").notNull(),
  durationMs: integer("duration_ms"),
  executionSource: text("execution_source"),
  solverDurationMs: integer("solver_duration_ms"),
  workerDurationMs: integer("worker_duration_ms"),
  errorCode: text("error_code"),
  solverExecutableSha256: text("solver_executable_sha256"),
  protocolVersion: integer("protocol_version"),
  planSchemaVersion: integer("plan_schema_version"),
  artifactKey: text("artifact_key"),
  artifactBytes: bigint("artifact_bytes", { mode: "number" }),
  artifactSha256: text("artifact_sha256"),
  artifactStatus: text("artifact_status"),
  artifactFinalizedAt: timestamp("artifact_finalized_at", { withTimezone: true }),
  calculationContext: jsonb("calculation_context"),
  publicResultSha256: text("public_result_sha256"),
  operboxContentHmac: text("operbox_content_hmac"),
  operboxHmacKeyVersion: text("operbox_hmac_key_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("plan_run_created_at_idx").on(table.createdAt),
  index("plan_run_status_created_at_idx").on(table.status, table.createdAt),
  index("plan_run_error_code_created_at_idx").on(table.errorCode, table.createdAt),
  index("plan_run_solver_created_at_idx").on(table.solverExecutableSha256, table.createdAt),
  index("plan_run_user_created_at_idx").on(table.userId, table.createdAt),
]);

export const planTask = appSchema.table("plan_task", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountClass: text("account_class").notNull(),
  requestIpHmac: text("request_ip_hmac").notNull(),
  status: text("status").notNull(),
  encryptedPayload: text("encrypted_payload"),
  payloadIv: text("payload_iv"),
  wrappedDataKey: text("wrapped_data_key"),
  wrappedKeyIv: text("wrapped_key_iv"),
  keyVersion: text("key_version"),
  schemaVersion: integer("schema_version"),
  result: jsonb("result"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  solverStartedAt: timestamp("solver_started_at", { withTimezone: true }),
  solverFinishedAt: timestamp("solver_finished_at", { withTimezone: true }),
  executionSource: text("execution_source"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("plan_task_claim_idx").on(table.status, table.createdAt),
  index("plan_task_active_expires_idx").on(table.status, table.expiresAt).concurrently(),
  index("plan_task_account_active_idx").on(table.accountClass, table.status, table.expiresAt).concurrently(),
  index("plan_task_ip_active_idx").on(table.requestIpHmac, table.status, table.expiresAt).concurrently(),
  index("plan_task_expires_at_idx").on(table.expiresAt),
  index("plan_task_ip_created_at_idx").on(table.requestIpHmac, table.createdAt),
  index("plan_task_user_created_at_idx").on(table.userId, table.createdAt),
  uniqueIndex("plan_task_one_active_per_user_idx").on(table.userId)
    .where(sql`${table.status} in ('buffered', 'pending', 'running')`),
  check("plan_task_status_check", sql`${table.status} in ('buffered', 'pending', 'running', 'done', 'failed', 'cancelled')`),
  check("plan_task_account_class_check", sql`${table.accountClass} in ('new', 'established')`),
  check("plan_task_payload_lifecycle_check", sql`(
    (${table.status} in ('buffered', 'pending', 'running')
      and ${table.encryptedPayload} is not null
      and ${table.payloadIv} is not null
      and ${table.wrappedDataKey} is not null
      and ${table.wrappedKeyIv} is not null
      and ${table.keyVersion} is not null
      and ${table.schemaVersion} is not null)
    or
    (${table.status} in ('done', 'failed', 'cancelled')
      and ${table.encryptedPayload} is null
      and ${table.payloadIv} is null
      and ${table.wrappedDataKey} is null
      and ${table.wrappedKeyIv} is null
      and ${table.keyVersion} is null
      and ${table.schemaVersion} is null)
  )`),
]);

export const planWorkerHeartbeat = appSchema.table("plan_worker_heartbeat", {
  id: text("id").primaryKey(),
  releaseSha: text("release_sha").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull(),
  solverLanes: integer("solver_lanes").notNull().default(4),
  pipelineDepth: integer("pipeline_depth").notNull().default(2),
  inFlight: integer("in_flight").notNull().default(0),
  serviceTimeEwmaMs: integer("service_time_ewma_ms"),
});

export const feedback = appSchema.table("feedback", {
  id: text("id").primaryKey(),
  diagnosticId: text("diagnostic_id").notNull(),
  planRunDiagnosticId: text("plan_run_diagnostic_id").references(() => planRun.diagnosticId, { onDelete: "set null" }),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  room: jsonb("room"),
  note: text("note").notNull(),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  status: text("status").default("unreviewed").notNull(),
  adminNote: text("admin_note"),
  artifactKey: text("artifact_key"),
  artifactBytes: bigint("artifact_bytes", { mode: "number" }),
  artifactSha256: text("artifact_sha256"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("feedback_created_at_idx").on(table.createdAt),
  index("feedback_status_created_at_idx").on(table.status, table.createdAt),
  index("feedback_diagnostic_id_idx").on(table.diagnosticId),
  index("feedback_user_created_at_idx").on(table.userId, table.createdAt),
]);

export const feedbackEvent = appSchema.table("feedback_event", {
  id: text("id").primaryKey(),
  feedbackId: text("feedback_id").notNull().references(() => feedback.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("feedback_event_feedback_created_at_idx").on(table.feedbackId, table.createdAt)]);

export const qualityDraft = appSchema.table("quality_draft", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  revision: integer("revision").notNull().default(1),
  inputHash: text("input_hash").notNull(),
  sources: jsonb("sources").notNull().$type<import("@riic/arknights-domain/quality").QualitySource[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const wish = appSchema.table("wish", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  imageUrls: jsonb("image_urls").$type<string[]>().default([]).notNull(),
  status: text("status").default("pending").notNull(),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("wish_status_created_at_idx").on(table.status, table.createdAt), index("wish_user_created_at_idx").on(table.userId, table.createdAt)]);
export const qualityBundle = appSchema.table("quality_bundle", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  executableSha256: text("executable_sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const siteSetting = appSchema.table("site_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const qualityBatch = appSchema.table("quality_batch", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull().default("queued"),
  bundleIds: jsonb("bundle_ids").notNull().$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("quality_batch_status_idx").on(table.status, table.createdAt)]);
export const qualityCase = appSchema.table("quality_case", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => qualityBatch.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull().default("queued"),
  sources: jsonb("sources").notNull().$type<import("@riic/arknights-domain/quality").QualitySource[]>(),
}, (table) => [index("quality_case_batch_idx").on(table.batchId)]);
export const qualityAttempt = appSchema.table("quality_attempt", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => qualityCase.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  summary: jsonb("summary"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [index("quality_attempt_case_idx").on(table.caseId)]);
export const feedbackLink = appSchema.table("feedback_link", {
  feedbackId: text("feedback_id").primaryKey().references(() => feedback.id, { onDelete: "cascade" }),
  masterId: text("master_id").notNull().references(() => feedback.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("feedback_link_master_idx").on(table.masterId)]);

export const policyConsent = appSchema.table("policy_consent", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  termsVersion: text("terms_version").notNull(),
  privacyVersion: text("privacy_version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("policy_consent_user_versions_uidx").on(table.userId, table.termsVersion, table.privacyVersion),
  index("policy_consent_user_accepted_at_idx").on(table.userId, table.acceptedAt),
]);

export const operboxSnapshot = appSchema.table("operbox_snapshot", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  contentHmac: text("content_hmac").notNull(),
  encryptedPayload: text("encrypted_payload").notNull(),
  payloadIv: text("payload_iv").notNull(),
  wrappedDataKey: text("wrapped_data_key").notNull(),
  wrappedKeyIv: text("wrapped_key_iv").notNull(),
  keyVersion: text("key_version").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("operbox_snapshot_user_created_at_idx").on(table.userId, table.createdAt),
  index("operbox_snapshot_expires_at_idx").on(table.expiresAt),
  uniqueIndex("operbox_snapshot_user_content_hmac_uidx").on(table.userId, table.contentHmac),
]);

export const savedPlan = appSchema.table("saved_plan", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  diagnosticId: text("diagnostic_id").notNull(),
  title: text("title").notNull(),
  publicResult: jsonb("public_result").notNull(),
  calculationContext: jsonb("calculation_context"),
  operboxContentHmac: text("operbox_content_hmac"),
  operboxHmacKeyVersion: text("operbox_hmac_key_version"),
  pinned: boolean("pinned").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  index("saved_plan_user_created_at_idx").on(table.userId, table.createdAt),
  index("saved_plan_user_pinned_created_at_idx").on(table.userId, table.pinned, table.createdAt),
  uniqueIndex("saved_plan_user_diagnostic_id_uidx").on(table.userId, table.diagnosticId),
]);

export const userWorkspace = appSchema.table("user_workspace", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  currentRevision: bigint("current_revision", { mode: "number" }).default(1).notNull(),
  state: jsonb("state").notNull(),
  operboxSnapshotId: text("operbox_snapshot_id").references(() => operboxSnapshot.id, { onDelete: "set null" }),
  currentSavedPlanId: text("current_saved_plan_id").references(() => savedPlan.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("user_workspace_updated_at_idx").on(table.updatedAt)]);

export const workspaceRevision = appSchema.table("workspace_revision", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  revision: bigint("revision", { mode: "number" }).notNull(),
  state: jsonb("state").notNull(),
  operboxSnapshotId: text("operbox_snapshot_id").references(() => operboxSnapshot.id, { onDelete: "set null" }),
  savedPlanId: text("saved_plan_id").references(() => savedPlan.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("workspace_revision_user_revision_uidx").on(table.userId, table.revision),
  index("workspace_revision_user_created_at_idx").on(table.userId, table.createdAt),
  index("workspace_revision_expires_at_idx").on(table.expiresAt),
]);

export const planCache = appSchema.table("plan_cache", {
  keyHmac: text("key_hmac").primaryKey(),
  solverExecutableSha256: text("solver_executable_sha256").notNull(),
  protocolVersion: integer("protocol_version").notNull(),
  planSchemaVersion: integer("plan_schema_version").notNull(),
  publicResult: jsonb("public_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  hitCount: bigint("hit_count", { mode: "number" }).default(0).notNull(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
}, (table) => [
  index("plan_cache_expires_at_idx").on(table.expiresAt),
  index("plan_cache_lease_expires_at_idx").on(table.leaseExpiresAt),
]);

export const planCacheReference = appSchema.table("plan_cache_reference", {
  id: text("id").primaryKey(),
  cacheKeyHmac: text("cache_key_hmac").notNull().references(() => planCache.keyHmac, { onDelete: "cascade" }),
  diagnosticId: text("diagnostic_id").notNull().references(() => planRun.diagnosticId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("plan_cache_reference_cache_run_uidx").on(table.cacheKeyHmac, table.diagnosticId),
  index("plan_cache_reference_user_idx").on(table.userId),
  index("plan_cache_reference_diagnostic_idx").on(table.diagnosticId),
]);

/** 前端埋点事件（性能/行为/错误），30 天 TTL 明细落库；字段与事件名白名单在路由层校验。 */
export const telemetryEvent = appSchema.table("telemetry_event", {
  id: text("id").primaryKey(),
  /** 浏览器会话标识（前端生成，游客也有）。 */
  sessionId: text("session_id").notNull(),
  /** 登录网站用户；游客为 null。 */
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  /** 森空岛来源账号的 HMAC（服务端从会话取，可空）。 */
  dataOwnerTag: text("data_owner_tag"),
  /** performance | interaction | navigation | error */
  type: text("type").notNull(),
  /** 事件名（白名单枚举）。 */
  name: text("name").notNull(),
  durationMs: integer("duration_ms"),
  value: integer("value"),
  /** 当前页面路由。 */
  page: text("page"),
  /** 附加字段（白名单键）。 */
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("telemetry_event_created_at_idx").on(table.createdAt),
  index("telemetry_event_expires_at_idx").on(table.expiresAt),
  index("telemetry_event_type_created_at_idx").on(table.type, table.createdAt),
  index("telemetry_event_name_created_at_idx").on(table.name, table.createdAt),
  index("telemetry_event_user_created_at_idx").on(table.userId, table.createdAt),
  index("telemetry_event_owner_created_at_idx").on(table.dataOwnerTag, table.createdAt),
]);

/** Agent 生成的排班方案产物（探索原型）：供 /plan/<id> 只读结果页验收。 */
export const agentPlanArtifact = appSchema.table("agent_plan_artifact", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  /** projectPlanResult 的输出（排班、产出、练卡建议摘要）。 */
  plan: jsonb("plan").notNull(),
  /** 生成参数摘要：layoutPreset / boxSource / factoryRecipes / operatorCount。 */
  meta: jsonb("meta").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("agent_plan_artifact_user_created_at_idx").on(table.userId, table.createdAt),
  index("agent_plan_artifact_expires_at_idx").on(table.expiresAt),
]);

/** Agent 计费原型：余额按永久积分与月卡积分分桶，账本记录每次变动。 */
export const billingWallet = appSchema.table("billing_wallet", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  paidPoints: numeric("paid_points", { precision: 15, scale: 4, mode: "number" }).notNull().default(0),
  monthlyPoints: numeric("monthly_points", { precision: 15, scale: 4, mode: "number" }).notNull().default(0),
  heldPaidPoints: numeric("held_paid_points", { precision: 15, scale: 4, mode: "number" }).notNull().default(0),
  heldMonthlyPoints: numeric("held_monthly_points", { precision: 15, scale: 4, mode: "number" }).notNull().default(0),
  monthlyExpiresAt: timestamp("monthly_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [check("billing_wallet_reservations_valid", sql`${table.heldPaidPoints} >= 0 and ${table.heldMonthlyPoints} >= 0 and ${table.paidPoints} >= ${table.heldPaidPoints} and ${table.monthlyPoints} >= ${table.heldMonthlyPoints}`)]);

/** Versioned application policy; gateway settings are a derived, private copy. */
export const agentPolicyVersion = appSchema.table("agent_policy_version", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  payload: jsonb("payload").notNull(),
  authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, table => [uniqueIndex("agent_policy_version_kind_version").on(table.kind, table.version),
  uniqueIndex("agent_policy_one_active").on(table.kind).where(sql`${table.status} = 'active'`),
  check("agent_policy_kind", sql`${table.kind} in ('rates','filter','resources')`),
  check("agent_policy_status", sql`${table.status} in ('draft','active','retired')`)]);

export const agentRun = appSchema.table("agent_run", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  conversationId: text("conversation_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  state: text("state").notNull().default("running"),
  settlement: text("settlement").notNull().default("reserved"),
  policy: jsonb("policy").notNull(),
  rateVersion: text("rate_version").notNull(),
  filterVersion: text("filter_version").notNull(),
  heldPaid: numeric("held_paid", { precision: 15, scale: 4, mode: "number" }).notNull().default(0),
  heldMonthly: numeric("held_monthly", { precision: 15, scale: 4, mode: "number" }).notNull().default(0),
  monthlyExpiresAt: timestamp("monthly_expires_at", { withTimezone: true }),
  chargedPoints: numeric("charged_points", { precision: 15, scale: 4, mode: "number" }).notNull().default(0),
  toolPoints: integer("tool_points").notNull().default(0),
  delivered: boolean("delivered").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, table => [uniqueIndex("agent_run_owner_idempotency").on(table.userId, table.idempotencyKey),
  index("agent_run_owner_created").on(table.userId, table.createdAt), index("agent_run_settlement_heartbeat").on(table.settlement, table.heartbeatAt),
  check("agent_run_nonnegative", sql`${table.heldPaid} >= 0 and ${table.heldMonthly} >= 0 and ${table.chargedPoints} >= 0 and ${table.toolPoints} >= 0`)]);

export const agentModelCall = appSchema.table("agent_model_call", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRun.id),
  step: integer("step").notNull(),
  provider: text("provider"), model: text("model"), gatewayRequestId: text("gateway_request_id"),
  status: text("status").notNull().default("started"),
  inputTokens: integer("input_tokens"), outputTokens: integer("output_tokens"), cachedInputTokens: integer("cached_input_tokens"),
  upstreamRmb: numeric("upstream_rmb", { precision: 24, scale: 12 }),
  chargedRmb: numeric("charged_rmb", { precision: 24, scale: 12 }),
  budgetPoints: numeric("budget_points", { precision: 15, scale: 4, mode: "number" }).notNull(),
  rateVersion: text("rate_version").notNull(),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, table => [uniqueIndex("agent_model_call_run_step").on(table.runId, table.step), index("agent_model_call_created").on(table.createdAt),
  index("agent_model_call_model_created").on(table.model, table.createdAt), index("agent_model_call_gateway_request").on(table.gatewayRequestId)]);

export const agentToolCharge = appSchema.table("agent_tool_charge", {
  id: text("id").primaryKey(), runId: text("run_id").notNull().references(() => agentRun.id),
  toolCallId: text("tool_call_id").notNull(), name: text("name").notNull(), status: text("status").notNull(),
  points: integer("points").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("agent_tool_charge_run_call").on(table.runId, table.toolCallId)]);

export const billingReview = appSchema.table("billing_review", {
  id: text("id").primaryKey(), runId: text("run_id").references(() => agentRun.id),
  kind: text("kind").notNull(), status: text("status").notNull().default("open"),
  evidence: jsonb("evidence").notNull(), resolution: text("resolution"),
  actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => [index("billing_review_status_created").on(table.status, table.createdAt)]);

export const agentFilterEvent = appSchema.table("agent_filter_event", {
  id: text("id").primaryKey(), requestId: text("request_id").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  version: text("version").notNull(), stage: text("stage").notNull(), ruleIds: jsonb("rule_ids").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("agent_filter_event_created").on(table.createdAt)]);

export const billingAdminAudit = appSchema.table("billing_admin_audit", {
  id: text("id").primaryKey(), actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
  action: text("action").notNull(), target: text("target").notNull(), reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("billing_admin_audit_idempotency").on(table.idempotencyKey), index("billing_admin_audit_created").on(table.createdAt)]);

export const agentGatewayStatus = appSchema.table("agent_gateway_status", {
  id: text("id").primaryKey(), filterVersion: text("filter_version"), status: text("status").notNull(),
  details: jsonb("details").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentGatewayUsage = appSchema.table("agent_gateway_usage", {
  id: text("id").primaryKey(), sessionId: text("session_id"), provider: text("provider"), model: text("model"),
  callId: text("call_id").references(() => agentModelCall.id),
  details: jsonb("details").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("agent_gateway_usage_call").on(table.callId), index("agent_gateway_usage_created").on(table.createdAt)]);

export const billingOrder = appSchema.table("billing_order", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  provider: text("provider").notNull().default("afdian"),
  status: text("status").notNull().default("pending"),
  amountFen: integer("amount_fen").notNull(),
  points: integer("points").notNull(),
  customOrderId: text("custom_order_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  providerOrderId: text("provider_order_id"),
  paymentUrl: text("payment_url"),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("billing_order_custom_order_uidx").on(table.customOrderId),
  uniqueIndex("billing_order_idempotency_uidx").on(table.userId, table.idempotencyKey),
  index("billing_order_user_created_idx").on(table.userId, table.createdAt),
  index("billing_order_status_created_idx").on(table.status, table.createdAt),
]);

export const billingLedger = appSchema.table("billing_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  pointsDelta: numeric("points_delta", { precision: 15, scale: 4, mode: "number" }).notNull(),
  paidPointsAfter: numeric("paid_points_after", { precision: 15, scale: 4, mode: "number" }).notNull(),
  monthlyPointsAfter: numeric("monthly_points_after", { precision: 15, scale: 4, mode: "number" }).notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("billing_ledger_idempotency_uidx").on(table.idempotencyKey),
  index("billing_ledger_user_created_idx").on(table.userId, table.createdAt),
]);

export const agentUsage = appSchema.table("agent_usage", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull(),
  points: numeric("points", { precision: 15, scale: 4, mode: "number" }).notNull().default(0),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cachedInputTokens: integer("cached_input_tokens"),
  upstreamCostRmbFen: numeric("upstream_cost_rmb_fen", { precision: 24, scale: 10, mode: "number" }),
  chargedCostRmbFen: numeric("charged_cost_rmb_fen", { precision: 24, scale: 10, mode: "number" }),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("agent_usage_idempotency_uidx").on(table.idempotencyKey),
  index("agent_usage_user_created_idx").on(table.userId, table.createdAt),
]);

/** 一次性赠送 CDK：只存散列，明文仅在发放响应中显示一次。 */
export const billingCdk = appSchema.table("billing_cdk", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  issuerUserId: text("issuer_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  redeemerUserId: text("redeemer_user_id").references(() => user.id, { onDelete: "set null" }),
  points: integer("points").notNull(),
  status: text("status").notNull().default("issued"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  batchId: text("batch_id"),
  batchLabel: text("batch_label"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
  revokeReason: text("revoke_reason"),
}, (table) => [
  uniqueIndex("billing_cdk_code_hash_uidx").on(table.codeHash),
  index("billing_cdk_issuer_created_idx").on(table.issuerUserId, table.createdAt),
  index("billing_cdk_batch_idx").on(table.batchId),
]);
