import { describe, it, expect } from 'vitest'
import {
  CTM_PLUGIN_SOURCE,
  EditPlanError,
  applyEditGroup,
  planDeleteSegment,
  planEdit,
  planReplaceUserMessage,
  planRewriteToolResult,
  planRollback,
  planUndo,
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
  type AppendPlan,
  type AppliedEdit,
  type EditGroup,
  type SessionEventLike,
  type SessionLike,
} from '../src/surface-edits'

/** Minimal live-session double: append-only log plus a surface the append splices. */
class FakeSession implements SessionLike {
  events: SessionEventLike[] = []
  surface = { nodes: [] as number[] }
  appended: { type: string; data: unknown; intent: unknown }[] = []

  eventAt(seq: number): SessionEventLike | undefined { return this.events[seq] }
  snapshotEvents(): readonly SessionEventLike[] { return [...this.events] }

  pushEvent(ev: SessionEventLike): void {
    this.events.push(ev)
    this.surface.nodes.push(ev.seq)
  }

  append(type: string, data: unknown, intent?: AppendPlan['intent']): { seq: number } {
    const seq = this.events.length
    this.appended.push({ type, data, intent })
    this.events.push({ seq, type, data: data as SessionEventLike['data'] })
    const op = intent?.surfaceOp
    if (typeof op === 'object') {
      const start = this.surface.nodes.indexOf(op.startSeq)
      const end = this.surface.nodes.indexOf(op.endSeq)
      if (start === -1 || end === -1) throw new Error('not found in surface')
      this.surface.nodes.splice(start, end - start + 1, seq)
    } else {
      this.surface.nodes.push(seq)
    }
    return { seq }
  }
}

function userMsg(seq: number, text: string, source: unknown = { kind: 'user' }): SessionEventLike {
  return { seq, type: 'user/message', data: { id: 'm' + seq, role: 'user', content: [{ type: 'text', text }], source } }
}

function assistantWithCalls(seq: number, calls: number): SessionEventLike {
  const content = Array.from({ length: calls }, (_, i) => ({ type: 'tool-call', id: `c${seq}-${i}`, name: 'tool', arguments: '{}' }))
  return { seq, type: 'assistant/message', data: { message: { id: 'a' + seq, role: 'assistant', content }, turn: 1, step: 0 } }
}

function toolResult(seq: number, text: string): SessionEventLike {
  return {
    seq, type: 'tool/result',
    data: {
      message: {
        id: 'tr' + seq, role: 'user',
        content: [{ type: 'tool-result', toolCallId: 'c', content: text }],
        source: { kind: 'tool', callId: 'c' },
      },
      turn: 1, step: 0,
    },
  }
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(EditPlanError)
    expect((e as EditPlanError).code).toBe(code)
    return
  }
  throw new Error('expected EditPlanError ' + code)
}

describe('tool pairing balance (local reimplementation of dsh-compaction)', () => {
  it('is balanced everywhere on a plain user/assistant surface', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'hi'))
    s.pushEvent(assistantWithCalls(1, 0))
    expect(toolPairingBalancedBefore(s, 1)).toBe(true)
    expect(toolPairingBalancedAfter(s, 1)).toBe(true)
  })

  it('an unanswered tool call makes the cuts around its pair unbalanced', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'hi'))
    s.pushEvent(assistantWithCalls(1, 1))
    s.pushEvent(toolResult(2, 'out'))
    s.pushEvent(assistantWithCalls(3, 0))
    // Before the call opens and after the result closes: balanced.
    expect(toolPairingBalancedBefore(s, 1)).toBe(true)
    expect(toolPairingBalancedAfter(s, 2)).toBe(true)
    // Between call and result the pair is open: both cuts unbalanced.
    expect(toolPairingBalancedAfter(s, 1)).toBe(false)
    expect(toolPairingBalancedBefore(s, 2)).toBe(false)
  })

  it('a seq outside the current surface reports unbalanced (cut does not exist)', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'hi'))
    expect(toolPairingBalancedBefore(s, 9)).toBe(false)
    expect(toolPairingBalancedAfter(s, 9)).toBe(false)
  })
})

