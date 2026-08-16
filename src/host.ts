/**
 * Context Transparency Manager — host half.
 *
 * Self-contained dsh bundle plugin: a single `POST /ctm` JSON route (registered
 * through the host `webServer`) plus two waterfall listeners. The route reads
 * the live model surface (`sessionQuery.readSurface`) plus the assembled
 * system prompt (`session.requestHeader()`, with a `readSession()` fallback
 * for historical sessions), prices it with `tokenMeter`, and keeps a
 * per-session editable store.
 *
 * Real edits never rewrite an in-flight request: they are queued per session
 * and logged as surface `replace` events inside the `agent/pre-step`
 * waterfall (the same timing automatic compaction uses), which satisfies
 * DSH's "model-visible ⟺ logged" invariant — replay, fork, and token
 * accounting then derive the edited history automatically. System-prompt
 * edits ride the `system-prompt/assemble` waterfall as a section override.
 * Requests are validated against the shared contract; every response is a
 * full `CtmState`. No Typert / @Remote coupling.
 */
import {
  ctmRequestSchema,
  type CtmEffectiveness,
  type CtmNotice,
  type CtmRequest,
  type CtmSegment,
  type CtmState,
} from './contract'
import { BIGRAM_CACHE_CAP, createBigramCache, jaccardSimilarity } from './bigrams'
import {
  EditPlanError,
  applyEditGroup,
  planEdit,
  planUndo,
  type AppendCapable,
  type AppliedEdit,
  type EditGroup,
  type EditPlanErrorCode,
  type QueuedEdit,
  type SessionLike,
} from './surface-edits'

export const name = 'ctm'
export const inject = ['sessionQuery', 'sessions', 'tokenMeter']

// ---------------------------------------------------------------------------
// Tunables. These knobs are the plugin's deliberate tuning points; they are
// plain constants on purpose (no cordis config wiring) — adjust here, rebuild.
// ---------------------------------------------------------------------------
/** Characters of a tool result kept in a segment before "[result truncated]". */
const TOOL_RESULT_PREVIEW = 2000
/** Characters of any other segment's content kept before "[content truncated]". */
const CONTENT_CAP = 40000
/** LRU bounds for per-session memory: stores, snapshots per session, trash entries per session. */
const MAX_SESSION_STORES = 50
const MAX_SNAPSHOTS_PER_SESSION = 20
const MAX_TRASH_PER_SESSION = 50
/** Effectiveness engine: 2-gram Jaccard similarity above this marks an old tool result redundant. */
const REDUNDANT_SIMILARITY = 0.92
/** Effectiveness engine: tool results within the last N segments always count as effective. */
const RECENT_TOOL_WINDOW = 6
/** Effectiveness engine: a stale tool result turns strong once this many assistant messages follow it. */
const STRONG_STALE_ASSISTANT_AFTER = 3

interface CtmStore {
  base: CtmSegment[] | null
  lastBase: CtmSegment[]
  edits: Map<string, string>
  deleted: Set<string>
  trash: CtmSegment[]
  undoStack: { ids: string[] } | null
  overrides: Map<string, CtmEffectiveness>
  rolledBack: Set<string>
  snapshots: { id: string; createdAt: number; label: string; segments: CtmSegment[] }[]
  head: string
  version: number
  usage: Record<string, number> | null
  model: { provider: string; model: string } | null
  /** Edits waiting to be logged as surface replace events at the next agent/pre-step. */
  queue: EditGroup[]
  /** Logged edits that a later undo can still reverse with a counter-replace. */
  appliedEdits: AppliedEdit[]
  /** Pending system-prompt override, applied by the system-prompt/assemble waterfall. */
  systemOverride: string | null
  systemOverridePending: boolean
  lastApplyError: string | null
}

function storeFor(map: Map<string, CtmStore>, sessionId: string): CtmStore {
  const existing = map.get(sessionId)
  if (existing) {
    // LRU touch: re-insert so the eviction below drops the coldest session.
    map.delete(sessionId)
    map.set(sessionId, existing)
    return existing
  }
  const s: CtmStore = {
    base: null, lastBase: [], edits: new Map(), deleted: new Set(), trash: [],
    undoStack: null, overrides: new Map(), rolledBack: new Set(), snapshots: [],
    head: 'live', version: 0, usage: null, model: null,
    queue: [], appliedEdits: [], systemOverride: null, systemOverridePending: false,
    lastApplyError: null,
  }
  map.set(sessionId, s)
  if (map.size > MAX_SESSION_STORES) {
    const oldest = map.keys().next()
    if (!oldest.done) map.delete(oldest.value)
  }
  return s
}

function cloneSegment(s: CtmSegment): CtmSegment {
  return { ...s, tags: [...s.tags], toolCalls: s.toolCalls.map(t => ({ ...t })), blockTypes: [...s.blockTypes] }
}

