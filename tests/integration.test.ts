/**
 * End-to-end tests of the CTM host against a high-fidelity fake session:
 * real HTTP route → edit queue → agent/pre-step flush → surface fold, with
 * assertions on the two hard indicators — what `deriveMessages()` shows the
 * model, and whether the log still holds the shadowed originals (undoable).
 */
import { describe, expect, it } from 'vitest'
import type { CtmSegment, CtmState } from '../src/contract'
import { createHarness, type Harness } from './helpers/fake-ctx'
import { FakeSession } from './helpers/fake-session'

// ---------------------------------------------------------------------------
// Conversation fixtures: real turn/step/tool-event structure, because the fake
// session enforces the relational invariant on every append.
// ---------------------------------------------------------------------------

function userMsgData(text: string): Record<string, unknown> {
  return { id: 'u-' + text, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function assistantData(turn: number, step: number, text: string, calls: { id: string; name: string }[] = []): Record<string, unknown> {
  const content: Record<string, unknown>[] = []
  if (text) content.push({ type: 'text', text })
  for (const c of calls) content.push({ type: 'tool-call', id: c.id, name: c.name, arguments: '{}' })
  return { turn, step, message: { id: `a-${turn}-${step}`, role: 'assistant', content, source: { kind: 'model', provider: 'mock', model: 'mock' } } }
}

function toolResultData(turn: number, step: number, callId: string, output: string): Record<string, unknown> {
  return {
    turn, step,
    message: {
      id: `tr-${callId}`, role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: output }] }],
      source: { kind: 'tool', callId },
    },
  }
}

/** One complete user→assistant turn. */
function plainTurn(s: FakeSession, turn: number, userText: string, answerText: string): void {
  s.append('turn/start', { turn })
  s.append('user/message', userMsgData(userText), { surfaceOp: 'append' })
  s.append('step/start', { turn, step: 1 })
  s.append('assistant/message', assistantData(turn, 1, answerText), { surfaceOp: 'append' })
  s.append('step/end', { turn, step: 1 })
  s.append('turn/end', { turn })
}

/** One complete turn whose assistant makes a tool call and gets a result. */
function toolTurn(s: FakeSession, turn: number, callId: string, callText: string, output: string): void {
  s.append('turn/start', { turn })
  s.append('step/start', { turn, step: 1 })
  s.append('assistant/message', assistantData(turn, 1, callText, [{ id: callId, name: 'bash' }]), { surfaceOp: 'append' })
  s.append('tool/call', { turn, step: 1, callId, name: 'bash', arguments: {} })
  s.append('tool/result', toolResultData(turn, 1, callId, output), { surfaceOp: 'append' })
  s.append('step/end', { turn, step: 1 })
  s.append('turn/end', { turn })
}

// ---------------------------------------------------------------------------
// Read-out helpers.
// ---------------------------------------------------------------------------

function blockText(b: Record<string, any>): string {
  if (b.type === 'text') return b.text as string
  if (b.type === 'tool-result') {
    if (typeof b.content === 'string') return b.content
    if (Array.isArray(b.content)) return (b.content as Record<string, any>[]).map(blockText).join('\n')
    return JSON.stringify(b.content)
  }
  if (b.type === 'tool-call') return `[tool-call ${String(b.name)}]`
  return `[${String(b.type)}]`
}

/** What the model would see: deriveMessages() projected to plain text. */
function texts(s: FakeSession): string[] {
  return s.deriveMessages().map(m => (m.content as Record<string, any>[]).map(blockText).join('\n'))
}

/** Roles of the derived messages, same order as texts(). */
function roles(s: FakeSession): string[] {
  return s.deriveMessages().map(m => m.role as string)
}

async function stateOf(h: Harness, sessionId: string): Promise<CtmState> {
  const { json } = await h.post({ op: 'getState', sessionId })
  if (!json.ok) throw new Error('getState failed: ' + json.error)
  return json.state
}

function findSeg(state: CtmState, pred: (seg: CtmSegment) => boolean): CtmSegment {
  const seg = state.segments.find(pred)
  if (seg === undefined) throw new Error('segment not found in state')
  return seg
}

