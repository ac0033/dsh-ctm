/**
 * Surface-edit planning for the Context Transparency Manager.
 *
 * Pure planning layer between a CTM view edit and the session log. DSH's
 * "model-visible ⟺ logged" invariant requires every model-visible change to
 * land as a logged event, and the only sanctioned channel for rewriting
 * visible history is a surface `replace` event (the same mechanism compaction
 * and the tool-result pruner use). This module turns each queued edit into an
 * append plan — event type, event data, SurfaceIntent — which the host applies
 * with `session.append` inside the `agent/pre-step` waterfall. It is kept free
 * of cordis state so it can be unit-tested directly.
 */

/** Source tag for placeholder nodes CTM writes in place of removed segments. */
export const CTM_PLUGIN_SOURCE = { kind: 'plugin', plugin: 'ctm' } as const

/** Minimal structural view of the session pieces planning depends on. */
export interface SessionEventLike {
  seq: number
  type: string
  data: any
}

export interface SessionLike {
  surface: { nodes: readonly number[] }
  eventAt(seq: number): SessionEventLike | undefined
  snapshotEvents(): readonly SessionEventLike[]
}

/** The append call of a live session, structurally typed. */
export interface AppendCapable {
  append(type: string, data: unknown, intent?: unknown): { seq: number }
}

/** Failure codes the host maps to user-facing notice texts. */
export type EditPlanErrorCode =
  | 'target_not_on_surface'
  | 'unbalanced'
  | 'not_tool_result'
  | 'not_user_message'
  | 'empty_range'

export class EditPlanError extends Error {
  constructor(readonly code: EditPlanErrorCode) {
    super(code)
  }
}

/**
 * Tool-call/result pairing balance over the current surface, reimplemented
 * from `@deepseek-ai/dsh-compaction`'s `packages/compaction/compaction/src/
 * tool-pairing.ts` (`toolPairingBalancedBefore/After`) so this plugin keeps
 * zero runtime dependencies. Same definition: assistant tool-call blocks open
 * a call, `tool/result` closes one, and a surface cut is balanced when no
 * unanswered call crosses it — a replacement must not split a call from its
 * result. The upstream incremental cache is dropped: CTM checks one cut per
 * edit, so a plain O(surface) fold is enough.
 */
function eventDelta(event: SessionEventLike | undefined): number {
  if (event === undefined) return 0
  if (event.type === 'assistant/message') {
    const content = event.data?.message?.content
    if (!Array.isArray(content)) return 0
    let calls = 0
    for (const block of content) if (block !== null && block?.type === 'tool-call') calls++
    return calls
  }
  if (event.type === 'tool/result') return -1
  return 0
}

/** A contiguous surface range whose boundary cuts are both tool-pair balanced. */
export interface BalancedRange {
  start: number
  end: number
  /** Every surface seq inside the range, in surface order. */
  seqs: number[]
}

/**
 * Minimal balanced shadow range around one surface node: the smallest
 * contiguous range containing `seq` such that the cut before `start` and the
 * cut after `end` are both tool-pair balanced. For a plain user message (or
 * any node whose own cuts are already balanced) this is the single node
 * itself. For a `tool/result` the range extends left until it absorbs the
 * assistant message carrying the matching tool-call — otherwise shadowing the
 * result alone would leave the model staring at an unanswered call. The two
 * expansions are independent: the prefix depth below an index only depends on
 * the nodes before it, never on how far the other end reaches.
 */
export function minimalBalancedRange(session: SessionLike, seq: number): BalancedRange {
  const nodes = session.surface.nodes
  const idx = nodes.indexOf(seq)
  if (idx === -1) throw new EditPlanError('target_not_on_surface')
  // depth[i] = tool-call depth of the surface prefix nodes[0..i-1].
  const depth: number[] = [0]
  for (let i = 0; i < nodes.length; i++) {
    depth.push(depth[i]! + eventDelta(eventForSeq(session, nodes[i]!)))
  }
  let s = idx
  while (s > 0 && depth[s] !== 0) s--
  if (depth[s] !== 0) throw new EditPlanError('unbalanced')
  let e = idx
  while (e < nodes.length - 1 && depth[e + 1] !== 0) e++
  if (depth[e + 1] !== 0) throw new EditPlanError('unbalanced')
  return { start: nodes[s]!, end: nodes[e]!, seqs: nodes.slice(s, e + 1) }
}

