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
})
export type CtmSegment = z.infer<typeof ctmSegmentSchema>

export const ctmNoticeSchema = z.object({
  kind: z.enum(['ok', 'warn', 'error']),
  text: z.string(),
})
export type CtmNotice = z.infer<typeof ctmNoticeSchema>

export const ctmSummarySchema = z.object({
  inputTokens: z.number().nullable(),
  cachedTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  reasoningTokens: z.number().nullable(),
  inputTokensActual: z.boolean(),
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