async function noticeOf(h: Harness, body: Record<string, unknown>): Promise<{ kind: string; code: string }> {
  const { json } = await h.post(body)
  if (!json.ok) throw new Error('request failed: ' + json.error)
  const notice = json.state.notice
  if (notice === null) throw new Error('expected a notice')
  return notice
}

/** The shadowed originals must still sit in the append-only log. */
function logRetains(s: FakeSession, text: string): boolean {
  return s.events.some(e => JSON.stringify(e.data).includes(text))
}

// ---------------------------------------------------------------------------
// Scenarios.
// ---------------------------------------------------------------------------

describe('integration: realtime ON replace of a user segment', () => {
  it('lands in deriveMessages at the same position after pre-step; undo restores the original', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'hello', 'answer one')
    plainTurn(s, 2, 'second question', 'answer two')
    const h = createHarness([s])
    await h.post({ op: 'setRealtime', sessionId: 's1', enabled: true })

    const st = await stateOf(h, 's1')
    const target = findSeg(st, seg => seg.content === 'hello')
    expect(await noticeOf(h, { op: 'replace', sessionId: 's1', segmentId: target.id, content: 'hello edited' }))
      .toEqual({ kind: 'ok', code: 'replaced_queued', params: { later: 3 } })

    // Queued but not yet logged: the model still sees the original.
    expect(texts(s)).toEqual(['hello', 'answer one', 'second question', 'answer two'])
    await h.flush(s)
    expect(texts(s)).toEqual(['hello edited', 'answer one', 'second question', 'answer two'])

    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone_queued' })
    await h.flush(s)
    expect(texts(s)).toEqual(['hello', 'answer one', 'second question', 'answer two'])
    // Both counter-edits are logged replace events; the originals never left the log.
    expect(logRetains(s, 'hello edited')).toBe(true)
  })
})

describe('integration: realtime ON delete of a user segment', () => {
  it('disappears for the model but stays in the log as a shadowed node; undo restores it', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'first', 'answer one')
    plainTurn(s, 2, 'second', 'answer two')
    const h = createHarness([s])
    await h.post({ op: 'setRealtime', sessionId: 's1', enabled: true })

    const st = await stateOf(h, 's1')
    const target = findSeg(st, seg => seg.content === 'first')
    expect(await noticeOf(h, { op: 'delete', sessionId: 's1', segmentId: target.id }))
      .toEqual({ kind: 'ok', code: 'deleted_queued' })

    await h.flush(s)
    expect(texts(s)).toEqual([
      '[CTM] A user context segment was removed by the user.',
      'answer one',
      'second',
      'answer two',
    ])
    expect(logRetains(s, 'first')).toBe(true)

    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone_queued' })
    await h.flush(s)
    expect(texts(s)).toEqual(['first', 'answer one', 'second', 'answer two'])
  })
})

describe('integration: realtime ON delete of a tool result', () => {
  it('shadows the whole call pair (minimal balanced range); undo restores both as user messages', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'start', 'a1')
    toolTurn(s, 2, 'call-1', 'calling tool', 'big output')
    plainTurn(s, 3, 'after', 'a3')
    const h = createHarness([s])
    await h.post({ op: 'setRealtime', sessionId: 's1', enabled: true })

    const st = await stateOf(h, 's1')
    const target = findSeg(st, seg => seg.role === 'tool' && seg.content === 'big output')
    expect(await noticeOf(h, { op: 'delete', sessionId: 's1', segmentId: target.id }))
      .toEqual({ kind: 'ok', code: 'deleted_queued' })

    await h.flush(s)
    // The assistant message carrying the tool-call went with its result — no
    // dangling call for the model. The pair stays in the log.
    expect(texts(s)).toEqual([
      'start',
      'a1',
      '[CTM] A tool context segment was removed by the user.',
      'after',
      'a3',
    ])
    expect(logRetains(s, 'calling tool')).toBe(true)
    expect(logRetains(s, 'big output')).toBe(true)

    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone_queued' })
    await h.flush(s)
    // First restored message takes the placeholder position, the second
    // appends to the tail; both come back demoted to the user role.
    expect(texts(s)).toEqual(['start', 'a1', 'calling tool', 'after', 'a3', 'big output'])
    expect(roles(s)).toEqual(['user', 'assistant', 'user', 'user', 'assistant', 'user'])
  })
})