/** Look up one log event by seq (events are append-ordered, so index === seq in the common case). */
function eventForSeq(session: SessionLike, seq: number): SessionEventLike | undefined {
  return session.eventAt(seq)
}

/** Balance of the cut immediately before (`offset 0`) or after (`offset 1`) a current surface seq. */
function cutBalanced(session: SessionLike, seq: number, offset: 0 | 1): boolean {
  let inProgressToolCalls = 0
  for (const s of session.surface.nodes) {
    if (s === seq && offset === 0) return inProgressToolCalls === 0
    inProgressToolCalls += eventDelta(eventForSeq(session, s))
    if (inProgressToolCalls < 0) return false
    if (s === seq) return inProgressToolCalls === 0
  }
  return false
}

export function toolPairingBalancedBefore(session: SessionLike, seq: number): boolean {
  return cutBalanced(session, seq, 0)
}

export function toolPairingBalancedAfter(session: SessionLike, seq: number): boolean {
  return cutBalanced(session, seq, 1)
}

let fallbackId = 0

/** Fresh message id (crypto.randomUUID where available; tests may pass explicit ids instead). */
export function messageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `ctm-msg-${Date.now()}-${fallbackId++}`
}

/** Build the `UserMessage` data of a `user/message` surface event. */
export function buildUserMessageData(text: string, source: unknown, id: string = messageId()): Record<string, unknown> {
  return { id, role: 'user', content: [{ type: 'text', text }], source: source ?? { kind: 'user' } }
}

/** One fully planned `session.append` call: event type, data, and surface intent. */
export interface AppendPlan {
  type: 'user/message' | 'tool/result'
  data: Record<string, unknown>
  intent: {
    surfaceOp: 'append' | { op: 'replace'; startSeq: number; endSeq: number }
    sourceEventSeqs: number[]
  }
}

function requireOnSurface(session: SessionLike, seq: number): void {
  if (!session.surface.nodes.includes(seq)) throw new EditPlanError('target_not_on_surface')
}

function requireBalanced(session: SessionLike, seq: number): void {
  if (!toolPairingBalancedBefore(session, seq) || !toolPairingBalancedAfter(session, seq)) {
    throw new EditPlanError('unbalanced')
  }
}

/**
 * Single-node `user/message` replace: user-input edits, system-injection edits
 * (the original source is preserved so the node keeps its classification), and
 * assistant revisions by role demotion (the model sees the revised text as a
 * user message — assistant/message replacement is rejected by the session
 * invariant because its turn/step no longer matches the open one).
 */
export function planReplaceUserMessage(session: SessionLike, seq: number, text: string, source: unknown): AppendPlan {
  requireOnSurface(session, seq)
  requireBalanced(session, seq)
  return {
    type: 'user/message',
    data: buildUserMessageData(text, source),
    intent: { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] },
  }
}

/**
 * Single-node `tool/result` content rewrite. The session fold's
 * `assertToolResultRewrite` requires every field except the result content to
 * stay deep-equal to the shadowed node, so the plan clones the original event
 * data and swaps only `content`. Pairing is structurally unchanged (a result
 * replaces a result), so no balance check is needed; the session invariant
 * additionally requires the append to happen inside an open turn, which the
 * host guarantees by flushing at `agent/pre-step`.
 */