function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef) || (code >= 0x3040 && code <= 0x30ff)) cjk++
    else { const ch = text[i]; if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') other++ }
  }
  return Math.max(1, cjk + Math.ceil(other / 4))
}

function blockInnerText(b: unknown): string {
  if (b == null) return ''
  if (typeof b === 'string') return b
  if (typeof b !== 'object') return String(b)
  const r = b as Record<string, unknown>
  if (typeof r.text === 'string') return r.text
  if (Array.isArray(r.content)) {
    const parts: string[] = []
    for (const c of r.content) parts.push(blockInnerText(c))
    return parts.join('\n')
  }
  if (r.output != null) { try { return typeof r.output === 'string' ? r.output : JSON.stringify(r.output) } catch { return String(r.output) } }
  return ''
}

/** Shared bigram cache for the effectiveness engine (see bigrams.ts). */
const bigramCache = createBigramCache(BIGRAM_CACHE_CAP)

/**
 * Auto effectiveness verdicts, priority order: system-injected → manual
 * override → user/assistant (always effective) → tool (recent = effective,
 * near-duplicate of any other segment = redundant, otherwise stale; stale
 * turns strong once ≥ STRONG_STALE_ASSISTANT_AFTER assistant messages follow
 * it). Exported (and kept free of cordis state) so it can be unit-tested
 * directly.
 */
export function computeEffectiveness(segments: CtmSegment[], overrides: Map<string, CtmEffectiveness>): void {
  const n = segments.length
  const assistantAfter = new Array<number>(n).fill(0)
  let running = 0
  for (let i = n - 1; i >= 0; i--) { assistantAfter[i] = running; if (segments[i]?.role === 'assistant') running++ }
  for (let i = 0; i < n; i++) {
    const seg = segments[i]
    if (seg === undefined) continue
    let eff: CtmEffectiveness
    let reason: string
    let strong = false
    if (seg.source === 'system_inject') { eff = 'injected'; reason = 'system_inject' }
    else if (overrides.has(seg.id)) { eff = overrides.get(seg.id)!; reason = 'manual_override' }
    else if (seg.role === 'user') { eff = 'effective'; reason = 'user_input' }
    else if (seg.role === 'assistant') { eff = 'effective'; reason = 'model_output' }
    else {
      if (i >= n - RECENT_TOOL_WINDOW) { eff = 'effective'; reason = 'recent_tool' }
      else {
        let maxSim = 0
        const a = bigramCache.get(seg.content || '')
        for (let j = 0; j < n; j++) {
          if (j === i) continue
          const other = segments[j]
          if (other === undefined || other.source === 'system_inject') continue
          const sim = jaccardSimilarity(a, bigramCache.get(other.content || ''))
          if (sim > maxSim) maxSim = sim
        }
        if (maxSim > REDUNDANT_SIMILARITY) { eff = 'redundant'; reason = 'similar' }
        else { eff = 'stale'; reason = 'old_tool'; if ((assistantAfter[i] ?? 0) >= STRONG_STALE_ASSISTANT_AFTER) strong = true }
      }
    }
    seg.effectiveness = eff
    seg.reason = reason
    seg.strongStale = strong
  }
}

