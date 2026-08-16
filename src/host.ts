/**
 * Context Transparency Manager — host half.
 *
 * Self-contained dsh bundle plugin: a single `POST /ctm` JSON route (registered
 * through the host `webServer`) plus a host-plane `llm/stream` interceptor. The
 * route reads the live model surface (`sessionQuery.readSurface`) plus the
 * assembled system prompt (`session.requestHeader()`, with a `readSession()`
 * fallback for historical sessions), prices it with `tokenMeter`, keeps a
 * per-session editable store, and applies edits to the model's actual input
 * only while "realtime" is enabled for that session.
 * Requests are validated against the shared contract; every response is a full
 * `CtmState`. No Typert / @Remote coupling.
 */
import {
  ctmRequestSchema,
  type CtmEffectiveness,
  type CtmNotice,
  type CtmRequest,
  type CtmSegment,
  type CtmState,
} from './contract'

export const name = 'ctm'
export const inject = ['sessionQuery', 'sessions', 'tokenMeter', 'llm']

const TOOL_RESULT_PREVIEW = 2000
const CONTENT_CAP = 40000

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
  lastInterceptError: string | null
}

function storeFor(map: Map<string, CtmStore>, sessionId: string): CtmStore {
  let s = map.get(sessionId)
  if (!s) {
    s = {
      base: null, lastBase: [], edits: new Map(), deleted: new Set(), trash: [],
      undoStack: null, overrides: new Map(), rolledBack: new Set(), snapshots: [],
      head: 'live', version: 0, usage: null, model: null, lastInterceptError: null,
    }
    map.set(sessionId, s)
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

interface CtmWireBlock { type?: string; text?: string; id?: string; toolCallId?: string }
interface CtmWireMessage { id?: string; role?: string; content?: CtmWireBlock[] }

function isTextOnly(m: CtmWireMessage | undefined): boolean {
  const c = m?.content
  if (!Array.isArray(c) || c.length === 0) return false
  for (const b of c) if (b && b.type !== 'text' && b.type !== 'reasoning') return false
  return true
}

/**
 * Auto effectiveness verdicts, priority order: system-injected → manual
 * override → user/assistant (always effective) → tool (recent = effective,
 * near-duplicate of any other segment = redundant, otherwise stale; stale
 * turns strong once ≥ 3 assistant messages follow it). Exported (and kept
 * free of cordis state) so it can be unit-tested directly.
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
      if (i >= n - 6) { eff = 'effective'; reason = 'recent_tool' }
      else {
        let maxSim = 0
        for (let j = 0; j < n; j++) {
          if (j === i) continue
          const other = segments[j]
          if (other === undefined || other.source === 'system_inject') continue
          const a = new Set<string>(); const b = new Set<string>()
          const sa = seg.content || ''; const sb = other.content || ''
          for (let k = 0; k < sa.length - 1; k++) a.add(sa.slice(k, k + 2))
          for (let k = 0; k < sb.length - 1; k++) b.add(sb.slice(k, k + 2))
          let inter = 0; for (const x of a) if (b.has(x)) inter++
          const sim = a.size + b.size === 0 ? 0 : inter / (a.size + b.size - inter)
          if (sim > maxSim) maxSim = sim
        }
        if (maxSim > 0.92) { eff = 'redundant'; reason = 'similar' }
        else { eff = 'stale'; reason = 'old_tool'; if ((assistantAfter[i] ?? 0) >= 3) strong = true }
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
  let applying = false

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
    const live = (ctx.sessions as { get?: (id: string) => unknown } | undefined)?.get?.(sessionId)
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
        const header = (live as { requestHeader?: () => { system?: string } | undefined }).requestHeader?.()
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

  function compute(sessionId: string, st: CtmStore, notice: CtmNotice | null): CtmState {
    const base = st.base ?? st.lastBase
    const segments = applyMutations(base, st)
    computeEffectiveness(segments, st.overrides)
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
      interceptError: st.lastInterceptError,
    }
  }

  async function run(sessionId: string, fn: (st: CtmStore, cur: CtmSegment[]) => CtmNotice | null): Promise<CtmState> {
    const st = storeFor(stores, sessionId)
    // Re-read the live surface on every request while in "live" mode; only a
    // restored snapshot (st.base !== null) pins the base. This keeps the view
    // fresh as the session grows instead of freezing at the first read.
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

  function dispatch(request: CtmRequest, st: CtmStore, cur: CtmSegment[]): CtmNotice | null {
    switch (request.op) {
      case 'getState': return null
      case 'replace': {
        const seg = findSeg(cur, request.segmentId)
        if (!seg) return { kind: 'error', text: 'segment_not_found' }
        // System-injected segments are view-only: the UI never offered replace
        // for them, and the realtime interceptor cannot rewrite options.system
        // anyway — so editing them was a silent no-op. Reject until edits move
        // to logged surface-replacement events.
        if (seg.source === 'system_inject') return { kind: 'error', text: 'cannot_replace_system' }
        if (seg.source === 'tool_call' || seg.role === 'tool') return { kind: 'error', text: 'tool_readonly' }
        st.edits.set(seg.id, String(request.content ?? ''))
        let idx = -1
        for (let i = 0; i < cur.length; i++) if (cur[i]?.id === seg.id) { idx = i; break }
        return { kind: 'ok', text: 'replaced_' + Math.max(0, cur.length - idx - 1) }
      }
      case 'delete': {
        const seg = findSeg(cur, request.segmentId)
        if (!seg) return { kind: 'error', text: 'nothing_to_delete' }
        if (seg.source === 'system_inject') return { kind: 'error', text: 'cannot_delete_system' }
        const cuser = currentUserSeg(cur)
        if (cuser && seg.id === cuser.id) return { kind: 'error', text: 'cannot_delete_current_user' }
        if (st.deleted.has(seg.id)) return { kind: 'ok', text: 'deleted_0' }
        const c = cloneSegment(seg); c.deleted = true
        st.trash = st.trash.concat(c)
        st.deleted.add(seg.id)
        st.undoStack = { ids: [seg.id] }
        return { kind: 'ok', text: 'deleted_1' }
      }
      case 'rollback': {
        const t = request.turnIndex
        if (typeof t !== 'number' || t < 0) return { kind: 'error', text: 'invalid_turn' }
        st.snapshots.push({ id: 'snap-' + Date.now() + '-' + Math.floor(Math.random() * 10000), createdAt: Date.now(), label: 'rollback_to_' + t, segments: cur.map(cloneSegment) })
        st.head = st.snapshots[st.snapshots.length - 1]!.id
        st.rolledBack.clear()
        let count = 0
        for (const s of cur) if (s.turn_index > t) { st.rolledBack.add(s.id); count++ }
        return { kind: 'ok', text: 'rolled_back_' + count }
      }
      case 'restore': {
        const snap = st.snapshots.find(s => s.id === request.snapshotId)
        if (!snap) return { kind: 'error', text: 'snapshot_not_found' }
        st.base = snap.segments.map(cloneSegment)
        st.rolledBack.clear(); st.edits.clear(); st.overrides.clear(); st.head = snap.id
        return { kind: 'ok', text: 'restored' }
      }
      case 'reset':
        st.base = null; st.edits.clear(); st.deleted.clear(); st.trash = []; st.undoStack = null
        st.overrides.clear(); st.rolledBack.clear(); st.snapshots = []; st.head = 'live'
        return { kind: 'ok', text: 'reset' }
      case 'undo': {
        if (!st.undoStack || !st.undoStack.ids.length) return { kind: 'warn', text: 'nothing_to_undo' }
        for (const id of st.undoStack.ids) st.deleted.delete(id)
        st.trash = st.trash.filter(t => !st.undoStack!.ids.includes(t.id))
        st.undoStack = null
        return { kind: 'ok', text: 'undone' }
      }
      case 'override': {
        const seg = findSeg(cur, request.segmentId)
        if (!seg) return { kind: 'error', text: 'segment_not_found' }
        if (request.value == null) { st.overrides.delete(seg.id); return { kind: 'ok', text: 'override_cleared' } }
        if (!['effective', 'redundant', 'stale', 'injected'].includes(request.value)) return { kind: 'error', text: 'invalid_effectiveness' }
        st.overrides.set(seg.id, request.value as CtmEffectiveness)
        return { kind: 'ok', text: 'override_' + request.value }
      }
      case 'setRealtime':
        if (request.enabled) realtimeSessions.add(request.sessionId)
        else realtimeSessions.delete(request.sessionId)
        return request.enabled ? { kind: 'ok', text: 'realtime_on' } : { kind: 'ok', text: 'realtime_off' }
      default: return { kind: 'error', text: 'unknown_op' }
    }
  }

  const logger: { warn: (...args: unknown[]) => void } = (() => {
    try { return (ctx.logger?.('ctm') ?? console) as { warn: (...args: unknown[]) => void } } catch { return console }
  })()

  function intercept(options: any, next: () => any): any {
    const sid = options?.sessionId as string | undefined
    try {
      if (!sid || applying || !realtimeSessions.has(sid)) return next()
      const st = stores.get(sid)
      if (!st) return next()
      const excludeIds = new Set<string>()
      const editMap = new Map<string, string>()
      const deletedResultCallIds = new Set<string>()
      const deletedCallIds = new Set<string>()
      for (const seg of st.lastBase) {
        if (!seg.messageId) continue
        if (st.deleted.has(seg.id) || st.rolledBack.has(seg.id)) {
          excludeIds.add(seg.messageId)
          if (seg.toolCallId) deletedResultCallIds.add(seg.toolCallId)
          for (const tc of seg.toolCalls) if (tc.id) deletedCallIds.add(tc.id)
        }
        if (st.edits.has(seg.id)) editMap.set(seg.messageId, st.edits.get(seg.id)!)
      }
      if (!excludeIds.size && !editMap.size) return next()
      const msgs = options?.messages as CtmWireMessage[] | undefined
      if (!Array.isArray(msgs)) return next()
      const out: CtmWireMessage[] = []
      let changed = false
      for (const m of msgs) {
        if (m?.id && excludeIds.has(m.id)) { changed = true; continue }
        let outMsg = m
        if (deletedResultCallIds.size && outMsg?.role === 'assistant' && Array.isArray(outMsg.content)) {
          const filtered = outMsg.content.filter(b => !(b && b.type === 'tool-call' && b.id !== undefined && deletedResultCallIds.has(b.id)))
          if (filtered.length !== outMsg.content.length) { changed = true; outMsg = { ...outMsg, content: filtered } }
        }
        if (deletedCallIds.size && outMsg && Array.isArray(outMsg.content)) {
          const orphan = outMsg.content.some(b => b && b.type === 'tool-result' && b.toolCallId !== undefined && deletedCallIds.has(b.toolCallId))
          if (orphan) { changed = true; continue }
        }
        if (outMsg?.id && editMap.has(outMsg.id) && isTextOnly(outMsg)) {
          changed = true
          outMsg = { ...outMsg, content: [{ type: 'text', text: editMap.get(outMsg.id)! }] }
        }
        if (outMsg && Array.isArray(outMsg.content) && outMsg.content.length === 0) { changed = true; continue }
        out.push(outMsg)
      }
      if (!changed) return next()
      applying = true
      try {
        const result = ctx.llm.stream({ ...options, messages: out })
        st.lastInterceptError = null
        return result
      } finally { applying = false }
    } catch (e) {
      // A failed rewrite falls back to the unmodified request — but never
      // silently: log it and surface it in the next state, so the user can see
      // that "Apply for real" did not actually apply.
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn('[ctm] realtime interception failed, sending the unmodified request instead:', msg)
      if (sid) { const st = stores.get(sid); if (st) st.lastInterceptError = msg }
      return next()
    }
  }

  ctx.on('llm/stream', (options: unknown, next: () => unknown) => intercept(options, next))

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