describe('integration: realtime ON rollback', () => {
  it('leaves only the kept prefix plus a placeholder in deriveMessages; the tail stays in the log', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'q1', 'a1')
    plainTurn(s, 2, 'q2', 'a2')
    plainTurn(s, 3, 'q3', 'a3')
    const h = createHarness([s])
    await h.post({ op: 'setRealtime', sessionId: 's1', enabled: true })

    const st = await stateOf(h, 's1')
    const t = findSeg(st, seg => seg.content === 'a1').turn_index
    const notice = await noticeOf(h, { op: 'rollback', sessionId: 's1', turnIndex: t })
    expect(notice).toEqual({ kind: 'ok', code: 'rollback_queued', params: { count: 4 } })

    await h.flush(s)
    const seen = texts(s)
    expect(seen).toHaveLength(3)
    expect(seen[0]).toBe('q1')
    expect(seen[1]).toBe('a1')
    expect(seen[2]).toContain('[CTM] The conversation was rolled back')
    expect(roles(s)).toEqual(['user', 'assistant', 'user'])
    // Everything past the rollback point is shadowed, not deleted.
    for (const text of ['q2', 'a2', 'q3', 'a3']) expect(logRetains(s, text)).toBe(true)
  })
})

describe('integration: undo of a rollback (restore group)', () => {
  it('restores the shadowed tail as user messages, and the restore is itself undoable', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'q1', 'a1')
    plainTurn(s, 2, 'q2', 'a2')
    plainTurn(s, 3, 'q3', 'a3')
    const h = createHarness([s])
    await h.post({ op: 'setRealtime', sessionId: 's1', enabled: true })

    const st = await stateOf(h, 's1')
    const t = findSeg(st, seg => seg.content === 'a1').turn_index
    await h.post({ op: 'rollback', sessionId: 's1', turnIndex: t })
    await h.flush(s)
    expect(texts(s)).toHaveLength(3)

    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone_queued' })
    await h.flush(s)
    // q2 replaces the placeholder in place; a2/q3/a3 append to the tail in
    // original order — every restored message demoted to the user role.
    expect(texts(s)).toEqual(['q1', 'a1', 'q2', 'a2', 'q3', 'a3'])
    expect(roles(s)).toEqual(['user', 'assistant', 'user', 'user', 'user', 'user'])

    // Undoing the restore re-shadows the restored run: the placeholder is back.
    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone_queued' })
    await h.flush(s)
    const seen = texts(s)
    expect(seen).toHaveLength(3)
    expect(seen[0]).toBe('q1')
    expect(seen[1]).toBe('a1')
    expect(seen[2]).toContain('[CTM] The conversation was rolled back')
    // And the log still retains every original — the cycle is fully reversible.
    for (const text of ['q2', 'a2', 'q3', 'a3']) expect(logRetains(s, text)).toBe(true)
  })
})