export function apply(ctx: any): void {
  const stores = new Map<string, CtmStore>()
  const realtimeSessions = new Set<string>()
  let groupCounter = 0

  const logger: { warn: (...args: unknown[]) => void } = (() => {
    try { return (ctx.logger?.('ctm') ?? console) as { warn: (...args: unknown[]) => void } } catch { return console }
  })()

  function liveSession(sessionId: string): (SessionLike & AppendCapable & { requestHeader?: () => { system?: string } | undefined }) | undefined {
    return (ctx.sessions as { get?: (id: string) => unknown } | undefined)?.get?.(sessionId) as
      | (SessionLike & AppendCapable & { requestHeader?: () => { system?: string } | undefined })
      | undefined
  }

  function newGroupId(): string {
    groupCounter++
    return 'edit-' + Date.now() + '-' + groupCounter
  }

  function segmentFromEvent(ev: Record<string, unknown>, index: number, nodeTokens: Map<number, number>): CtmSegment {
    const d = (ev.data || {}) as Record<string, unknown>
    let role: CtmSegment['role']
    let source: CtmSegment['source']
    let prot = false
    if (ev.type === 'user/message') {
      const sk = (d.source as { kind?: string } | undefined)?.kind
      if (sk === 'plugin' || sk === 'skill-catalog' || sk === 'system' || sk === 'approval-policy' || sk === 'runtime') {
        role = 'system'; source = 'system_inject'; prot = true
      } else { role = 'user'; source = 'user_input' }
    } else if (ev.type === 'assistant/message') { role = 'assistant'; source = 'model_output' }
    else if (ev.type === 'tool/result') { role = 'tool'; source = 'tool_call' }
    else { role = 'assistant'; source = 'system_inject' }
    const msg = (d.message || d) as Record<string, unknown>
    const blocks = (Array.isArray(msg.content) ? msg.content : Array.isArray(d.content) ? d.content : []) as Record<string, unknown>[]
    let prose = ''
    let reasoning = ''
    let toolResult = ''
    let toolCallId: string | null = null
    const toolCalls: CtmSegment['toolCalls'] = []
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'text' && typeof b.text === 'string') prose += (prose ? '\n' : '') + b.text
      else if (b.type === 'reasoning' && typeof b.text === 'string') reasoning += (reasoning ? '\n' : '') + b.text
      else if (b.type === 'tool-result') { toolResult += (toolResult ? '\n' : '') + blockInnerText(b); if (typeof b.toolCallId === 'string') toolCallId = b.toolCallId }
      else if (b.type === 'tool-call') {
        const tc: CtmSegment['toolCalls'][number] = { arguments: '' }
        if (typeof b.id === 'string') tc.id = b.id
        if (typeof b.name === 'string') tc.name = b.name
        if (typeof b.arguments === 'string') tc.arguments = b.arguments
        else if (b.arguments !== undefined) tc.arguments = JSON.stringify(b.arguments)
        toolCalls.push(tc)
      }
    }
    let content: string
    if (role === 'tool') content = toolResult.length > TOOL_RESULT_PREVIEW ? toolResult.slice(0, TOOL_RESULT_PREVIEW) + '\n…[result truncated]' : toolResult
    else { const txt = prose || reasoning; content = txt.length > CONTENT_CAP ? txt.slice(0, CONTENT_CAP) + '\n…[content truncated]' : txt }
    const seq = typeof ev.seq === 'number' ? ev.seq : index
    const token_count = nodeTokens.has(seq) ? nodeTokens.get(seq)! : estimateTokens(prose || reasoning || toolResult)
    return {
      id: 'seg-' + seq, seq,
      messageId: ((d.message as { id?: string } | undefined)?.id) || (typeof d.id === 'string' ? d.id : null),
      turn_index: index, role, source,
      sourceKind: (d.source as { kind?: string } | undefined)?.kind ?? null,
      content, reasoning, text: prose, toolCallId, token_count,
      cache_status: 'unknown', effectiveness: 'effective', reason: '', strongStale: false,
      created_at: typeof ev.time === 'number' ? ev.time : 0, parent_id: null, tags: [],
      protected: prot, edited: false, deleted: false, rolledBack: false,
      turn: typeof d.turn === 'number' ? d.turn : null,
      step: typeof d.step === 'number' ? d.step : null,
      toolCalls, blockTypes: blocks.map(b => b && b.type as string).filter(Boolean),
    }
  }

  async function readBase(sessionId: string): Promise<{ segments: CtmSegment[]; usage: Record<string, number> | null; model: { provider: string; model: string } | null }> {
    const sq = ctx.sessionQuery as { readSurface?: (id: string) => Promise<{ events?: Record<string, unknown>[] }> } | undefined
    const events = (await sq?.readSurface?.(sessionId))?.events ?? []
    const nodeTokens = new Map<number, number>()
    const live = liveSession(sessionId)
    let systemText: string | null = null
    if (live !== undefined) {
      try {
        const m = (ctx.tokenMeter as { measure?: (s: unknown) => { nodes?: { seq: number; tokens: number }[] } } | undefined)?.measure?.(live)
        if (m && Array.isArray(m.nodes)) for (const n of m.nodes) if (typeof n.seq === 'number') nodeTokens.set(n.seq, n.tokens || 0)
      } catch { /* ignore */ }
      try {
        // The initial system prompt is NOT a surface event: it lives on the
        // request/header snapshot the agent assembled for the next request.
        // The live Session folds it incrementally (requestHeader()), so read it
        // there instead of re-scanning the raw log. This is the "segment 0" the
        // Trajectory view shows as "Initial System Prompt" via its request/header
        // definition, and which readSurface() alone cannot see.
        const header = live.requestHeader?.()
        if (typeof header?.system === 'string' && header.system.length > 0) systemText = header.system
      } catch { /* ignore */ }
    }
    // Fallback for non-live (historical/persisted) sessions: the live Session
    // is absent (or had no request/header yet), so read the system prompt from
    // the latest request/header event in the raw log via readSession.
    if (systemText === null) {
      try {
        const rs = ctx.sessionQuery as { readSession?: (id: string) => Promise<{ events?: Record<string, unknown>[] }> } | undefined
        const raw = (await rs?.readSession?.(sessionId))?.events ?? []
        for (let i = raw.length - 1; i >= 0; i--) {
          const ev = raw[i] as Record<string, unknown> | undefined
          if (ev?.type !== 'request/header') continue
          const h = (ev.data as { header?: { system?: string } } | undefined)?.header
          if (typeof h?.system === 'string' && h.system.length > 0) { systemText = h.system; break }
        }
      } catch { /* ignore */ }
    }
    const segments: CtmSegment[] = []
    if (systemText !== null) {
      // The assembled system prompt ("You are an AI agent…") is recorded once
      // in request/header (reason 'initial') and re-sent unchanged on every
      // request — it is NOT re-injected as a new event per turn. So it appears
      // once, as segment 0, at the top of the system-prompt box. The per-turn
      // injections (runtime context, skill catalog) are already in the surface
      // as their own user/message events and repeat per turn on their own.
      segments.push({
        id: 'seg-system', seq: -1, messageId: null, turn_index: 0,
        role: 'system', source: 'system_inject', sourceKind: 'system',
        content: systemText, reasoning: '', text: systemText, toolCallId: null,
        token_count: estimateTokens(systemText),
        cache_status: 'unknown', effectiveness: 'injected', reason: 'system_inject', strongStale: false,
        created_at: 0, parent_id: null, tags: [],
        protected: true, edited: false, deleted: false, rolledBack: false,
        turn: null, step: null, toolCalls: [], blockTypes: ['text'],
      })
    }
    let usage: Record<string, number> | null = null
    let model: { provider: string; model: string } | null = null
    let index = segments.length
    for (const ev of events) {
      segments.push(segmentFromEvent(ev, index, nodeTokens))
      index++
      if (ev.type === 'assistant/message') {
        const u = (ev.data as { usage?: Record<string, number> } | undefined)?.usage
        if (u) usage = u
        const src = (ev.data as { message?: { source?: { provider?: string; model?: string } } } | undefined)?.message?.source
        if (src?.provider && src?.model) model = { provider: src.provider, model: src.model }
      }
    }
    // `user/message` surface events carry no `turn`/`step` in their data
    // (UserMessage has only id/role/content/source), while `assistant/message`
    // and `tool/result` do. Recover each user/system segment's turn/step from
    // the NEXT turn/step-carrying event — the step that consumed it — so
    // per-turn labelling stays accurate as the session grows (instead of
    // collapsing every injection into one "first turn" bucket).
    {
      let maxTurn = 0
      for (const s of segments) if (s.turn != null && s.turn > maxTurn) maxTurn = s.turn
      const pending: number[] = []
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i]
        if (s === undefined) continue
        if (s.turn != null) {
          for (const idx of pending) {
            const p = segments[idx]
            if (p !== undefined) { p.turn = s.turn; p.step = s.step }
          }
          pending.length = 0
        } else {
          pending.push(i)
        }
      }
      // Trailing injections (the in-flight turn's context, whose assistant has
      // not responded yet) belong to the NEXT turn.
      for (const idx of pending) {
        const p = segments[idx]
        if (p !== undefined) { p.turn = maxTurn + 1; p.step = 0 }
      }
    }
    return { segments, usage, model }
  }

  function applyMutations(base: CtmSegment[], st: CtmStore): CtmSegment[] {
    const out: CtmSegment[] = []
    for (const seg of base) {
      if (st.deleted.has(seg.id)) continue
      const c = cloneSegment(seg)
      if (st.edits.has(seg.id)) { c.content = st.edits.get(seg.id)!; c.text = c.content; c.edited = true; c.token_count = estimateTokens(c.content) }
      if (st.rolledBack.has(seg.id)) c.rolledBack = true
      out.push(c)
    }
    return out
  }

  /** Segment ids a queued (not yet logged) group currently drives, for the "pending" badge. */
  function pendingIds(st: CtmStore): Set<string> {
    const ids = new Set<string>()
    for (const group of st.queue) for (const id of group.segmentIds) ids.add(id)
    return ids
  }

  function compute(sessionId: string, st: CtmStore, notice: CtmNotice | null): CtmState {
    const base = st.base ?? st.lastBase
    const segments = applyMutations(base, st)
    computeEffectiveness(segments, st.overrides)
    const pending = pendingIds(st)
    for (const seg of segments) {
      if (pending.has(seg.id)) seg.pending = true
      if (seg.id === 'seg-system' && st.systemOverridePending) seg.pending = true
    }
    const cacheTokens = st.usage?.cacheReadTokens ?? 0
    let cum = 0
    let broken = false
    for (const seg of segments) {
      if (seg.edited) { seg.cache_status = 'miss'; broken = true }
      else if (broken || cacheTokens === 0) { seg.cache_status = 'miss' }
      else if (cum + seg.token_count <= cacheTokens) { seg.cache_status = 'hit' }
      else { seg.cache_status = 'miss'; broken = true }
      cum += seg.token_count
    }
    st.version++
    return {
      sessionId, version: st.version, head: st.head, capturedThroughSeq: null,
      realtime: realtimeSessions.has(sessionId), segments,
      summary: {
        inputTokens: st.usage?.inputTokens ?? null,
        cachedTokens: st.usage?.cacheReadTokens ?? null,
        outputTokens: st.usage?.outputTokens ?? null,
        reasoningTokens: st.usage?.reasoningTokens ?? null,
        inputTokensActual: st.usage != null,
        segmentCount: segments.length,
        activeCount: segments.filter(s => !s.rolledBack).length,
        rolledBackCount: segments.filter(s => s.rolledBack).length,
        model: st.model,
      },
      snapshots: st.snapshots.map(s => ({ id: s.id, createdAt: s.createdAt, label: s.label, segmentCount: s.segments.length })),
      trash: st.trash, notice,
      interceptError: null,
      applyError: st.lastApplyError,
    }
  }

  async function run(sessionId: string, fn: (st: CtmStore, cur: CtmSegment[]) => CtmNotice | null): Promise<CtmState> {
    const st = storeFor(stores, sessionId)
    // Re-read the live surface on every request while in "live" mode; only a
    // restored snapshot (st.base !== null) pins the base. This keeps the view
    // fresh as the session grows instead of freezing at the first read — and
    // makes logged edits show up on their own, because readSurface returns the
    // post-replacement surface.
    if (st.base === null) {
      const info = await readBase(sessionId)
      st.lastBase = info.segments
      st.usage = info.usage
      st.model = info.model
    }
    const cur = applyMutations(st.base ?? st.lastBase, st)
    const notice = fn(st, cur)
    return compute(sessionId, st, notice)
  }

  function findSeg(list: CtmSegment[], id: string): CtmSegment | null {
    for (const s of list) if (s.id === id) return s
    return null
  }

  function currentUserSeg(list: CtmSegment[]): CtmSegment | null {
    let best: CtmSegment | null = null
    for (const s of list) if (s.role === 'user' && s.source === 'user_input') best = s
    return best
  }

  function eventBySeq(session: SessionLike, seq: number): { type: string; data: any } | undefined {
    const direct = session.events[seq]
    if (direct !== undefined && direct.seq === seq) return direct
    return session.events.find(e => e.seq === seq)
  }

  /** The message source a replacement user/message should keep so the node keeps its classification. */
  function replacementSource(session: SessionLike, seg: CtmSegment): unknown {
    // Assistant revision by role demotion: the model sees the revised text as
    // a plain user message (assistant/message replacement is rejected by the
    // session invariant, whose turn/step must match the open one).
    if (seg.role === 'assistant') return { kind: 'user' }
    const source = eventBySeq(session, seg.seq)?.data?.source
    try { return source === undefined ? { kind: 'user' } : structuredClone(source) } catch { return { kind: 'user' } }
  }

  function planErrorNotice(code: EditPlanErrorCode): string {
    switch (code) {
      case 'target_not_on_surface': return 'segment_gone'
      case 'unbalanced': return 'unbalanced_edit'
      case 'not_tool_result': return 'tool_result_changed'
      case 'not_user_message': return 'segment_gone'
      case 'empty_range': return 'nothing_to_delete'
    }
  }

  /** Drop the in-memory view mutations a group drove (after flush, or when the group is dequeued). */
  function releaseViewMutations(st: CtmStore, group: EditGroup): void {
    for (const id of group.segmentIds) {
      st.edits.delete(id)
      if (st.deleted.delete(id)) st.trash = st.trash.filter(t => t.id !== id)
      st.rolledBack.delete(id)
    }
  }

  /**
   * Flush the queued edits of one session into the log. Runs inside the
   * agent/pre-step waterfall (turn open, request not yet built), so tool-result
   * rewrites satisfy the open-turn invariant and every edit lands in the very
   * next request. Failures are contained per group: the view mutation is
   * released (the edit did not happen) and the error surfaces in the state.
   */
  function flushQueuedEdits(session: SessionLike & AppendCapable, st: CtmStore): void {
    const groups = st.queue
    st.queue = []
    for (const group of groups) {
      try {
        const applied = applyEditGroup(session, group)
        if (applied !== null && applied.undoable) st.appliedEdits.push(applied)
        st.lastApplyError = null
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.warn(`[ctm] queued ${group.kind} edit could not be applied:`, msg)
        st.lastApplyError = msg
      } finally {
        releaseViewMutations(st, group)
      }
    }
  }

  /** Enqueue one validated edit group; returns the error notice code when planning rejects it. */
  function enqueue(st: CtmStore, session: SessionLike, kind: EditGroup['kind'], undoable: boolean, edit: QueuedEdit, segmentIds: string[]): string | null {
    try {
      planEdit(session, edit) // validation only; the plan is recomputed at flush time
    } catch (e) {
      if (e instanceof EditPlanError) return planErrorNotice(e.code)
      throw e
    }
    st.queue.push({ id: newGroupId(), kind, undoable, edits: [edit], segmentIds })
    return null
  }

  /** Enqueue every pending view mutation when realtime is switched on. Returns how many groups were queued. */
  function enqueueViewMutations(sessionId: string, st: CtmStore, cur: CtmSegment[]): number {
    const session = liveSession(sessionId)
    if (session === undefined) return 0
    let count = 0
    for (const [id, content] of st.edits) {
      if (id === 'seg-system') continue
      const seg = findSeg(cur, id)
      if (!seg) continue
      const edit: QueuedEdit = seg.role === 'tool'
        ? { kind: 'replace-tool', seq: seg.seq, text: content }
        : { kind: 'replace-user', seq: seg.seq, text: content, source: replacementSource(session, seg) }
      if (enqueue(st, session, 'replace', seg.role !== 'assistant', edit, [id]) === null) count++
    }
    for (const id of st.deleted) {
      const seg = findSeg(cur, id)
      if (!seg || seg.seq < 0) continue
      const edit: QueuedEdit = { kind: 'delete', seq: seg.seq, marker: `[CTM] A ${seg.role} context segment was removed by the user.` }
      if (enqueue(st, session, 'delete', eventBySeq(session, seg.seq)?.type === 'user/message', edit, [id]) === null) count++
    }
    if (st.rolledBack.size > 0) {
      let startSeq = -1
      for (const s of cur) if (st.rolledBack.has(s.id) && s.seq >= 0 && (startSeq < 0 || s.seq < startSeq)) startSeq = s.seq
      if (startSeq >= 0) {
        const edit: QueuedEdit = { kind: 'rollback', startSeq, marker: '[CTM] The conversation was rolled back by the user.' }
        if (enqueue(st, session, 'rollback', false, edit, [...st.rolledBack]) === null) count++
      }
    }
    return count
  }

  function dispatch(request: CtmRequest, st: CtmStore, cur: CtmSegment[]): CtmNotice | null {
    switch (request.op) {
      case 'getState': return null
      case 'replace': {
        const seg = findSeg(cur, request.segmentId)
        if (!seg) return { kind: 'error', code: 'segment_not_found' }
        const content = String(request.content ?? '')
        // The initial system prompt is not a surface event: the edit is stored
        // as an override that the system-prompt/assemble waterfall swaps in for
        // the section list. `{{` is rejected because the render pass would
        // treat it as a variable reference and fail the whole request.
        if (seg.id === 'seg-system') {
          if (content.includes('{{')) return { kind: 'error', code: 'invalid_template' }
          st.systemOverride = content
          st.systemOverridePending = realtimeSessions.has(request.sessionId)
          st.edits.set(seg.id, content)
          return { kind: 'ok', code: 'replaced_system' }
        }
        st.edits.set(seg.id, content)
        let idx = -1
        for (let i = 0; i < cur.length; i++) if (cur[i]?.id === seg.id) { idx = i; break }
        const later = Math.max(0, cur.length - idx - 1)
        if (!realtimeSessions.has(request.sessionId)) return { kind: 'ok', code: 'replaced', params: { later } }
        const session = liveSession(request.sessionId)
        if (session === undefined) return { kind: 'warn', code: 'session_not_live' }
        const edit: QueuedEdit = seg.role === 'tool'
          ? { kind: 'replace-tool', seq: seg.seq, text: content }
          : { kind: 'replace-user', seq: seg.seq, text: content, source: replacementSource(session, seg) }
        const error = enqueue(st, session, 'replace', seg.role !== 'assistant', edit, [seg.id])
        if (error !== null) { st.edits.delete(seg.id); return { kind: 'error', code: error } }
        return { kind: 'ok', code: 'replaced_queued', params: { later } }
      }
      case 'delete': {
        const seg = findSeg(cur, request.segmentId)
        if (!seg) return { kind: 'error', code: 'nothing_to_delete' }
        if (seg.source === 'system_inject') return { kind: 'error', code: 'cannot_delete_system' }
        const cuser = currentUserSeg(cur)
        if (cuser && seg.id === cuser.id) return { kind: 'error', code: 'cannot_delete_current_user' }
        if (st.deleted.has(seg.id)) return { kind: 'ok', code: 'deleted', params: { count: 0 } }
        const c = cloneSegment(seg); c.deleted = true
        st.trash = st.trash.concat(c).slice(-MAX_TRASH_PER_SESSION)
        st.deleted.add(seg.id)
        if (!realtimeSessions.has(request.sessionId)) { st.undoStack = { ids: [seg.id] }; return { kind: 'ok', code: 'deleted', params: { count: 1 } } }
        const session = liveSession(request.sessionId)
        if (session === undefined) { st.undoStack = { ids: [seg.id] }; return { kind: 'warn', code: 'session_not_live' } }
        const edit: QueuedEdit = { kind: 'delete', seq: seg.seq, marker: `[CTM] A ${seg.role} context segment was removed by the user.` }
        // Only a deleted user/message can be faithfully re-appended by undo;
        // other roles would come back with the wrong role.
        const error = enqueue(st, session, 'delete', eventBySeq(session, seg.seq)?.type === 'user/message', edit, [seg.id])
        if (error !== null) {
          st.deleted.delete(seg.id)
          st.trash = st.trash.filter(t => t.id !== seg.id)
          return { kind: 'error', code: error }
        }
        st.undoStack = null
        return { kind: 'ok', code: 'deleted_queued' }
      }
      case 'rollback': {
        const t = request.turnIndex
        if (typeof t !== 'number' || t < 0) return { kind: 'error', code: 'invalid_turn' }
        st.snapshots.push({ id: 'snap-' + Date.now() + '-' + Math.floor(Math.random() * 10000), createdAt: Date.now(), label: 'rollback_to_' + t, segments: cur.map(cloneSegment) })
        if (st.snapshots.length > MAX_SNAPSHOTS_PER_SESSION) st.snapshots.shift()
        st.head = st.snapshots[st.snapshots.length - 1]!.id
        const previous = new Set(st.rolledBack)
        st.rolledBack.clear()
        let count = 0
        let startSeq = -1
        for (const s of cur) {
          if (s.turn_index > t) {
            st.rolledBack.add(s.id)
            count++
            if (s.seq >= 0 && (startSeq < 0 || s.seq < startSeq)) startSeq = s.seq
          }
        }
        if (realtimeSessions.has(request.sessionId) && count > 0 && startSeq >= 0) {
          const session = liveSession(request.sessionId)
          if (session === undefined) return { kind: 'warn', code: 'session_not_live' }
          const edit: QueuedEdit = { kind: 'rollback', startSeq, marker: `[CTM] The conversation was rolled back to turn ${t}; ${count} later segment(s) were removed.` }
          const error = enqueue(st, session, 'rollback', false, edit, [...st.rolledBack])
          if (error !== null) { st.rolledBack = previous; return { kind: 'error', code: error } }
          return { kind: 'ok', code: 'rollback_queued', params: { count } }
        }
        return { kind: 'ok', code: 'rolled_back', params: { count } }
      }
      case 'restore': {
        const snap = st.snapshots.find(s => s.id === request.snapshotId)
        if (!snap) return { kind: 'error', code: 'snapshot_not_found' }
        st.base = snap.segments.map(cloneSegment)
        st.rolledBack.clear(); st.edits.clear(); st.overrides.clear(); st.head = snap.id
        return { kind: 'ok', code: 'restored' }
      }
      case 'reset':
        st.base = null; st.edits.clear(); st.deleted.clear(); st.trash = []; st.undoStack = null
        st.overrides.clear(); st.rolledBack.clear(); st.snapshots = []; st.head = 'live'
        st.queue = []; st.appliedEdits = []; st.systemOverride = null; st.systemOverridePending = false
        st.lastApplyError = null
        return { kind: 'ok', code: 'reset' }
      case 'undo': {
        // Undo only the most recent operation, at three depths: a queued
        // (not yet logged) group is simply dequeued; a view-only delete is
        // reverted in memory; an already-logged edit is reversed by queueing
        // a counter-replace with the original content from the immutable log.
        const queued = st.queue[st.queue.length - 1]
        if (queued) {
          st.queue.pop()
          releaseViewMutations(st, queued)
          return { kind: 'ok', code: 'undone_queued' }
        }
        if (st.undoStack && st.undoStack.ids.length) {
          for (const id of st.undoStack.ids) st.deleted.delete(id)
          st.trash = st.trash.filter(t => !st.undoStack!.ids.includes(t.id))
          st.undoStack = null
          return { kind: 'ok', code: 'undone' }
        }
        const applied = st.appliedEdits[st.appliedEdits.length - 1]
        if (applied) {
          const session = liveSession(request.sessionId)
          if (session === undefined) return { kind: 'warn', code: 'undo_unavailable' }
          try {
            planUndo(session, applied) // validation only; replanned at flush time
          } catch (e) {
            if (e instanceof EditPlanError) return { kind: 'warn', code: 'undo_unavailable' }
            throw e
          }
          st.appliedEdits.pop()
          const original = eventBySeq(session, applied.originalSeq)
          const originalData = original?.data
          let originalText: string
          if (applied.kind === 'replace-tool') {
            originalText = blockInnerText(originalData?.message?.content?.[0]?.content)
          } else {
            // user/message data carries the blocks at the top level; join the
            // text of every block so the queued undo previews the original.
            const blocks = (originalData?.content ?? originalData?.message?.content) as unknown
            originalText = Array.isArray(blocks) ? blocks.map(blockInnerText).filter(Boolean).join('\n') : blockInnerText(blocks ?? null)
          }
          const replacementId = 'seg-' + applied.replacementSeq
          st.queue.push({ id: newGroupId(), kind: 'undo', undoable: false, edits: [{ kind: 'undo', applied }], segmentIds: [replacementId] })
          if (originalText) st.edits.set(replacementId, originalText)
          return { kind: 'ok', code: 'undone_queued' }
        }
        return { kind: 'warn', code: 'nothing_to_undo' }
      }
      case 'override': {
        const seg = findSeg(cur, request.segmentId)
        if (!seg) return { kind: 'error', code: 'segment_not_found' }
        if (request.value == null) { st.overrides.delete(seg.id); return { kind: 'ok', code: 'override_cleared' } }
        if (!['effective', 'redundant', 'stale', 'injected'].includes(request.value)) return { kind: 'error', code: 'invalid_effectiveness' }
        st.overrides.set(seg.id, request.value as CtmEffectiveness)
        return { kind: 'ok', code: 'override_set', params: { value: request.value } }
      }
      case 'setRealtime':
        if (request.enabled) {
          realtimeSessions.add(request.sessionId)
          // Switching on means "apply for real": every pending view mutation is
          // queued for the next agent/pre-step, and a stored system-prompt
          // override goes live at the next assembly.
          if (st.systemOverride !== null) st.systemOverridePending = true
          const queuedCount = enqueueViewMutations(request.sessionId, st, cur)
          return queuedCount > 0
            ? { kind: 'ok', code: 'realtime_on_queued', params: { count: queuedCount } }
            : { kind: 'ok', code: 'realtime_on' }
        }
        realtimeSessions.delete(request.sessionId)
        return { kind: 'ok', code: 'realtime_off' }
      default: return { kind: 'error', code: 'unknown_op' }
    }
  }

  // Timing layer: queued edits land in the log at the step boundary, the same
  // moment automatic compaction appends its replace events. The turn is open
  // (tool-result rewrites are legal), the request is not yet built (the edits
  // take effect in this very step), and nothing interleaves with streaming.
  ctx.on('agent/pre-step', (payload: any, next: () => unknown) => {
    try {
      const session = payload?.agent?.session
      const sid = typeof session?.id === 'string' ? session.id : undefined
      const st = sid === undefined ? undefined : stores.get(sid)
      if (session !== undefined && st !== undefined && st.queue.length > 0) flushQueuedEdits(session, st)
    } catch (e) {
      logger.warn('[ctm] failed to flush queued edits:', e instanceof Error ? e.message : String(e))
    }
    return next()
  })

  // System-prompt layer: a stored override replaces the assembled section list
  // (the user edited the fully rendered prompt, so the override IS the whole
  // section list). The loop logs a new request/header snapshot on its own when
  // the rendered system text changes. Waterfall rules: always call next().
  ctx.on('system-prompt/assemble', async (_assembly: any, context: any, next: () => Promise<any>) => {
    const result = await next()
    try {
      const sid = context?.agent?.session?.id
      if (typeof sid !== 'string' || !realtimeSessions.has(sid)) return result
      const st = stores.get(sid)
      if (st === undefined || st.systemOverride === null) return result
      st.systemOverridePending = false
      st.edits.delete('seg-system') // the next readBase picks the new text up from request/header
      return { ...result, sections: [{ name: 'ctm:override', text: st.systemOverride }] }
    } catch (e) {
      logger.warn('[ctm] failed to apply the system-prompt override:', e instanceof Error ? e.message : String(e))
      return result
    }
  })

  ctx.inject(['webServer'], (scope: any) => {
    // Return the route disposer so the framework removes /ctm on unload/HMR
    // ("registrations are effects"); dropping it leaks the route and the next
    // reload crashes on the duplicate-exact-route check.
    return scope.webServer.register({
      kind: 'exact',
      path: '/ctm',
      handler: async (req: any, res: any) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        let body = ''
        for await (const chunk of req) body += chunk
        let request: CtmRequest
        try {
          request = ctmRequestSchema.parse(body ? JSON.parse(body) : null)
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'invalid request' }))
          return
        }
        try {
          const state = await run(request.sessionId, (st, cur) => dispatch(request, st, cur))
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, state }))
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
        }
      },
    })
  })
}