export function planRewriteToolResult(session: SessionLike, seq: number, text: string): AppendPlan {
  requireOnSurface(session, seq)
  const original = eventForSeq(session, seq)
  if (original?.type !== 'tool/result') throw new EditPlanError('not_tool_result')
  const data = structuredClone(original.data) as Record<string, any>
  const result = data?.message?.content?.[0]
  if (result === undefined || result === null) throw new EditPlanError('not_tool_result')
  result.content = text
  return {
    type: 'tool/result',
    data,
    intent: { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] },
  }
}

/**
 * Delete as "shadow + placeholder": a replace must occupy the shadowed range
 * with a new node, so removal is expressed as replacing the segment with a
 * placeholder `user/message` (the same shape compaction checkpoints use). The
 * shadow range is the minimal balanced range around the target: deleting a
 * tool result absorbs the assistant message carrying its tool-call (and any
 * sibling results between them), so the model never sees a dangling call.
 */
export function planDeleteSegment(session: SessionLike, seq: number, marker: string): AppendPlan {
  const range = minimalBalancedRange(session, seq)
  return {
    type: 'user/message',
    data: buildUserMessageData(marker, CTM_PLUGIN_SOURCE),
    intent: { surfaceOp: { op: 'replace', startSeq: range.start, endSeq: range.end }, sourceEventSeqs: range.seqs },
  }
}

/**
 * Rollback as one contiguous-range replace: everything from `startSeq` to the
 * current surface tail is shadowed by a single placeholder node. When
 * `startSeq` itself already left the surface (a queued edit applied earlier),
 * the range starts at the next surviving node after it.
 */
export function planRollback(session: SessionLike, startSeq: number, marker: string): AppendPlan {
  const nodes = session.surface.nodes
  let startIdx = nodes.indexOf(startSeq)
  if (startIdx === -1) {
    startIdx = nodes.findIndex(s => s >= startSeq)
    if (startIdx === -1) throw new EditPlanError('empty_range')
  }
  const start = nodes[startIdx]!
  const end = nodes[nodes.length - 1]!
  if (nodes.length === 0 || startIdx > nodes.length - 1) throw new EditPlanError('empty_range')
  if (!toolPairingBalancedBefore(session, start) || !toolPairingBalancedAfter(session, end)) {
    throw new EditPlanError('unbalanced')
  }
  return {
    type: 'user/message',
    data: buildUserMessageData(marker, CTM_PLUGIN_SOURCE),
    intent: {
      surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
      sourceEventSeqs: nodes.slice(startIdx),
    },
  }
}

/** One queued edit input; planning happens at flush time against the then-current surface. */
export type QueuedEdit =
  | { kind: 'replace-user'; seq: number; text: string; source: unknown }
  | { kind: 'replace-tool'; seq: number; text: string }
  | { kind: 'delete'; seq: number; marker: string }
  | { kind: 'rollback'; startSeq: number; marker: string }
  | { kind: 'undo'; applied: AppliedEdit }
  | { kind: 'restore'; applied: AppliedEdit }

/** One dispatched operation's worth of queued edits, undone or flushed as a unit. */
export interface EditGroup {
  id: string
  kind: 'replace' | 'delete' | 'rollback' | 'undo'
  /** Whether a flushed group can itself be reversed by a later undo. */
  undoable: boolean
  edits: QueuedEdit[]
  /** View segment ids whose in-memory view mutations this group drives. */
  segmentIds: string[]
}

/** Record of one flushed group: what replaced what, for a later reverse undo. */
export interface AppliedEdit {
  groupId: string
  kind: QueuedEdit['kind']
  replacementSeq: number
  originalSeq: number
  undoable: boolean
  /**
   * Every surface seq the group's replace shadowed (delete: the minimal
   * balanced range; rollback: the whole tail range). Undo reads the shadowed
   * originals back from the immutable log to restore them.
   */
  shadowedSeqs?: number[]
  /** Restore groups only: seqs of the nodes the restore created (first replaced + appended). */
  restoredSeqs?: number[]
  /** Delete/rollback groups only: the placeholder marker text, reused when a restore is itself undone. */
  marker?: string
}