describe('integration: realtime OFF is view-only', () => {
  it('replace/delete/rollback touch no log events and queue no surface writes; undo reverts the view', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'q1', 'a1')
    plainTurn(s, 2, 'q2', 'a2')
    plainTurn(s, 3, 'q3', 'a3')
    const h = createHarness([s])
    const logLength = s.events.length

    let st = await stateOf(h, 's1')
    expect(st.realtime).toBe(false)
    const q1 = findSeg(st, seg => seg.content === 'q1')
    const q2 = findSeg(st, seg => seg.content === 'q2')

    expect(await noticeOf(h, { op: 'replace', sessionId: 's1', segmentId: q1.id, content: 'q1 view edit' }))
      .toEqual({ kind: 'ok', code: 'replaced', params: { later: 5 } })
    expect(await noticeOf(h, { op: 'delete', sessionId: 's1', segmentId: q2.id }))
      .toEqual({ kind: 'ok', code: 'deleted', params: { count: 1 } })

    // View reflects the mutations…
    st = await stateOf(h, 's1')
    expect(findSeg(st, seg => seg.id === q1.id).edited).toBe(true)
    expect(findSeg(st, seg => seg.id === q1.id).content).toBe('q1 view edit')
    expect(st.segments.some(seg => seg.id === q2.id)).toBe(false)
    // …the session log does not: zero new events, zero surface writes.
    expect(s.events.length).toBe(logLength)
    expect(texts(s)).toEqual(['q1', 'a1', 'q2', 'a2', 'q3', 'a3'])

    // View-only delete is undoable in memory.
    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone' })
    st = await stateOf(h, 's1')
    expect(st.segments.some(seg => seg.id === q2.id)).toBe(true)

    // View-only rollback marks stale without touching the log, and its undo
    // restores the rolledBack set.
    const t = findSeg(st, seg => seg.content === 'a1').turn_index
    expect(await noticeOf(h, { op: 'rollback', sessionId: 's1', turnIndex: t }))
      .toEqual({ kind: 'ok', code: 'rolled_back', params: { count: 4 } })
    st = await stateOf(h, 's1')
    expect(st.summary.rolledBackCount).toBe(4)
    expect(s.events.length).toBe(logLength)
    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone' })
    st = await stateOf(h, 's1')
    expect(st.summary.rolledBackCount).toBe(0)

    // Even a pre-step run writes nothing: the queue stayed empty throughout.
    await h.flush(s)
    expect(s.events.length).toBe(logLength + 2) // turn/start + turn/end only
    expect(texts(s)).toEqual(['q1', 'a1', 'q2', 'a2', 'q3', 'a3'])
  })
})

describe('integration: stale version race', () => {
  it('rejects a mutation carrying an old expectedVersion with zero side effects', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'q1', 'a1')
    const h = createHarness([s])
    await h.post({ op: 'setRealtime', sessionId: 's1', enabled: true })

    const st = await stateOf(h, 's1')
    const q1 = findSeg(st, seg => seg.content === 'q1')
    const logLength = s.events.length

    const { json: stale } = await h.post({
      op: 'replace', sessionId: 's1', segmentId: q1.id, content: 'stale edit',
      expectedVersion: st.version - 1,
    })
    if (!stale.ok) throw new Error('stale request errored at HTTP level')
    expect(stale.state.notice).toEqual({ kind: 'error', code: 'stale_version' })
    // No side effects: the view mutation was not stored, nothing queued.
    expect(findSeg(stale.state, seg => seg.id === q1.id).edited).toBe(false)
    expect(s.events.length).toBe(logLength)
    await h.flush(s)
    expect(s.events.length).toBe(logLength + 2) // turn boundaries only
    expect(texts(s)).toEqual(['q1', 'a1'])

    // The same edit with the current version goes through.
    expect(await noticeOf(h, {
      op: 'replace', sessionId: 's1', segmentId: q1.id, content: 'fresh edit',
      expectedVersion: stale.state.version,
    })).toEqual({ kind: 'ok', code: 'replaced_queued', params: { later: 1 } })
    await h.flush(s)
    expect(texts(s)).toEqual(['fresh edit', 'a1'])
  })
})

describe('integration: mixed sequence of applied edits', () => {
  it('undo pops the applied-edit stack in reverse order: delete undone, then replace undone', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'q1', 'a1')
    plainTurn(s, 2, 'q2', 'a2')
    plainTurn(s, 3, 'q3', 'a3')
    const h = createHarness([s])
    await h.post({ op: 'setRealtime', sessionId: 's1', enabled: true })

    let st = await stateOf(h, 's1')
    const q1 = findSeg(st, seg => seg.content === 'q1')
    const q2 = findSeg(st, seg => seg.content === 'q2')

    // replace A → flush.
    await h.post({ op: 'replace', sessionId: 's1', segmentId: q1.id, content: 'A edited' })
    await h.flush(s)
    expect(texts(s)).toEqual(['A edited', 'a1', 'q2', 'a2', 'q3', 'a3'])

    // delete B → flush.
    await h.post({ op: 'delete', sessionId: 's1', segmentId: q2.id })
    await h.flush(s)
    expect(texts(s)).toEqual([
      'A edited',
      'a1',
      '[CTM] A user context segment was removed by the user.',
      'a2',
      'q3',
      'a3',
    ])

    // undo → the DELETE (most recent applied) reverts first, in place.
    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone_queued' })
    await h.flush(s)
    expect(texts(s)).toEqual(['A edited', 'a1', 'q2', 'a2', 'q3', 'a3'])

    // undo → the REPLACE reverts next.
    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone_queued' })
    await h.flush(s)
    expect(texts(s)).toEqual(['q1', 'a1', 'q2', 'a2', 'q3', 'a3'])
    expect(roles(s)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])

    // Nothing left on either undo depth.
    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'warn', code: 'nothing_to_undo' })
    st = await stateOf(h, 's1')
    expect(st.applyError).toBeNull()
  })
})