describe('planReplaceUserMessage', () => {
  it('plans a single-node user/message replace that keeps the original source', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'old', { kind: 'plugin', plugin: 'x' }))
    const plan = planReplaceUserMessage(s, 0, 'new', { kind: 'plugin', plugin: 'x' })
    expect(plan.type).toBe('user/message')
    expect(plan.data.role).toBe('user')
    expect(plan.data.content).toEqual([{ type: 'text', text: 'new' }])
    expect(plan.data.source).toEqual({ kind: 'plugin', plugin: 'x' })
    expect(plan.intent.surfaceOp).toEqual({ op: 'replace', startSeq: 0, endSeq: 0 })
    expect(plan.intent.sourceEventSeqs).toEqual([0])
  })

  it('defaults the source to a plain user message', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'old'))
    const plan = planReplaceUserMessage(s, 0, 'new', undefined)
    expect(plan.data.source).toEqual({ kind: 'user' })
  })

  it('rejects a target that left the surface', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'old'))
    expectCode(() => planReplaceUserMessage(s, 7, 'new', undefined), 'target_not_on_surface')
  })

  it('rejects a cut that would split an open tool pair', () => {
    const s = new FakeSession()
    s.pushEvent(assistantWithCalls(0, 1))
    s.pushEvent(toolResult(1, 'out'))
    expectCode(() => planReplaceUserMessage(s, 1, 'new', undefined), 'unbalanced')
  })
})

describe('planRewriteToolResult', () => {
  it('clones the original event and changes only the result content', () => {
    const s = new FakeSession()
    const original = toolResult(0, 'verbose output')
    s.pushEvent(original)
    const plan = planRewriteToolResult(s, 0, 'stub')
    expect(plan.type).toBe('tool/result')
    const msg = plan.data.message as { id: string; content: { content: unknown }[]; source: unknown }
    expect(msg.id).toBe('tr0') // assertToolResultRewrite: everything but content deep-equal
    expect(msg.source).toEqual({ kind: 'tool', callId: 'c' })
    expect(msg.content[0]!.content).toBe('stub')
    expect((plan.data as { turn: number }).turn).toBe(1)
    // The original log event is immutable: the plan must not have mutated it.
    expect(original.data.message.content[0].content).toBe('verbose output')
    expect(plan.intent.sourceEventSeqs).toEqual([0])
  })

  it('rejects a non-tool/result target', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'hi'))
    expectCode(() => planRewriteToolResult(s, 0, 'stub'), 'not_tool_result')
  })
})

describe('planDeleteSegment', () => {
  it('shadows the segment with a CTM placeholder user/message', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'gone'))
    const plan = planDeleteSegment(s, 0, '[CTM] removed')
    expect(plan.type).toBe('user/message')
    expect(plan.data.content).toEqual([{ type: 'text', text: '[CTM] removed' }])
    expect(plan.data.source).toEqual(CTM_PLUGIN_SOURCE)
    expect(plan.intent.surfaceOp).toEqual({ op: 'replace', startSeq: 0, endSeq: 0 })
  })
})

describe('planRollback', () => {
  it('replaces the contiguous range from startSeq to the surface tail', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'a'))
    s.pushEvent(userMsg(1, 'b'))
    s.pushEvent(userMsg(2, 'c'))
    const plan = planRollback(s, 1, '[CTM] rolled back')
    expect(plan.intent.surfaceOp).toEqual({ op: 'replace', startSeq: 1, endSeq: 2 })
    expect(plan.intent.sourceEventSeqs).toEqual([1, 2])
    expect(plan.data.source).toEqual(CTM_PLUGIN_SOURCE)
  })

  it('starts at the next surviving node when startSeq already left the surface', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'a'))
    s.pushEvent(userMsg(1, 'b'))
    s.pushEvent(userMsg(2, 'c'))
    // Shadow seq 1 with an earlier edit; the rollback citing seq 1 must still work.
    s.append('user/message', userMsg(3, 'x').data, { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, sourceEventSeqs: [1] })
    const plan = planRollback(s, 1, '[CTM] rolled back')
    // The surface is now [0, 3, 2]: the range runs from the next surviving
    // node (3) to the surface tail (2).
    expect(plan.intent.surfaceOp).toEqual({ op: 'replace', startSeq: 3, endSeq: 2 })
    expect(plan.intent.sourceEventSeqs).toEqual([3, 2])
  })

  it('rejects a range that covers nothing', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'a'))
    expectCode(() => planRollback(s, 9, 'm'), 'empty_range')
  })

  it('rejects a range whose boundary cuts an open tool pair', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'a'))
    s.pushEvent(assistantWithCalls(1, 1))
    s.pushEvent(toolResult(2, 'out'))
    // Starting between the call and its result would strand the call.
    expectCode(() => planRollback(s, 2, 'm'), 'unbalanced')
  })
})