/** Plan one queued edit against the current surface. */
export function planEdit(session: SessionLike, edit: QueuedEdit): AppendPlan {
  switch (edit.kind) {
    case 'replace-user': return planReplaceUserMessage(session, edit.seq, edit.text, edit.source)
    case 'replace-tool': return planRewriteToolResult(session, edit.seq, edit.text)
    case 'delete': return planDeleteSegment(session, edit.seq, edit.marker)
    case 'rollback': return planRollback(session, edit.startSeq, edit.marker)
    case 'undo': return planUndo(session, edit.applied)
    case 'restore':
      // A restore plans one replace plus zero or more appends; applyEditGroup
      // drives it through planRestore, never through this single-plan switch.
      throw new Error('restore edits are planned by planRestore, not planEdit')
  }
}

/** Join the text of message content blocks (restore carries text only). */
function blockText(blocks: unknown): string {
  if (typeof blocks === 'string') return blocks
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks) {
    if (b !== null && typeof b === 'object' && (b as { type?: unknown }).type === 'text') {
      const text = (b as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n')
}

/** Text a shadowed event contributes when restored as a user message (role demotion keeps text only). */
export function restoredEventText(event: SessionEventLike): string {
  const d = (event.data ?? {}) as Record<string, any>
  if (event.type === 'user/message') return blockText(d.content)
  const msg = (d.message ?? d) as Record<string, any>
  if (event.type === 'tool/result') {
    const content = msg.content?.[0]?.content
    return typeof content === 'string' ? content : blockText(content)
  }
  return blockText(msg.content)
}

/** Text used when a shadowed event carries no plain text at all. */
const RESTORED_EMPTY_TEXT = '[CTM] A restored message had no text content.'

/**
 * Undo of a rollback (or of a multi-node/non-user delete): bring the shadowed
 * content back. The log is append-only, so the originals cannot reclaim their
 * roles — every restored message is carried by a fresh `user/message` (the
 * same role demotion as assistant revisions). The first shadowed event
 * replaces the placeholder node in place; the rest append to the surface tail
 * in original order. Restored content is read back from the immutable log at
 * flush time, so the shadowed originals are always available.
 */
export function planRestore(session: SessionLike, applied: AppliedEdit): AppendPlan[] {
  requireOnSurface(session, applied.replacementSeq)
  const shadowed = applied.shadowedSeqs ?? []
  if (shadowed.length === 0) throw new EditPlanError('empty_range')
  return shadowed.map((seq, i) => {
    const original = eventForSeq(session, seq)
    if (original === undefined) throw new EditPlanError('target_not_on_surface')
    const data = buildUserMessageData(restoredEventText(original) || RESTORED_EMPTY_TEXT, { kind: 'user' })
    return i === 0
      ? {
          type: 'user/message' as const,
          data,
          intent: {
            surfaceOp: { op: 'replace' as const, startSeq: applied.replacementSeq, endSeq: applied.replacementSeq },
            sourceEventSeqs: [applied.replacementSeq, seq],
          },
        }
      : {
          type: 'user/message' as const,
          data,
          intent: { surfaceOp: 'append' as const, sourceEventSeqs: [seq] },
        }
  })
}

/**
 * Reverse of one already-logged edit: replace the edit's replacement node with
 * the original content (read back from the immutable log — the shadowed event
 * is still there, only invisible to the model). Tool results restore through
 * another content rewrite; user messages restore as a fresh `user/message`
 * with the original blocks. Assistant demotions and rollbacks are marked
 * non-undoable at enqueue time and never reach this planner.
 */
export function planUndo(session: SessionLike, applied: AppliedEdit): AppendPlan {
  requireOnSurface(session, applied.replacementSeq)
  if (applied.kind === 'restore') {
    // Undo of a restore re-shadows the restored run (a rollback placeholder
    // again). This is only expressible while the restored run still IS the
    // surface tail: a later append sitting inside the run would be swallowed
    // by the range replace, so the undo refuses instead.
    const restored = applied.restoredSeqs ?? [applied.replacementSeq]
    const nodes = session.surface.nodes
    const startIdx = nodes.indexOf(applied.replacementSeq)
    const tail = nodes.slice(startIdx)
    if (tail.length !== restored.length || !tail.every((s, i) => s === restored[i])) {
      throw new EditPlanError('target_not_on_surface')
    }
    return {
      type: 'user/message',
      data: buildUserMessageData(applied.marker ?? '[CTM] The conversation was rolled back by the user.', CTM_PLUGIN_SOURCE),
      intent: {
        surfaceOp: { op: 'replace', startSeq: restored[0]!, endSeq: restored[restored.length - 1]! },
        sourceEventSeqs: [...restored],
      },
    }
  }
  const original = eventForSeq(session, applied.originalSeq)
  if (original === undefined) throw new EditPlanError('target_not_on_surface')
  if (applied.kind === 'replace-tool') {
    const current = eventForSeq(session, applied.replacementSeq)
    if (current?.type !== 'tool/result') throw new EditPlanError('not_tool_result')
    const data = structuredClone(current.data) as Record<string, any>
    data.message.content[0].content = original.data?.message?.content?.[0]?.content
    return {
      type: 'tool/result',
      data,
      intent: {
        surfaceOp: { op: 'replace', startSeq: applied.replacementSeq, endSeq: applied.replacementSeq },
        sourceEventSeqs: [applied.replacementSeq],
      },
    }
  }
  if (original.type !== 'user/message') throw new EditPlanError('not_user_message')
  requireBalanced(session, applied.replacementSeq)
  return {
    type: 'user/message',
    data: { ...structuredClone(original.data), id: messageId() },
    intent: {
      surfaceOp: { op: 'replace', startSeq: applied.replacementSeq, endSeq: applied.replacementSeq },
      sourceEventSeqs: [applied.replacementSeq],
    },
  }
}

/**
 * Flush one group: plan every edit against the current surface and append it.
 * Synchronous on purpose — the window between planning and appending never
 * yields, so no concurrent writer can invalidate the plan in between.
 */
export function applyEditGroup(session: SessionLike & AppendCapable, group: EditGroup): AppliedEdit | null {
  let replacementSeq = -1
  let originalSeq = -1
  let kind: QueuedEdit['kind'] | null = null
  let shadowedSeqs: number[] | undefined
  let restoredSeqs: number[] | undefined
  let marker: string | undefined
  for (const edit of group.edits) {
    if (edit.kind === 'restore') {
      const seqs: number[] = []
      for (const plan of planRestore(session, edit.applied)) {
        seqs.push(session.append(plan.type, plan.data, plan.intent).seq)
      }
      replacementSeq = seqs[0]!
      restoredSeqs = seqs
      if (originalSeq === -1) originalSeq = edit.applied.originalSeq
      marker = edit.applied.marker
      kind = 'restore'
      continue
    }
    const plan = planEdit(session, edit)
    const appended = session.append(plan.type, plan.data, plan.intent)
    replacementSeq = appended.seq
    if (edit.kind === 'delete' || edit.kind === 'rollback') {
      // The replace intent cites exactly the shadowed surface range; undo
      // needs it to restore the shadowed originals from the log.
      shadowedSeqs = [...plan.intent.sourceEventSeqs]
      marker = edit.marker
    }
    if (originalSeq === -1) {
      originalSeq = edit.kind === 'undo' ? edit.applied.originalSeq : edit.kind === 'rollback' ? edit.startSeq : edit.seq
    }
    kind = edit.kind
  }
  if (kind === null) return null
  return {
    groupId: group.id, kind, replacementSeq, originalSeq, undoable: group.undoable,
    ...(shadowedSeqs !== undefined ? { shadowedSeqs } : {}),
    ...(restoredSeqs !== undefined ? { restoredSeqs } : {}),
    ...(marker !== undefined ? { marker } : {}),
  }
}