describe('integration: cordis inject guard (regression)', () => {
  // The real cordis Context proxy throws on any read of a service the plugin
  // did not declare in `inject` — optional chaining does not help, the throw
  // happens at property-get time. The usage reader once touched
  // `ctx.sessionProjections` directly and the plugin died with
  // `cannot get property "sessionProjections" without inject` on load;
  // the service is now reached through an `ctx.inject` child context.
  it('loads and serves getState under a proxy that throws on undeclared service access', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'hello', 'answer one')
    const h = createHarness([s], { cordisGuard: true })
    const state = await stateOf(h, 's1')
    expect(state.applyError).toBeNull()
    expect(state.segments.length).toBeGreaterThan(0)
    // The usage read path ran to completion without touching the (absent,
    // undeclared) projection service; the fixtures carry no usage data.
    expect(state.summary.usageSource).toBe('none')
  })
})

describe('integration: deleting sibling tool results in one batch', () => {
  // Two tool results carried by ONE assistant message share a single minimal
  // balanced range: the first delete shadows [call-message, r1, r2] whole.
  // The second delete's target is then already off the surface — its intent
  // is satisfied, so it must NOT surface target_not_on_surface.
  it('shadows the overlapping call range once; the absorbed sibling delete reports no error', async () => {
    const s = new FakeSession('s1')
    plainTurn(s, 1, 'start', 'a1')
    s.append('turn/start', { turn: 2 })
    s.append('step/start', { turn: 2, step: 1 })
    s.append('assistant/message', assistantData(2, 1, 'calling tools', [{ id: 'c1', name: 'bash' }, { id: 'c2', name: 'bash' }]), { surfaceOp: 'append' })
    s.append('tool/call', { turn: 2, step: 1, callId: 'c1', name: 'bash', arguments: {} })
    s.append('tool/result', toolResultData(2, 1, 'c1', 'out one'), { surfaceOp: 'append' })
    s.append('tool/call', { turn: 2, step: 1, callId: 'c2', name: 'bash', arguments: {} })
    s.append('tool/result', toolResultData(2, 1, 'c2', 'out two'), { surfaceOp: 'append' })
    s.append('step/end', { turn: 2, step: 1 })
    s.append('turn/end', { turn: 2 })
    const h = createHarness([s])
    await h.post({ op: 'setRealtime', sessionId: 's1', enabled: true })

    const st = await stateOf(h, 's1')
    const r1 = findSeg(st, seg => seg.content === 'out one')
    const r2 = findSeg(st, seg => seg.content === 'out two')
    expect(await noticeOf(h, { op: 'delete', sessionId: 's1', segmentId: r1.id }))
      .toEqual({ kind: 'ok', code: 'deleted_queued' })
    expect(await noticeOf(h, { op: 'delete', sessionId: 's1', segmentId: r2.id }))
      .toEqual({ kind: 'ok', code: 'deleted_queued' })

    await h.flush(s)
    // No dangling call, no spurious failure: the single placeholder occupies
    // the whole shadowed range and both results are gone for the model.
    expect(texts(s)).toEqual([
      'start',
      'a1',
      '[CTM] A tool context segment was removed by the user.',
    ])
    expect(logRetains(s, 'out one')).toBe(true)
    expect(logRetains(s, 'out two')).toBe(true)
    const after = await stateOf(h, 's1')
    expect(after.applyError).toBeNull()

    // Undo restores the whole absorbed range (role-demoted), not just r1.
    expect(await noticeOf(h, { op: 'undo', sessionId: 's1' })).toEqual({ kind: 'ok', code: 'undone_queued' })
    await h.flush(s)
    expect(texts(s)).toEqual(['start', 'a1', 'calling tools', 'out one', 'out two'])
  })
})