describe('applyEditGroup / planEdit', () => {
  it('appends the plan and reports what replaced what', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'old'))
    const group: EditGroup = {
      id: 'g1', kind: 'replace', undoable: true,
      edits: [{ kind: 'replace-user', seq: 0, text: 'new', source: { kind: 'user' } }],
      segmentIds: ['seg-0'],
    }
    const applied = applyEditGroup(s, group)
    expect(s.appended).toHaveLength(1)
    expect(s.appended[0]!.type).toBe('user/message')
    expect(applied).toEqual({ groupId: 'g1', kind: 'replace-user', replacementSeq: 1, originalSeq: 0, undoable: true })
    // The surface now shows the replacement instead of the original.
    expect(s.surface.nodes).toEqual([1])
  })

  it('a delete placeholder occupies the shadowed position on the surface', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'a'))
    s.pushEvent(userMsg(1, 'b'))
    const group: EditGroup = {
      id: 'g2', kind: 'delete', undoable: true,
      edits: [{ kind: 'delete', seq: 0, marker: '[CTM] removed' }],
      segmentIds: ['seg-0'],
    }
    const applied = applyEditGroup(s, group)
    expect(applied?.replacementSeq).toBe(2)
    expect(s.surface.nodes).toEqual([2, 1])
  })

  it('returns null for an empty group', () => {
    const s = new FakeSession()
    expect(applyEditGroup(s, { id: 'g', kind: 'replace', undoable: false, edits: [], segmentIds: [] })).toBeNull()
  })

  it('planEdit dispatches every queued-edit kind', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'a'))
    s.pushEvent(assistantWithCalls(1, 1))
    s.pushEvent(toolResult(2, 'out'))
    expect(planEdit(s, { kind: 'replace-user', seq: 0, text: 'b', source: undefined }).type).toBe('user/message')
    expect(planEdit(s, { kind: 'replace-tool', seq: 2, text: 'stub' }).type).toBe('tool/result')
    expect(planEdit(s, { kind: 'delete', seq: 0, marker: 'm' }).type).toBe('user/message')
    expect(planEdit(s, { kind: 'rollback', startSeq: 0, marker: 'm' }).type).toBe('user/message')
  })
})

describe('planUndo', () => {
  function appliedEdit(session: FakeSession, kind: 'replace-user' | 'replace-tool', seq: number, text: string): AppliedEdit {
    const group: EditGroup = {
      id: 'g', kind: 'replace', undoable: true,
      edits: [kind === 'replace-tool' ? { kind, seq, text } : { kind, seq, text, source: { kind: 'user' } }],
      segmentIds: ['seg-' + seq],
    }
    const applied = applyEditGroup(session, group)
    if (applied === null) throw new Error('expected an applied edit')
    return applied
  }

  it('reverses a logged user-message replace with the original content under a fresh id', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'original'))
    const applied = appliedEdit(s, 'replace-user', 0, 'edited')
    const plan = planUndo(s, applied)
    expect(plan.type).toBe('user/message')
    expect(plan.data.content).toEqual([{ type: 'text', text: 'original' }])
    expect(plan.data.id).not.toBe('m0') // a restore is a new message, not an id reuse
    expect(plan.intent.surfaceOp).toEqual({ op: 'replace', startSeq: applied.replacementSeq, endSeq: applied.replacementSeq })
  })

  it('reverses a logged tool-result rewrite with the original content', () => {
    const s = new FakeSession()
    s.pushEvent(toolResult(0, 'full output'))
    const applied = appliedEdit(s, 'replace-tool', 0, 'stub')
    const plan = planUndo(s, applied)
    expect(plan.type).toBe('tool/result')
    const msg = plan.data.message as { id: string; content: { content: unknown }[] }
    expect(msg.content[0]!.content).toBe('full output')
    expect(msg.id).toBe('tr0') // rewrite rule: only content may differ
  })

  it('rejects undo when the replacement node already left the surface', () => {
    const s = new FakeSession()
    s.pushEvent(userMsg(0, 'original'))
    const applied = appliedEdit(s, 'replace-user', 0, 'edited')
    // A later edit shadows the first edit's replacement node.
    applyEditGroup(s, {
      id: 'g2', kind: 'replace', undoable: true,
      edits: [{ kind: 'replace-user', seq: applied.replacementSeq, text: 'edited again', source: { kind: 'user' } }],
      segmentIds: [],
    })
    expectCode(() => planUndo(s, applied), 'target_not_on_surface')
  })

  it('rejects undo when the original event is not a user message (non-demoted sources)', () => {
    const s = new FakeSession()
    s.pushEvent(assistantWithCalls(0, 0))
    const applied: AppliedEdit = { groupId: 'g', kind: 'replace-user', replacementSeq: 0, originalSeq: 0, undoable: true }
    expectCode(() => planUndo(s, applied), 'not_user_message')
  })
})
