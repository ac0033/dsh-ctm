/**
 * Shared wire contract for the Context Transparency Manager.
 * Both the host (request validation) and the client (response validation) import
 * this one module, so the boundary is a single source of truth: TypeScript types
 * are derived from the Zod schemas, and runtime validation guards cross-version
 * compatibility for an independently-updated community plugin.
 */
import { z } from 'zod'

export const ctmRoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])
export type CtmRole = z.infer<typeof ctmRoleSchema>

export const ctmSourceSchema = z.enum([
  'user_input', 'model_output', 'tool_call', 'system_inject', 'summary_compress',
])
export type CtmSource = z.infer<typeof ctmSourceSchema>

export const ctmCacheSchema = z.enum(['hit', 'miss', 'partial', 'unknown'])
export type CtmCache = z.infer<typeof ctmCacheSchema>

export const ctmEffectivenessSchema = z.enum(['effective', 'redundant', 'stale', 'injected'])
export type CtmEffectiveness = z.infer<typeof ctmEffectivenessSchema>

export const ctmToolCallSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  arguments: z.string().optional(),
})
export type CtmToolCall = z.infer<typeof ctmToolCallSchema>

/**
 * Provider-reported usage of ONE LLM request, attached to the assistant
 * segment that request produced (from `assistant/message`'s `data.usage`).
 * The buckets are mutually exclusive: `input` is only the cache-MISS part of
 * the prompt, `cacheRead` the hit part, `cacheWrite` the cache-write part
 * (DeepSeek never reports it); `output` already contains `reasoning` — a
 * subset billed as output, never an extra bucket.
 */
export const ctmUsageSchema = z.object({
  input: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number().optional(),
  output: z.number(),
  reasoning: z.number().optional(),
})
export type CtmUsage = z.infer<typeof ctmUsageSchema>

export const ctmSegmentSchema = z.object({
  id: z.string(),
  seq: z.number(),
  messageId: z.string().nullable(),
  turn_index: z.number(),
  role: ctmRoleSchema,
  source: ctmSourceSchema,
  sourceKind: z.string().nullable(),
  content: z.string(),
  reasoning: z.string(),
  text: z.string(),
  toolCallId: z.string().nullable(),
  /** Heuristic estimate (tokenMeter / local density guess) — never provider-measured. */
  token_count: z.number(),
  cache_status: ctmCacheSchema,
  effectiveness: ctmEffectivenessSchema,
  reason: z.string(),
  strongStale: z.boolean(),
  created_at: z.number(),
  parent_id: z.string().nullable(),
  tags: z.array(z.string()),
  protected: z.boolean(),
  edited: z.boolean(),
  deleted: z.boolean(),
  rolledBack: z.boolean(),
  /** Queued for the next agent/pre-step but not yet logged to the surface. */
  pending: z.boolean().optional(),
  turn: z.number().nullable(),
  step: z.number().nullable(),
  toolCalls: z.array(ctmToolCallSchema),
  blockTypes: z.array(z.string()),
  /** Provider-measured usage of the request that produced this segment; assistant segments only. */
  usage: ctmUsageSchema.optional(),
})
export type CtmSegment = z.infer<typeof ctmSegmentSchema>

/**
 * Structured notice: `code` is a stable machine key the client maps to a
 * localized template, `params` fills the template's `{placeholder}` slots.
 * Replaces the old underscore-encoded `text` ("replaced_3"), which forced the
 * client to reverse-parse host strings with regexes.
 */
export const ctmNoticeSchema = z.object({
  kind: z.enum(['ok', 'warn', 'error']),
  code: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})
export type CtmNotice = z.infer<typeof ctmNoticeSchema>

/**
 * Session-level usage totals in MECE buckets: `uncachedInput` + `cacheRead`
 * + `cacheWrite` is the whole billed prompt side; `output` already contains
 * `reasoning`. Totals accumulate over the COMPLETE session log (requests
 * later shadowed by compaction still count), never over the visible surface.
 */
export const ctmUsageTotalsSchema = z.object({
  uncachedInput: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  /** Summed reasoning output; only the event fold can see it (the host projection has no reasoning bucket). */
  reasoning: z.number().optional(),
})
export type CtmUsageTotals = z.infer<typeof ctmUsageTotalsSchema>

export const ctmSummarySchema = z.object({
  /** Whole-session cumulative totals; null when no request ever reported usage. */
  total: ctmUsageTotalsSchema.nullable(),
  /** The most recent request's usage in the same buckets; null until any usage lands in the log. */
  lastRequest: ctmUsageTotalsSchema.nullable(),
  /**
   * Where `total` came from: the host's `tokenUsage` session projection
   * (incremental, cheap) or a full-log event fold (fallback when the
   * projection registry or the live session is unavailable).
   */
  usageSource: z.enum(['projection', 'events', 'none']),
  /**
   * Context occupancy from the host's `contextPressure` projection: the
   * estimated prompt size of the NEXT request against the newest known route
   * capacity. Null when the projection is unreadable or either value is
   * unknown; absent on older hosts.
   */
  pressure: z.object({ tokens: z.number(), contextWindow: z.number() }).nullable().optional(),
  segmentCount: z.number(),
  activeCount: z.number(),
  rolledBackCount: z.number(),
  model: z.object({ provider: z.string(), model: z.string() }).nullable(),
})
export type CtmSummary = z.infer<typeof ctmSummarySchema>

export const ctmSnapshotMetaSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  label: z.string(),
  segmentCount: z.number(),
})
export type CtmSnapshotMeta = z.infer<typeof ctmSnapshotMetaSchema>

export const ctmStateSchema = z.object({
  sessionId: z.string(),
  version: z.number(),
  head: z.string(),
  capturedThroughSeq: z.number().nullable(),
  realtime: z.boolean(),
  segments: z.array(ctmSegmentSchema),
  summary: ctmSummarySchema,
  snapshots: z.array(ctmSnapshotMetaSchema),
  trash: z.array(ctmSegmentSchema),
  notice: ctmNoticeSchema.nullable(),
  /** Legacy realtime-interceptor failure (kept for wire compatibility; always unset on hosts that log edits). */
  interceptError: z.string().nullable().optional(),
  /** Last queued-edit flush failure at agent/pre-step, surfaced so a dropped edit is visible. */
  applyError: z.string().nullable().optional(),
})
export type CtmState = z.infer<typeof ctmStateSchema>

/** One host operation request. `op` discriminates the argument set. */
export const ctmRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('getState'), sessionId: z.string() }),
  z.object({ op: z.literal('replace'), sessionId: z.string(), segmentId: z.string(), content: z.string() }),
  z.object({ op: z.literal('delete'), sessionId: z.string(), segmentId: z.string() }),
  z.object({ op: z.literal('rollback'), sessionId: z.string(), turnIndex: z.number().int().nonnegative() }),
  z.object({ op: z.literal('restore'), sessionId: z.string(), snapshotId: z.string() }),
  z.object({ op: z.literal('reset'), sessionId: z.string() }),
  z.object({ op: z.literal('undo'), sessionId: z.string() }),
  z.object({ op: z.literal('override'), sessionId: z.string(), segmentId: z.string(), value: z.string().nullable() }),
  z.object({ op: z.literal('setRealtime'), sessionId: z.string(), enabled: z.boolean() }),
])
export type CtmRequest = z.infer<typeof ctmRequestSchema>

/** Host response envelope over the wire. */
export const ctmResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), state: ctmStateSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
export type CtmResponse = z.infer<typeof ctmResponseSchema>
